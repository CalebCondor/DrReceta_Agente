import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import {
  AccessToken,
  RoomServiceClient,
  SipClient,
  SIPTrunkInfo,
} from 'livekit-server-sdk';
import voiceConfig from '../voice.config';

export interface CreateRoomOptions {
  name: string;
  emptyTimeout?: number; // minutos, default 10
  maxParticipants?: number; // default 2 (caller + agent)
  metadata?: string;
}

export interface AccessTokenOptions {
  identity: string;
  name?: string;
  roomName: string;
  ttlSeconds?: number; // default 3600 (1h)
  canPublish?: boolean;
  canSubscribe?: boolean;
  isAgent?: boolean;
}

@Injectable()
export class LiveKitService implements OnModuleInit {
  private readonly logger = new Logger(LiveKitService.name);
  private roomClient!: RoomServiceClient;
  private sipClient!: SipClient;

  constructor(
    @Inject(voiceConfig.KEY)
    private readonly cfg: ConfigType<typeof voiceConfig>,
  ) {}

  onModuleInit() {
    this.roomClient = new RoomServiceClient(
      this.cfg.livekit.url,
      this.cfg.livekit.apiKey,
      this.cfg.livekit.apiSecret,
    );
    this.sipClient = new SipClient(this.cfg.livekit.url);
    this.logger.log(`LiveKit client initialized for ${this.cfg.livekit.url}`);
  }

  /**
   * Genera un JWT de acceso para un participante de un room.
   * Si `isAgent=true` se otorgan permisos completos (publish + subscribe + room admin).
   */
  async createAccessToken(opts: AccessTokenOptions): Promise<string> {
    const at = new AccessToken(
      this.cfg.livekit.apiKey,
      this.cfg.livekit.apiSecret,
      {
        identity: opts.identity,
        name: opts.name ?? opts.identity,
        ttl: opts.ttlSeconds ?? 3600,
      },
    );
    const grants: Record<string, unknown> = {
      roomJoin: true,
      room: opts.roomName,
      canPublish: opts.canPublish ?? true,
      canSubscribe: opts.canSubscribe ?? true,
    };
    if (opts.isAgent) {
      grants['roomAdmin'] = true;
      grants['canPublishData'] = true;
    }
    at.addGrant(grants as never);
    return at.toJwt();
  }

  /**
   * Crea un room (o lo reutiliza si ya existe).
   * LiveKit no falla si el room ya existe, simplemente lo abre.
   */
  async createRoom(opts: CreateRoomOptions) {
    const room = await this.roomClient.createRoom({
      name: opts.name,
      emptyTimeout: opts.emptyTimeout ?? 10,
      maxParticipants: opts.maxParticipants ?? 2,
      metadata: opts.metadata ?? '',
    });
    this.logger.log(`Room created: ${room.sid} name=${room.name}`);
    return room;
  }

  /**
   * Lista rooms activos (útil para debug / dashboard).
   */
  async listRooms() {
    const rooms = await this.roomClient.listRooms();
    return rooms.map((r) => ({
      sid: r.sid,
      name: r.name,
      numParticipants: r.numParticipants,
      creationTime: r.creationTime,
      metadata: r.metadata,
    }));
  }

  /**
   * Elimina un room (fuerza salida de participantes).
   */
  async deleteRoom(name: string) {
    await this.roomClient.deleteRoom(name);
    this.logger.log(`Room deleted: ${name}`);
  }

  /**
   * Crea el SIP trunk de Twilio en LiveKit (idempotente).
   * Se llama una vez al boot del agente.
   */
  async ensureSipTrunk(): Promise<string | null> {
    if (!this.cfg.twilio.sipTrunkDomain) {
      this.logger.warn(
        'TWILIO_SIP_TRUNK_DOMAIN not configured, skipping SIP trunk',
      );
      return null;
    }
    const existing = await this.listSipTrunks();
    const match = existing.find(
      (t) =>
        t.inboundAddresses?.includes(this.cfg.twilio.sipTrunkDomain) ||
        t.name === 'Twilio-Trunk',
    );
    if (match) {
      this.logger.log(`SIP trunk already exists: ${match.sipTrunkId}`);
      return match.sipTrunkId;
    }
    const created = await this.sipClient.createSipInboundTrunk(
      'Twilio-Trunk',
      [this.cfg.twilio.sipTrunkDomain],
      {
        authUsername: this.cfg.twilio.sipUsername,
        authPassword: this.cfg.twilio.sipPassword,
      },
    );
    this.logger.log(`SIP trunk created: ${created.sipTrunkId}`);
    return created.sipTrunkId;
  }

  async listSipTrunks(): Promise<SIPTrunkInfo[]> {
    return this.sipClient.listSipTrunk();
  }

  /**
   * Healthcheck best-effort. Devuelve true si LiveKit responde.
   */
  async ping(): Promise<boolean> {
    try {
      await this.roomClient.listRooms();
      return true;
    } catch (e) {
      this.logger.warn(`LiveKit ping failed: ${String(e)}`);
      return false;
    }
  }
}
