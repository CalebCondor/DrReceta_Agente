import { Logger } from '@nestjs/common';
import { AudioFrame } from '@livekit/rtc-node';
import { OpenAiTtsService, type TtsVoice } from './openai-tts.service';

const SAMPLE_RATE = 24000;
const NUM_CHANNELS = 1;
const FRAME_MS = 20;

/**
 * Adapter OpenAI TTS para LiveKit Agents TTS. Sintetiza texto a PCM 24kHz mono
 * y lo entrega como AudioFrames de 20ms que LiveKit puede reproducir.
 */
export class OpenAiTtsAdapter {
  readonly label = 'openai-tts';
  readonly model = 'tts-1';
  readonly provider = 'openai';
  readonly capabilities = { streaming: false, alignedTranscript: false };
  readonly sampleRate = SAMPLE_RATE;
  readonly numChannels = NUM_CHANNELS;
  private readonly logger = new Logger(OpenAiTtsAdapter.name);
  private readonly tts: OpenAiTtsService;
  private readonly defaultVoice: TtsVoice;

  constructor(tts: OpenAiTtsService, defaultVoice: TtsVoice = 'nova') {
    this.tts = tts;
    this.defaultVoice = defaultVoice;
  }

  /**
   * Convierte Int16Array PCM a AudioFrames de 20ms.
   */
  framesFromPcm(pcm: Int16Array): AudioFrame[] {
    const samplesPerFrame = Math.floor((SAMPLE_RATE * FRAME_MS) / 1000);
    const frames: AudioFrame[] = [];
    for (let i = 0; i < pcm.length; i += samplesPerFrame) {
      const slice = pcm.subarray(i, Math.min(i + samplesPerFrame, pcm.length));
      const data = new Int16Array(samplesPerFrame);
      data.set(slice);
      frames.push(new AudioFrame(data, SAMPLE_RATE, NUM_CHANNELS, FRAME_MS));
    }
    return frames;
  }

  async pcmFromText(text: string): Promise<Int16Array> {
    return this.tts.synthesizePcm(text, { voice: this.defaultVoice });
  }
}

export interface OpenAiTtsStreamHandle {
  label: string;
  inputText: string;
  close(): void;
  [Symbol.asyncIterator](): OpenAiTtsStreamHandle;
  next(): Promise<IteratorResult<unknown>>;
}

/**
 * Crea un ChunkedStream-like de LiveKit que envuelve una llamada a OpenAI TTS.
 * Devuelve un objeto iterable que emite SynthesizedAudio.
 */
export function createOpenAiTtsStream(
  adapter: OpenAiTtsAdapter,
  text: string,
  segmentId = 'seg-0',
): OpenAiTtsStreamHandle {
  const queue: unknown[] = [];
  let closed = false;
  const END: unique symbol = Symbol('END_OF_STREAM');

  async function pump(): Promise<void> {
    try {
      const pcm = await adapter.pcmFromText(text);
      const frames = adapter.framesFromPcm(pcm);
      for (let i = 0; i < frames.length; i++) {
        queue.push({
          requestId: 'synth',
          segmentId,
          frame: frames[i],
          final: i === frames.length - 1,
        });
      }
      queue.push(END);
    } catch (e) {
      console.error('TTS synthesis failed:', e);
      queue.push(END);
    }
  }
  void pump();

  const handle: OpenAiTtsStreamHandle = {
    label: 'openai-tts-chunked',
    inputText: text,
    close() {
      closed = true;
    },
    [Symbol.asyncIterator]() {
      return handle;
    },
    async next(): Promise<IteratorResult<unknown>> {
      if (closed) return { value: undefined, done: true };
      while (queue.length === 0) {
        await new Promise<void>((r) => setTimeout(r, 5));
      }
      const v = queue.shift()!;
      if (v === END) {
        closed = true;
        return { value: undefined, done: true };
      }
      return { value: v, done: false };
    },
  };
  return handle;
}
