// src/agent/agent.service.ts
// Núcleo del agente: usa el SDK de Anthropic apuntando al endpoint
// Anthropic-compatible de MiniMax. Esto hace que el razonamiento venga
// en bloques separados `type: "thinking"`, que filtramos para que NUNCA
// lleguen al usuario (solo los bloques `type: "text"` son visibles).

import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  client,
  ANTHROPIC_MODEL,
  conversations,
  // minimaxConversations, // legacy, ya no se usa
  // MiniMaxMessage, MiniMaxToolCall, // legacy
  // USE_ANTHROPIC, // legacy
} from './state';
import { TOOLS } from './tools';
import { executeTool } from './executor';
import { buildSystem } from './system';
import { DbService } from './db.service';
import { ChatGateway } from '../chat/chat.gateway';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly db: DbService,
    private readonly chatGateway: ChatGateway,
  ) {}

  // toOpenAITools ya no se usa: el SDK de Anthropic recibe las tools
  // directamente en su formato nativo.

  /** Carga el historial desde la base de datos si la memoria en vivo está vacía */
  private async loadHistoryIfEmpty(
    chatId: number,
  ): Promise<Anthropic.MessageParam[]> {
    if (!conversations.has(chatId)) {
      try {
        const { rows } = await this.db.query(
          'SELECT role, content FROM historial_mensajes WHERE chat_id = $1 ORDER BY created_at ASC LIMIT 50',
          [chatId],
        );
        const history: Anthropic.MessageParam[] = rows
          .map((r: { role: string; content: unknown }) => {
            let text = '';
            if (typeof r.content === 'string') {
              try {
                const parsed = JSON.parse(r.content) as unknown;
                text =
                  typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
              } catch {
                text = r.content;
              }
            } else if (r.content !== null && r.content !== undefined) {
              text = JSON.stringify(r.content);
            }
            const role: 'user' | 'assistant' =
              r.role === 'assistant' ? 'assistant' : 'user';
            return { role, content: text } as Anthropic.MessageParam;
          })
          .filter((m: Anthropic.MessageParam) => m.content);
        conversations.set(chatId, history);
      } catch (e) {
        this.logger.error(`Error loading history for ${chatId}: ${e}`);
        conversations.set(chatId, []);
      }
    }
    return conversations.get(chatId)!;
  }

  /** Guarda un mensaje en la base de datos */
  private async persistMessage(
    chatId: number,
    role: string,
    content: unknown,
  ): Promise<void> {
    try {
      // La columna `content` es JSONB: siempre hay que enviar JSON válido.
      // Para texto plano, JSON.stringify lo envuelve como string JSON ("...").
      const stored = JSON.stringify(content);
      await this.db.query(
        'INSERT INTO historial_mensajes (chat_id, role, content) VALUES ($1, $2, $3)',
        [chatId, role, stored],
      );
    } catch (e) {
      this.logger.error(`Error persisting message: ${e}`);
    }
  }

  private appendToHistory(
    chatId: number,
    msgs: Anthropic.MessageParam[],
  ): void {
    const history = conversations.get(chatId) ?? [];
    for (const m of msgs) {
      history.push(m);
    }
    if (history.length > 50) history.splice(0, history.length - 50);
    conversations.set(chatId, history);
  }

  /**
   * Núcleo del agente. Usa el SDK de Anthropic apuntando al endpoint
   * Anthropic-compatible de MiniMax. El razonamiento viene en bloques
   * `type: "thinking"` separados; aquí SOLO tomamos los `type: "text"`
   * para construir la respuesta al usuario.
   */
  private async runAgentCore(
    chatId: number,
    userText: string,
  ): Promise<string> {
    const history = await this.loadHistoryIfEmpty(chatId);

    history.push({ role: 'user', content: userText });
    if (history.length > 50) history.splice(0, history.length - 50);
    await this.persistMessage(chatId, 'user', userText);

    const collected: string[] = [];

    for (let round = 0; round < 10; round++) {
      const systemPrompt = await buildSystem(chatId, this.db);

      const response = await client.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: TOOLS,
        messages: [...history],
      });

      // Separar los bloques por tipo
      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === 'text',
      );
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      const thinkingBlocks = response.content.filter(
        (b): b is Anthropic.ThinkingBlock => b.type === 'thinking',
      );

      if (thinkingBlocks.length > 0) {
        const len = thinkingBlocks.reduce(
          (acc, b) => acc + (b.thinking?.length ?? 0),
          0,
        );
        this.logger.log(
          `[Anthropic] thinking separado: ${thinkingBlocks.length} bloques, ${len} chars. NO se muestra al usuario.`,
        );
      }

      const assistantText = textBlocks
        .map((b) => b.text)
        .join('')
        .trim();

      // Sin tool calls → respuesta final
      if (
        toolUseBlocks.length === 0 ||
        response.stop_reason === 'end_turn' ||
        response.stop_reason === 'stop_sequence'
      ) {
        const fallback = collected.join('\n');
        const textToSave = assistantText || fallback;
        if (textToSave) {
          collected.push(assistantText || fallback);
          history.push({ role: 'assistant', content: response.content });
          await this.persistMessage(chatId, 'assistant', textToSave);
        } else {
          this.logger.warn(
            `Respuesta del modelo quedó vacía para chat ${chatId}.`,
          );
        }
        return collected.join('\n');
      }

      // Con tool calls → guardar el turno del asistente (con tool_use) y ejecutar
      history.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUseBlocks) {
        const args = (tu.input ?? {}) as Record<string, unknown>;
        this.logger.log(`tool=${tu.name} input=${JSON.stringify(args)}`);

        const resultStr = await executeTool(tu.name, args, chatId, this.db);
        this.logger.log(`result=${resultStr.slice(0, 200)}`);

        // Capturar formatted_html si la herramienta lo devuelve
        try {
          const parsed = JSON.parse(resultStr) as {
            success?: boolean;
            formatted_html?: string;
          };
          if (parsed.success && parsed.formatted_html) {
            collected.push(parsed.formatted_html);
          }
        } catch {
          /* no es JSON */
        }

        // Strip formatted_html antes de devolver al modelo (ya capturado)
        let resultForModel = resultStr;
        try {
          const parsed = JSON.parse(resultStr) as Record<string, unknown>;
          if (parsed.formatted_html) {
            delete parsed.formatted_html;
            resultForModel = JSON.stringify(parsed);
          }
        } catch {
          /* no es JSON */
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: resultForModel,
        });
      }

      // En Anthropic, los tool_results van como un mensaje `user`
      history.push({ role: 'user', content: toolResults });
    }

    return collected.join('\n');
  }

  /** Limpia historial corrupto y reintenta con historial vacío */
  private async retryWithFreshHistory(
    chatId: number,
    userText: string,
  ): Promise<string> {
    this.logger.warn(
      `Historial corrupto para chat ${chatId}. Limpiando y reintentando...`,
    );
    conversations.delete(chatId);
    try {
      await this.db.query('DELETE FROM historial_mensajes WHERE chat_id = $1', [
        chatId,
      ]);
    } catch (e) {
      this.logger.error(`Error cleaning history: ${e}`);
    }

    const systemPrompt = await buildSystem(chatId, this.db);
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOLS,
      messages: [{ role: 'user', content: userText }],
    });

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    const finalText = textBlocks
      .map((b) => b.text)
      .join('')
      .trim();

    if (finalText) {
      conversations.set(chatId, [
        { role: 'user', content: userText },
        { role: 'assistant', content: response.content },
      ]);
      await this.persistMessage(chatId, 'user', userText);
      await this.persistMessage(chatId, 'assistant', finalText);
    }
    return finalText;
  }

  /**
   * Punto de entrada público: procesa un mensaje y devuelve la respuesta del agente.
   */
  async chat(chatId: number, userText: string): Promise<string> {
    try {
      const { rows } = await this.db.query(
        `SELECT 1 FROM chats_pausados
         WHERE chat_id = $1 AND reanudado_en IS NULL
         LIMIT 1`,
        [chatId],
      );

      if ((rows as unknown[]).length > 0) {
        // Chat en modo humano: guardar el mensaje del usuario silenciosamente
        // y notificar al panel admin por WebSocket. La IA no responde.
        await this.persistMessage(chatId, 'user', userText);

        // Sincronizar historial en memoria para cuando se reanude
        try {
          const history = await this.loadHistoryIfEmpty(chatId);
          history.push({ role: 'user', content: userText });
          if (history.length > 50) history.splice(0, history.length - 50);
        } catch (e) {
          this.logger.warn(`No se pudo sincronizar historial: ${e}`);
        }

        // Notificar al panel admin en tiempo real (best-effort)
        try {
          this.chatGateway?.emitUserMessage?.(chatId, {
            chat_id: chatId,
            role: 'user',
            content: userText,
          });
        } catch (e) {
          this.logger.warn(`No se pudo emitir WebSocket user-message: ${e}`);
        }

        this.logger.log(
          `Chat ${chatId} pausado. Mensaje del usuario guardado.`,
        );
        return '';
      }

      return await this.runAgentCore(chatId, userText);
    } catch (e) {
      const errStr = String(e);
      if (errStr.includes('valid list') || errStr.includes('400')) {
        try {
          return await this.retryWithFreshHistory(chatId, userText);
        } catch (retryErr) {
          this.logger.error(`Retry failed: ${retryErr}`);
          throw new Error(
            'Ocurrió un error procesando tu mensaje. Por favor intenta de nuevo.',
          );
        }
      }
      this.logger.error(`Agent error: ${e}`);
      throw e;
    }
  }
}
