// src/ultramsg/webhook/ultramsg.webhook.controller.ts
// Entrada de WhatsApp: UltraMsg publica aquí los mensajes que llegan al
// número de la clínica.
//
// Configurar en el panel de la instancia:
//   webhook_url = https://<host>/api/ultramsg/webhook
//   webhook_message_received = true

import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { UltramsgWebhookService } from './ultramsg.webhook.service';

@Controller('ultramsg')
export class UltramsgWebhookController {
  private readonly logger = new Logger(UltramsgWebhookController.name);

  constructor(private readonly webhookService: UltramsgWebhookService) {}

  /**
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
}
