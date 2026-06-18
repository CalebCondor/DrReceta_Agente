import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { LiveKitService } from './livekit.service';

interface CreateTokenDto {
  identity: string;
  name?: string;
  roomName: string;
  ttlSeconds?: number;
  isAgent?: boolean;
}

interface CreateRoomDto {
  name: string;
  emptyTimeout?: number;
  maxParticipants?: number;
  metadata?: string;
}

@Controller('voice/livekit')
export class LiveKitController {
  constructor(private readonly lk: LiveKitService) {}

  /**
   * POST /api/voice/livekit/token
   * Genera un JWT de acceso para entrar a un room.
   * Útil para el agente y para clientes de prueba (LiveKit Playground).
   */
  @Post('token')
  @HttpCode(200)
  async token(@Body() dto: CreateTokenDto) {
    const token = await this.lk.createAccessToken({
      identity: dto.identity,
      name: dto.name,
      roomName: dto.roomName,
      ttlSeconds: dto.ttlSeconds,
      isAgent: dto.isAgent,
    });
    return {
      token,
      url: process.env.LIVEKIT_URL,
      identity: dto.identity,
      roomName: dto.roomName,
    };
  }

  /**
   * POST /api/voice/livekit/rooms
   * Crea un room manualmente (LiveKit lo hace solo al recibir el primer participante,
   * pero esto sirve para pre-crear el room antes de que llegue la llamada SIP).
   */
  @Post('rooms')
  @HttpCode(201)
  async createRoom(@Body() dto: CreateRoomDto) {
    const room = await this.lk.createRoom({
      name: dto.name,
      emptyTimeout: dto.emptyTimeout,
      maxParticipants: dto.maxParticipants,
      metadata: dto.metadata,
    });
    return {
      sid: room.sid,
      name: room.name,
      maxParticipants: room.maxParticipants,
      creationTime: room.creationTime,
    };
  }

  /**
   * GET /api/voice/livekit/rooms
   * Lista rooms activos (debug + dashboard).
   */
  @Get('rooms')
  async listRooms() {
    return this.lk.listRooms();
  }

  /**
   * GET /api/voice/livekit/sip-trunks
   * Lista los SIP trunks configurados.
   */
  @Get('sip-trunks')
  async listSipTrunks() {
    return this.lk.listSipTrunks();
  }

  /**
   * POST /api/voice/livekit/sip-trunks/ensure
   * Crea el trunk de Twilio si no existe (idempotente).
   * Pensado para correr una vez al boot.
   */
  @Post('sip-trunks/ensure')
  @HttpCode(200)
  async ensureSipTrunk() {
    const id = await this.lk.ensureSipTrunk();
    return { sipTrunkId: id };
  }
}
