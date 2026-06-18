import { Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import voiceConfig from './voice.config';
import { LiveKitService } from './livekit/livekit.service';
import { CallStateService } from './state/call-state.service';

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    @Inject(voiceConfig.KEY)
    private readonly cfg: ConfigType<typeof voiceConfig>,
    private readonly livekit: LiveKitService,
    private readonly state: CallStateService,
  ) {}

  /**
   * Healthcheck del voice stack. Verifica que:
   * - Tenemos config de LiveKit cargada
   - LiveKit responde (best-effort, no rompe si está caído)
   * - Redis responde (best-effort)
   */
  async health() {
    const livekitReachable = await this.livekit.ping().catch(() => false);
    const redisReachable = await this.state.ping().catch(() => false);
    return {
      ok: livekitReachable && redisReachable,
      livekit: {
        configured: !!this.cfg.livekit.apiKey && !!this.cfg.livekit.apiSecret,
        reachable: livekitReachable,
        url: this.cfg.livekit.url,
      },
      redis: { reachable: redisReachable },
      voice: {
        language: this.cfg.voice.language,
        agentName: this.cfg.voice.agentName,
      },
    };
  }
}
