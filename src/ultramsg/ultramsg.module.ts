// src/ultramsg/ultramsg.module.ts
// Módulo de integración con WhatsApp (Ultramsg): envío de mensajes y webhook
// de entrada (WhatsApp → agente → respuesta por WhatsApp).

import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { UltramsgController } from './ultramsg.controller';
import { UltramsgService } from './ultramsg.service';
import { UltramsgWebhookService } from './ultramsg.webhook.service';

@Module({
  imports: [ChatModule],
  controllers: [UltramsgController],
  providers: [UltramsgService, UltramsgWebhookService],
  exports: [UltramsgService],
})
export class UltramsgModule {}
