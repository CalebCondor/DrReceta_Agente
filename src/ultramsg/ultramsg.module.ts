// src/ultramsg/ultramsg.module.ts
// Módulo de integración con WhatsApp (Ultramsg).
//
//   api/      envío de mensajes (cliente HTTP + endpoints REST)
//   webhook/  entrada de mensajes del paciente (pipeline hacia el agente)
//   config/   configuración leída del entorno
//   tests/    specs (excluidas del build por tsconfig.build.json)

import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { UltramsgController } from './api/ultramsg.controller';
import { UltramsgService } from './api/ultramsg.service';
import { UltramsgWebhookController } from './webhook/ultramsg.webhook.controller';
import { UltramsgWebhookService } from './webhook/ultramsg.webhook.service';

@Module({
  imports: [ChatModule],
  controllers: [UltramsgController, UltramsgWebhookController],
  providers: [UltramsgService, UltramsgWebhookService],
  exports: [UltramsgService],
})
export class UltramsgModule {}
