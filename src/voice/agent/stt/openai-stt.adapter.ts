import { Logger } from '@nestjs/common';
import { OpenAiSttService } from './openai-stt.service';

const SAMPLE_RATE = 16000;
const SILENCE_FLUSH_MS = 700;
const MIN_AUDIO_BYTES = 16000 * 2 * 0.3;

/**
 * Adapter OpenAI Whisper para LiveKit Agents STT. Acumula frames hasta
 * detectar silencio y los transcribe en batch vía Whisper.
 *
 * Limitaciones: latencia ~700ms (vs ~200ms de STT streaming nativo).
 * Para producción considerar migrar a LiveKit Inference STT o deepgram/cartesia.
 */
export class OpenAiSttAdapter {
  readonly label = 'openai-whisper';
  readonly model = 'whisper-1';
  readonly provider = 'openai';
  readonly capabilities = {
    streaming: true,
    interimResults: false,
    alignedTranscript: false as const,
  };
  private readonly logger = new Logger(OpenAiSttAdapter.name);
  private readonly stt: OpenAiSttService;
  readonly sampleRate: number;

  constructor(stt: OpenAiSttService, sampleRate = SAMPLE_RATE) {
    this.stt = stt;
    this.sampleRate = sampleRate;
  }

  /**
   * Convierte PCM s16le mono a WAV con header RIFF.
   */
  pcmToWav(pcm: Int16Array, sampleRate: number, channels: number): Buffer {
    const byteLength = pcm.length * 2;
    const buffer = Buffer.alloc(44 + byteLength);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + byteLength, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * channels * 2, 28);
    buffer.writeUInt16LE(channels * 2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(byteLength, 40);
    for (let i = 0; i < pcm.length; i++) {
      buffer.writeInt16LE(pcm[i], 44 + i * 2);
    }
    return buffer;
  }
}

export interface OpenAiSpeechStreamHandle {
  label: string;
  pushFrame(pcm: Int16Array): void;
  flush(): void;
  close(): void;
  [Symbol.asyncIterator](): OpenAiSpeechStreamHandle;
  next(): Promise<IteratorResult<unknown>>;
}

/**
 * Crea un SpeechStream-like de LiveKit que acumula audio, detecta silencio
 * y dispara transcripción vía Whisper.
 */
export function createOpenAiSttStream(
  adapter: OpenAiSttAdapter,
): OpenAiSpeechStreamHandle {
  const accumulated: Int16Array[] = [];
  let totalSamples = 0;
  let lastSpeechAt = Date.now();
  let reqId = 0;
  const queue: unknown[] = [];
  let flushRequested = false;
  let closed = false;
  const END: unique symbol = Symbol('END_SPEECH_EVENT');
  const sampleRate = adapter.sampleRate;

  async function maybeTranscribe(force: boolean): Promise<void> {
    if (totalSamples === 0) return;
    if (!force && totalSamples < MIN_AUDIO_BYTES) return;
    const merged = mergeAccumulated();
    accumulated.length = 0;
    const samples = totalSamples;
    totalSamples = 0;

    const id = `req-${++reqId}`;
    queue.push({ type: 0, requestId: id });
    try {
      const wav = adapter.pcmToWav(merged, sampleRate, 1);
      const result = await adapter['stt'].transcribe(wav, 'utterance.wav', {
        language: 'es',
        responseFormat: 'json',
      });
      if (result?.text) {
        queue.push({
          type: 2,
          requestId: id,
          alternatives: [
            {
              language: result.language ?? 'es',
              text: result.text,
              startTime: 0,
              endTime: samples / sampleRate,
              confidence: 1,
            },
          ],
        });
      }
    } catch (e) {
      console.error('STT stream transcription failed:', e);
    }
    queue.push({ type: 3, requestId: id });
    queue.push(END);
  }

  function mergeAccumulated(): Int16Array {
    const out = new Int16Array(totalSamples);
    let offset = 0;
    for (const chunk of accumulated) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  function rms(samples: Int16Array): number {
    if (samples.length === 0) return 0;
    let sum = 0;
    const N = Math.min(samples.length, 1600);
    for (let i = 0; i < N; i++) {
      const v = samples[i];
      sum += v * v;
    }
    return Math.sqrt(sum / N);
  }

  const silenceMonitor = setInterval(() => {
    if (closed) return;
    const silenceMs = Date.now() - lastSpeechAt;
    if (flushRequested || silenceMs >= SILENCE_FLUSH_MS) {
      flushRequested = false;
      void maybeTranscribe(false);
    }
  }, 100);

  const handle: OpenAiSpeechStreamHandle = {
    label: 'openai-whisper-stream',
    pushFrame(pcm: Int16Array) {
      if (closed) return;
      if (rms(pcm) > 800) lastSpeechAt = Date.now();
      const copy = new Int16Array(pcm);
      accumulated.push(copy);
      totalSamples += copy.length;
    },
    flush() {
      flushRequested = true;
    },
    close() {
      closed = true;
      clearInterval(silenceMonitor);
    },
    [Symbol.asyncIterator]() {
      return handle;
    },
    async next(): Promise<IteratorResult<unknown>> {
      if (closed && queue.length === 0) {
        return { value: undefined, done: true };
      }
      while (queue.length === 0) {
        await new Promise<void>((r) => setTimeout(r, 5));
        if (closed && queue.length === 0) {
          return { value: undefined, done: true };
        }
      }
      const v = queue.shift()!;
      if (v === END) {
        return { value: undefined, done: true };
      }
      return { value: v, done: false };
    },
  };
  return handle;
}
