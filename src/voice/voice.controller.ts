import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { VoiceService } from './voice.service';
import {
  VoiceTestHarness,
  type TestChatInput,
  type TestSynthesizeInput,
} from './agent/agent.test-harness';

@Controller('voice')
export class VoiceController {
  constructor(
    private readonly voice: VoiceService,
    private readonly testHarness: VoiceTestHarness,
  ) {}

  /**
   * GET /api/voice/health
   * Healthcheck del voice stack (LiveKit + Redis + config).
   */
  @Get('health')
  @HttpCode(200)
  health() {
    return this.voice.health();
  }

  /**
   * POST /api/voice/test/synthesize
   * Smoke test del TTS aislado. Texto in → MP3 out.
   *
   * Body: { text, voice?, model?, speed? }
   * Response: { audio: { format, base64, sizeBytes, durationMs }, voice, text, timingMs }
   *
   * Útil para validar que la voz suena bien sin gastar tokens de Claude.
   * No usa LLM, no usa tools, no requiere Redis ni LiveKit.
   */
  @Post('test/synthesize')
  @HttpCode(200)
  async testSynthesize(@Body() body: TestSynthesizeInput) {
    if (!body.text || !body.text.trim()) {
      throw new Error('text is required');
    }
    return this.testHarness.testSynthesize(body);
  }

  /**
   * POST /api/voice/test/chat
   * Test E2E del pipeline: texto in → LLM (con tools reusando executeTool
   * del agente existente) → TTS → MP3 out.
   *
   * Body: { text, phoneNumber?, voice?, model?, speed? }
   * Response: { text, rounds, toolCalls, audio: { format, base64, sizeBytes, durationMs }, chatId, phoneNumber, timing: { llmMs, ttsMs, totalMs } }
   *
   * No usa STT (asume texto de entrada). No usa LiveKit. No usa Twilio.
   * El phoneNumber es solo para mapear a chatId; no se hace ninguna llamada.
   *
   * Para probar STT + audio-in real, usar LiveKit Playground (Fase 8).
   */
  @Post('test/chat')
  @HttpCode(200)
  async testChat(@Body() body: TestChatInput) {
    if (!body.text || !body.text.trim()) {
      throw new Error('text is required');
    }
    return this.testHarness.testChat(body);
  }
}
