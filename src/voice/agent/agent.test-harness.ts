import { Injectable, Logger } from '@nestjs/common';
import { ClaudeLlmService } from './llm/claude-llm.service';
import { OpenAiTtsService, type TtsVoice } from './tts/openai-tts.service';
import { hashPhoneToChatId } from './context/tool-executor';

export interface TestChatInput {
  text: string;
  phoneNumber?: string; // default: '+10000000000' (mockeado)
  voice?: TtsVoice;
  model?: string; // para TTS, default 'tts-1'
  speed?: number; // 0.25 a 4.0, default 1.0
}

export interface TestChatResult {
  text: string;
  rounds: number;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  audio: {
    format: 'mp3';
    base64: string;
    sizeBytes: number;
    durationMs: number; // aproximado
  };
  chatId: number;
  phoneNumber: string;
  timing: {
    llmMs: number;
    ttsMs: number;
    totalMs: number;
  };
}

export interface TestSynthesizeInput {
  text: string;
  voice?: TtsVoice;
  model?: string;
  speed?: number;
}

export interface TestSynthesizeResult {
  audio: {
    format: 'mp3';
    base64: string;
    sizeBytes: number;
    durationMs: number;
  };
  voice: TtsVoice;
  text: string;
  timingMs: number;
}

/**
 * Test harness end-to-end del stack de voz, sin necesidad de LiveKit,
 * Twilio ni teléfono real. Permite validar el pipeline completo:
 *
 *   texto del usuario
 *     → Claude (con tools reusando executeTool del agente existente)
 *     → texto de respuesta
 *     → TTS OpenAI
 *     → audio MP3 base64
 *
 * Pensado para:
 * - Dev: validar cambios en system prompt / tools sin gastar una llamada real
 * - QA: probar el agente con textos conocidos antes de gastar una llamada Twilio
 * - Tests: fácil de automatizar con curl/jest
 *
 * No toca STT (se omite, asumimos texto de entrada). Para probar STT real,
 * el caller puede mandar audio a /api/voice/livekit/token + LiveKit Playground.
 */
@Injectable()
export class VoiceTestHarness {
  private readonly logger = new Logger(VoiceTestHarness.name);

  constructor(
    private readonly llm: ClaudeLlmService,
    private readonly tts: OpenAiTtsService,
  ) {}

  /**
   * Test principal: ejecuta un turno completo con LLM + tools + TTS.
   */
  async testChat(input: TestChatInput): Promise<TestChatResult> {
    const t0 = Date.now();
    const phoneNumber = input.phoneNumber ?? '+10000000000';
    const voice = input.voice ?? 'nova';
    const chatId = hashPhoneToChatId(phoneNumber);

    this.logger.log(
      `[test-chat] chatId=${chatId} phone=${phoneNumber} text="${input.text.slice(0, 80)}"`,
    );

    // 1) LLM con tools
    const llmT0 = Date.now();
    const turn = await this.llm.runTurn(chatId, [
      { role: 'user', content: input.text },
    ]);
    const llmMs = Date.now() - llmT0;

    this.logger.log(
      `[test-chat] LLM done rounds=${turn.rounds} tools=${turn.toolCalls.length} textLen=${turn.text.length} (${llmMs}ms)`,
    );

    if (!turn.text) {
      throw new Error('Claude no devolvió texto. Revisar logs del LLM.');
    }

    // 2) TTS
    const ttsT0 = Date.now();
    const audio = await this.tts.synthesize(turn.text, {
      voice,
      model: input.model,
      speed: input.speed,
      format: 'mp3',
    });
    const ttsMs = Date.now() - ttsT0;

    const totalMs = Date.now() - t0;
    this.logger.log(
      `[test-chat] TTS done ${audio.length} bytes (${ttsMs}ms) | TOTAL ${totalMs}ms`,
    );

    return {
      text: turn.text,
      rounds: turn.rounds,
      toolCalls: turn.toolCalls,
      audio: {
        format: 'mp3',
        base64: audio.toString('base64'),
        sizeBytes: audio.length,
        durationMs: Math.round((audio.length * 8) / 12), // aprox: 128kbps mp3 = 16KB/s
      },
      chatId,
      phoneNumber,
      timing: { llmMs, ttsMs, totalMs },
    };
  }

  /**
   * Smoke test del TTS aislado. Útil para validar que la voz suene bien
   * sin gastar tokens de Claude.
   */
  async testSynthesize(
    input: TestSynthesizeInput,
  ): Promise<TestSynthesizeResult> {
    const t0 = Date.now();
    const voice = input.voice ?? 'nova';

    this.logger.log(
      `[test-tts] voice=${voice} text="${input.text.slice(0, 80)}"`,
    );

    const audio = await this.tts.synthesize(input.text, {
      voice,
      model: input.model,
      speed: input.speed,
      format: 'mp3',
    });

    const timingMs = Date.now() - t0;
    this.logger.log(`[test-tts] done ${audio.length} bytes (${timingMs}ms)`);

    return {
      audio: {
        format: 'mp3',
        base64: audio.toString('base64'),
        sizeBytes: audio.length,
        durationMs: Math.round((audio.length * 8) / 12),
      },
      voice,
      text: input.text,
      timingMs,
    };
  }
}
