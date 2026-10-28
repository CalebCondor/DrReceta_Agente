// src/ultramsg/ultramsg.webhook.service.ts
// Pipeline de WhatsApp entrante: mensaje del paciente → agente de Retina Care
// → respuesta por WhatsApp.
//
// UltraMsg no tiene sandbox ni cola: el webhook hay que responderlo rápido
// (si tardas, UltraMsg reintenta y el paciente recibe el mensaje dos veces),
// así que el控制器 responde 200 de inmediato y el trabajo se hace aparte.

import { Injectable, Logger } from '@nestjs/common';
import { AgentService } from '../../agent/agent.service';
import { DbService } from '../../agent/db.service';
import { UltramsgService } from '../api/ultramsg.service';
import { chatIdFromWhatsappId, isGroupChatId } from '../chat-id';
import {
  loadUltramsgConfig,
  type UltramsgConfig,
} from '../config/ultramsg.config';

export interface WebhookResult {
  handled: boolean;
  reason?: string;
  chat_id?: number;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * UltraMsg manda el id de instancia en el webhook sin el prefijo ("170610"),
 * pero en el panel y en el .env aparece con prefijo ("instance170610").
 */
function normalizeInstance(value: string): string {
  return value
    .trim()
    .replace(/^instance/i, '')
    .toLowerCase();
}

@Injectable()
export class UltramsgWebhookService {
  private readonly logger = new Logger(UltramsgWebhookService.name);
  private readonly config: UltramsgConfig;

  constructor(
    private readonly agent: AgentService,
    private readonly ultramsg: UltramsgService,
    private readonly db: DbService,
  ) {
    this.config = loadUltramsgConfig();
  }

  /**
   * Procesa un evento del webhook de UltraMsg.
   * Nunca lanza: los errores se loguean y se devuelven como `handled: false`.
   */
  async handle(payload: Record<string, unknown>): Promise<WebhookResult> {
    try {
      return await this.process(payload);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Error procesando webhook de WhatsApp: ${msg}`);
      return { handled: false, reason: msg };
    }
  }

  private async process(
    payload: Record<string, unknown>,
  ): Promise<WebhookResult> {
    const eventType = str(payload['event_type']);
    if (eventType && eventType !== 'message_received') {
      return this.skip(`event_type "${eventType}" ignorado`);
    }

    // Si el evento viene de otra instancia, no es nuestro paciente.
    // OJO: UltraMsg manda el id SIN el prefijo ("170610") aunque el panel y
    // el .env lo tengan con prefijo ("instance170610"). Se comparan normalizados.
    const eventInstance = str(payload['instanceId']).trim();
    if (
      this.config.instanceId &&
      eventInstance &&
      normalizeInstance(eventInstance) !==
        normalizeInstance(this.config.instanceId)
    ) {
      return this.skip(
        `instancia "${eventInstance}" distinta de la configurada ("${this.config.instanceId}")`,
      );
    }

    const data = (payload['data'] ?? {}) as Record<string, unknown>;

    // Los mensajes que envía la propia instancia también llegan al webhook.
    // Si se procesaran, el bot se respondería a sí mismo en bucle.
    if (
      data['fromMe'] === true ||
      data['fromMe'] === 'true' ||
      data['self'] === true ||
      data['self'] === 'true'
    ) {
      return this.skip(
        'fromMe=true: el mensaje lo mandó la propia instancia (si te escribes ' +
          'a ti mismo desde el número del QR, cae aquí y se ignora a propósito)',
      );
    }

    const type = str(data['type']) || 'chat';
    if (type !== 'chat') {
      return this.skip(`tipo "${type}" no soportado (solo texto)`);
    }

    const from = str(data['from']).trim();
    const text = str(data['body']).trim();
    if (!from || !text) {
      return this.skip('payload incompleto (from o body vacío)');
    }

    // Regla: solo usuarios. Lo que llega de un grupo de WhatsApp (o de un
    // canal/boletín) se descarta: no se responde ni se guarda nada.
    if (!this.config.allowGroups && isGroupChatId(from)) {
      return this.skip(
        `"${from}" es un grupo/canal de WhatsApp: solo se atienden usuarios`,
      );
    }

    const chatId = chatIdFromWhatsappId(from);
    this.logger.log(`WhatsApp entrante de ${from} → chat_id ${chatId}`);

    await this.recordPhone(chatId, from);

    const answer = await this.agent.chat(chatId, text);
    if (!answer) {
      // Chat en modo humano: la IA no responde (ver AgentService.chat).
      this.logger.log(`Chat ${chatId} pausado: la IA no responde`);
      return { handled: true, chat_id: chatId, reason: 'chat pausado' };
    }

    const sent = await this.ultramsg.sendMessage(from, answer);
    if (!sent.success) {
      this.logger.error(`No se pudo responder por WhatsApp: ${sent.message}`);
      return { handled: true, chat_id: chatId, reason: sent.message };
    }

    this.logger.log(`Respuesta enviada por WhatsApp a ${from}`);
    return { handled: true, chat_id: chatId };
  }

  /** Loguea el motivo del descarte y lo devuelve. */
  private skip(reason: string): WebhookResult {
    this.logger.warn(`Webhook descartado: ${reason}`);
    return { handled: false, reason };
  }

  /** Guarda el número en la memoria del chat para que el panel lo identifique. */
  private async recordPhone(chatId: number, from: string): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO memoria_largo_plazo (chat_id, clave, valor)
         VALUES ($1, 'telefono_whatsapp', $2)
         ON CONFLICT (chat_id, clave) DO NOTHING`,
        [chatId, from],
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `No se pudo guardar el teléfono del chat ${chatId}: ${msg}`,
      );
    }
  }
}
