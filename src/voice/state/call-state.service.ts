import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import Redis from 'ioredis';
import voiceConfig from '../voice.config';
import { REDIS_CLIENT } from './redis.constants';

export interface CallState {
  callSid: string;
  roomName: string;
  fromNumber: string;
  toNumber: string;
  startedAt: number;
  endedAt?: number;
  status: 'ringing' | 'in-progress' | 'completed' | 'failed';
  // Identidad del usuario si se autenticó durante la llamada
  userId?: number;
  userType?: 'residente' | 'turista';
  token?: string;
  // Metadata libre para tools personalizadas
  metadata?: Record<string, unknown>;
}

const KEY_PREFIX = 'voice:call:';
const DEFAULT_TTL_SECONDS = 3600; // 1h después de colgar

@Injectable()
export class CallStateService {
  private readonly logger = new Logger(CallStateService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(voiceConfig.KEY)
    private readonly cfg: ConfigType<typeof voiceConfig>,
  ) {}

  private key(callSid: string) {
    return `${KEY_PREFIX}${callSid}`;
  }

  async setState(state: CallState, ttlSeconds = DEFAULT_TTL_SECONDS) {
    await this.redis.set(
      this.key(state.callSid),
      JSON.stringify(state),
      'EX',
      ttlSeconds,
    );
  }

  async patchState(
    callSid: string,
    patch: Partial<CallState>,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ): Promise<CallState | null> {
    const current = await this.getState(callSid);
    if (!current) return null;
    const next = { ...current, ...patch };
    await this.setState(next, ttlSeconds);
    return next;
  }

  async getState(callSid: string): Promise<CallState | null> {
    const raw = await this.redis.get(this.key(callSid));
    return raw ? (JSON.parse(raw) as CallState) : null;
  }

  async deleteState(callSid: string) {
    await this.redis.del(this.key(callSid));
  }

  async listActiveCalls(): Promise<CallState[]> {
    const keys = await this.redis.keys(`${KEY_PREFIX}*`);
    if (keys.length === 0) return [];
    const values = await this.redis.mget(...keys);
    return values
      .filter((v): v is string => !!v)
      .map((v) => JSON.parse(v) as CallState);
  }

  /**
   * Healthcheck. Devuelve true si Redis responde a PING.
   */
  async ping(): Promise<boolean> {
    try {
      const r = await this.redis.ping();
      return r === 'PONG';
    } catch (e) {
      this.logger.warn(`Redis ping failed: ${String(e)}`);
      return false;
    }
  }

  /**
   * Helper para guardar metadata de conversación (turnos LLM/ASR/TTS).
   * Se guarda como lista append-only con TTL.
   */
  async appendTranscript(
    callSid: string,
    entry: {
      role: 'user' | 'assistant' | 'system';
      content: string;
      ts: number;
    },
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ) {
    const key = `${KEY_PREFIX}${callSid}:transcript`;
    await this.redis.rpush(key, JSON.stringify(entry));
    await this.redis.expire(key, ttlSeconds);
  }

  async getTranscript(callSid: string) {
    const key = `${KEY_PREFIX}${callSid}:transcript`;
    const items = await this.redis.lrange(key, 0, -1);
    return items.map(
      (s) => JSON.parse(s) as { role: string; content: string; ts: number },
    );
  }
}
