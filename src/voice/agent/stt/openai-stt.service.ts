import { Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import OpenAI from 'openai';
import voiceConfig from '../../voice.config';

export interface TranscribeOptions {
  language?: string; // ISO-639-1, ej 'es'
  prompt?: string; // hint para mejorar precisión
  temperature?: number;
  responseFormat?: 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt';
}

export interface TranscribeResult {
  text: string;
  language?: string;
  duration?: number;
}

/**
 * Servicio NestJS que envuelve OpenAI Whisper para transcripción batch.
 *
 * LiveKit Agents SDK ofrece un STT nativo de OpenAI, pero este servicio se
 * mantiene como wrapper independiente para:
 *   1. Tests unitarios (transcribir un WAV sin levantar LiveKit)
 *   2. Reutilización en scripts / webhooks / debugging
 *   3. Como fallback si el stream de LiveKit falla
 *
 * El adapter LiveKit (openai-stt.adapter.ts) usa este servicio internamente.
 */
@Injectable()
export class OpenAiSttService {
  private readonly logger = new Logger(OpenAiSttService.name);
  private readonly client: OpenAI;

  constructor(
    @Inject(voiceConfig.KEY)
    private readonly cfg: ConfigType<typeof voiceConfig>,
  ) {
    this.client = new OpenAI({ apiKey: this.cfg.openai.apiKey });
  }

  /**
   * Transcribe un buffer de audio (WAV/MP3/OGG/M4A/WebM) a texto.
   * @param audio Buffer con el audio binario
   * @param filename Nombre del archivo (OpenAI lo usa para detectar formato)
   * @param opts.language Idioma forzado (es, en, etc). Si no, autodetecta.
   */
  async transcribe(
    audio: Buffer,
    filename = 'audio.wav',
    opts: TranscribeOptions = {},
  ): Promise<TranscribeResult> {
    if (!audio || audio.length === 0) {
      return { text: '' };
    }
    try {
      // Convert Buffer to a File-like object compatible with OpenAI SDK.
      const file = new File([new Uint8Array(audio)], filename, {
        type: this.guessMime(filename),
      });
      const result = await this.client.audio.transcriptions.create({
        file,
        model: this.cfg.openai.sttModel,
        language: opts.language ?? this.mapLanguage(this.cfg.voice.language),
        prompt: opts.prompt,
        temperature: opts.temperature ?? 0,
        response_format: opts.responseFormat ?? 'verbose_json',
      });
      const r = result as unknown as {
        text: string;
        language?: string;
        duration?: number;
      };
      return {
        text: r.text?.trim() ?? '',
        language: r.language,
        duration: r.duration,
      };
    } catch (e) {
      this.logger.error(`Whisper transcription failed: ${String(e)}`);
      throw e;
    }
  }

  private mapLanguage(lang: string): string {
    // OpenAI acepta ISO-639-1 (es, en) o auto. Si es es-ES devolvemos 'es'.
    if (!lang) return undefined as unknown as string;
    return lang.split('-')[0];
  }

  private guessMime(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const map: Record<string, string> = {
      wav: 'audio/wav',
      mp3: 'audio/mpeg',
      ogg: 'audio/ogg',
      oga: 'audio/ogg',
      m4a: 'audio/mp4',
      mp4: 'audio/mp4',
      webm: 'audio/webm',
      flac: 'audio/flac',
    };
    return map[ext ?? ''] ?? 'audio/wav';
  }
}
