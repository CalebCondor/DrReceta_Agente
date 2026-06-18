import { Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import OpenAI from 'openai';
import voiceConfig from '../../voice.config';

export type TtsVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

export type TtsFormat = 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';

export interface SynthesizeOptions {
  voice?: TtsVoice;
  model?: string; // 'tts-1' (fast) o 'tts-1-hd' (HQ)
  format?: TtsFormat;
  speed?: number; // 0.25 a 4.0, default 1.0
}

@Injectable()
export class OpenAiTtsService {
  private readonly logger = new Logger(OpenAiTtsService.name);
  private readonly client: OpenAI;

  constructor(
    @Inject(voiceConfig.KEY)
    private readonly cfg: ConfigType<typeof voiceConfig>,
  ) {
    this.client = new OpenAI({ apiKey: this.cfg.openai.apiKey });
  }

  /**
   * Sintetiza texto a audio y devuelve un Buffer con el audio binario.
   * Para LiveKit necesitás formato PCM (16kHz, mono). Usá `synthesizePcm()`.
   */
  async synthesize(
    text: string,
    opts: SynthesizeOptions = {},
  ): Promise<Buffer> {
    if (!text || !text.trim()) {
      return Buffer.alloc(0);
    }
    try {
      const voice = (opts.voice ?? this.cfg.openai.ttsVoice) as TtsVoice;
      const model = opts.model ?? this.cfg.openai.ttsModel;
      const format = opts.format ?? 'mp3';

      const response = await this.client.audio.speech.create({
        model,
        voice,
        input: text,
        response_format: format,
        speed: opts.speed ?? 1.0,
      });
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (e) {
      this.logger.error(`OpenAI TTS failed: ${String(e)}`);
      throw e;
    }
  }

  /**
   * Sintetiza texto a PCM crudo (16kHz, mono, s16le) listo para LiveKit.
   * OpenAI no devuelve PCM directo, así que pedimos WAV y strippeamos el header.
   */
  async synthesizePcm(
    text: string,
    opts: Omit<SynthesizeOptions, 'format'> = {},
  ): Promise<Int16Array> {
    const wav = await this.synthesize(text, { ...opts, format: 'wav' });
    return this.wavToPcm16(wav);
  }

  /**
   * Convierte un WAV (con header RIFF) a un Int16Array de muestras PCM.
   * Asume PCM 16-bit little-endian (lo que devuelve OpenAI).
   */
  private wavToPcm16(wav: Buffer): Int16Array {
    if (wav.length < 44) {
      throw new Error(`WAV demasiado corto: ${wav.length} bytes`);
    }
    // Buscar el chunk "data" — algunos WAV tienen LIST u otros chunks antes.
    let dataOffset = 44;
    for (let i = 12; i < wav.length - 8; i++) {
      if (wav.toString('ascii', i, i + 4) === 'data') {
        dataOffset = i + 8;
        break;
      }
    }
    const pcm = wav.subarray(dataOffset);
    // Asegurar longitud par para Int16Array
    const even = pcm.length - (pcm.length % 2);
    return new Int16Array(pcm.buffer, pcm.byteOffset, even / 2);
  }
}
