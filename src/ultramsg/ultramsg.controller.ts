// src/ultramsg/ultramsg.controller.ts
// Envío de WhatsApp vía UltraMsg.

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
import { UltramsgWebhookService } from './ultramsg.webhook.service';

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

  constructor(
    private readonly ultramsgService: UltramsgService,
    private readonly webhookService: UltramsgWebhookService,
  ) {}

  /**
   * Webhook de UltraMsg. Configurar en el panel de la instancia:
   *   webhook_url = https://<host>/api/ultramsg/webhook
   *   webhook_message_received = true
   *
   * Responde 200 de inmediato: si se tarda, UltraMsg reintenta y el paciente
   * recibe el mensaje duplicado. El procesamiento va por fuera.
   */
  @Post('webhook')
  @HttpCode(200)
  webhook(@Body() body: Record<string, unknown>) {
    // Traza cruda: es lo primero que hay que mirar cuando "no llega nada",
    // para ver si el evento llegó, de qué tipo es y qué trae.
    this.logger.log(
      `Webhook recibido: ${JSON.stringify(body ?? {}).slice(0, 1000)}`,
    );

    void this.webhookService
      .handle(body ?? {})
      .then((r) =>
        this.logger.log(
          `Webhook procesado: ${JSON.stringify(r).slice(0, 300)}`,
        ),
      )
      .catch((e) => this.logger.error(`Error inesperado en el webhook: ${e}`));

    return { received: true };
  }

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
