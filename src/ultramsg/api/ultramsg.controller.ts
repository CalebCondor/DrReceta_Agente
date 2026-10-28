// src/ultramsg/api/ultramsg.controller.ts
// API de envío de WhatsApp (UltraMsg).

import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { UltramsgService } from './ultramsg.service';

class EnviarMensajeDto {
  /** Opcional: si se omite, se usa ULTRAMSG_TEST_TO. */
  @IsOptional()
  @IsString()
  to?: string;

  @IsString()
  @IsNotEmpty()
  body!: string;
}

@Controller('ultramsg')
export class UltramsgController {
  private readonly logger = new Logger(UltramsgController.name);

  constructor(private readonly ultramsgService: UltramsgService) {}

  /** POST /api/ultramsg/send-message { to: "+1787...", body: "texto" } */
  @Post('send-message')
  @HttpCode(200)
  async sendMessage(@Body() body: EnviarMensajeDto) {
    if (!this.ultramsgService.isConfigured()) {
      throw new HttpException(
        {
          success: false,
          error:
            'Ultramsg no está configurado (ULTRAMSG_INSTANCE_ID / ULTRAMSG_TOKEN).',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const result = await this.ultramsgService.sendMessage(body.to, body.body);
    if (!result.success) {
      this.logger.warn(`Envío rechazado por Ultramsg: ${result.message}`);
      throw new HttpException(
        { success: false, error: result.message },
        HttpStatus.BAD_REQUEST,
      );
    }

    return { success: true, message: result.message, data: result.raw };
  }
}
