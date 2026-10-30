// src/agent/agent.service.ts
// Agente de la clínica SIN IA: el mensaje del paciente se resuelve por
// palabra clave contra la base de conocimiento (`conocimiento_especifico`).
// No hay modelo de lenguaje ni contexto conversacional.

import { Injectable, Logger } from '@nestjs/common';
import { DbService } from './db.service';
import { FaqService } from './faq.service';
import { ChatGateway } from '../chat/chat.gateway';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly db: DbService,
    private readonly faq: FaqService,
    private readonly chatGateway: ChatGateway,
  ) {}

  /** Guarda un mensaje en el historial (la columna `content` es JSONB). */
  private async persistMessage(
    chatId: number,
    role: string,
    content: string,
  ): Promise<void> {
    try {
      await this.db.query(
        'INSERT INTO historial_mensajes (chat_id, role, content) VALUES ($1, $2, $3)',
        [chatId, role, JSON.stringify(content)],
      );
    } catch (e) {
      this.logger.error(`Error persistiendo mensaje: ${e}`);
    }
  }

  /**
   * Procesa un mensaje del paciente y devuelve la respuesta.
   * Si el chat está en modo humano (pausado), no responde.
   */
  async chat(chatId: number, userText: string): Promise<string> {
    const { rows } = await this.db.query(
      `SELECT 1 FROM chats_pausados
       WHERE chat_id = $1 AND reanudado_en IS NULL
       LIMIT 1`,
      [chatId],
    );

    if ((rows as unknown[]).length > 0) {
      // Chat en modo humano: se guarda el mensaje del usuario y se avisa al
      // panel admin por WebSocket. El agente no responde.
      await this.persistMessage(chatId, 'user', userText);
      try {
        this.chatGateway?.emitUserMessage?.(chatId, {
          chat_id: chatId,
          role: 'user',
          content: userText,
        });
      } catch (e) {
        this.logger.warn(`No se pudo emitir WebSocket user-message: ${e}`);
      }
      this.logger.log(`Chat ${chatId} pausado. Mensaje del usuario guardado.`);
      return '';
    }

    await this.persistMessage(chatId, 'user', userText);

    let respuesta: string;
    try {
      respuesta = await this.faq.responder(userText);
    } catch (e) {
      this.logger.error(`Error buscando en la base de conocimiento: ${e}`);
      respuesta =
        'No pudimos obtener la información en este momento. Por favor comuníquese ' +
        'con nuestro equipo de Retina Care.';
    }

    await this.persistMessage(chatId, 'assistant', respuesta);
    return respuesta;
  }
}
