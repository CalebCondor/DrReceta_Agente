// src/agent/agent.service.ts
// Núcleo del agente Claude, desacoplado de cualquier transporte

import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { client, ANTHROPIC_MODEL, conversations } from './state';
import { TOOLS } from './tools';
import { executeTool } from './executor';
import { buildSystem } from './system';
import { DbService } from './db.service';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(private readonly db: DbService) {}

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
        const history = rows.map(
          (r: { role: 'user' | 'assistant'; content: unknown }) => {
            let content = r.content;
            if (typeof content === 'string') {
              try {
                content = JSON.parse(content) as unknown;
              } catch {
                /* texto plano legado */
              }
            }
            return { role: r.role, content } as Anthropic.MessageParam;
          },
        );
        conversations.set(chatId, history);
      } catch (e) {
        this.logger.error(`Error loading history for ${chatId}: ${e}`);
        conversations.set(chatId, []);
      }
    }
    return conversations.get(chatId)!;
  }

  /**
   * Elimina pares tool_use/tool_result huérfanos y normaliza todo content a string o array.
   * Anthropic rechaza: content null/undefined/object-no-array, y tool_use sin su tool_result.
   */
  private normalizeMessages(
    msgs: Anthropic.MessageParam[],
  ): Anthropic.MessageParam[] {
    // Paso 1: normalizar content de cada mensaje individualmente
    const fixed = msgs.map((m) => {
      let content: Anthropic.MessageParam['content'] = m.content;

      if (content === null || content === undefined) {
        content = m.role === 'assistant' ? [] : '';
      }

      if (!Array.isArray(content) && typeof content === 'object') {
        content = [
          content as Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam,
        ];
      }

      if (m.role === 'assistant' && typeof content === 'string') {
        content = [{ type: 'text' as const, text: content }];
      }

      return { role: m.role, content } as Anthropic.MessageParam;
    });

    // Paso 2: eliminar pares huérfanos
    const result: Anthropic.MessageParam[] = [];
    for (let i = 0; i < fixed.length; i++) {
      const m = fixed[i];

      if (m.role === 'assistant' && Array.isArray(m.content)) {
        const hasToolUse = m.content.some(
          (b) =>
            typeof b === 'object' &&
            b !== null &&
            'type' in b &&
            b.type === 'tool_use',
        );
        if (hasToolUse) {
          const next = fixed[i + 1];
          const nextHasResult =
            next?.role === 'user' &&
            Array.isArray(next.content) &&
            next.content.some(
              (b) =>
                typeof b === 'object' &&
                b !== null &&
                'type' in b &&
                b.type === 'tool_result',
            );
          if (!nextHasResult) {
            this.logger.warn('Dropped orphaned tool_use assistant message');
            continue;
          }
        }
      }

      if (m.role === 'user' && Array.isArray(m.content)) {
        const hasToolResult = m.content.some(
          (b) =>
            typeof b === 'object' &&
            b !== null &&
            'type' in b &&
            b.type === 'tool_result',
        );
        if (hasToolResult) {
          const prev = result[result.length - 1];
          const prevHasToolUse =
            prev?.role === 'assistant' &&
            Array.isArray(prev.content) &&
            prev.content.some(
              (b) =>
                typeof b === 'object' &&
                b !== null &&
                'type' in b &&
                b.type === 'tool_use',
            );
          if (!prevHasToolUse) {
            this.logger.warn('Dropped orphaned tool_result user message');
            continue;
          }
        }
      }

      result.push(m);
    }

    return result;
  }

  /** Guarda un mensaje en la base de datos */
  private async persistMessage(
    chatId: number,
    role: string,
    content: any,
  ): Promise<void> {
    try {
      await this.db.query(
        'INSERT INTO historial_mensajes (chat_id, role, content) VALUES ($1, $2, $3)',
        [chatId, role, JSON.stringify(content)],
      );
    } catch (e) {
      this.logger.error(`Error persisting message: ${e}`);
    }
  }

  /**
   * Núcleo del agente. Desacoplado del transporte.
   * Devuelve el texto final consolidado.
   */
  private async runAgentCore(
    chatId: number,
    userText: string,
    userName?: string,
  ): Promise<string> {
    const history = await this.loadHistoryIfEmpty(chatId);
    history.push({ role: 'user', content: userText });
    await this.persistMessage(chatId, 'user', userText);
    if (history.length > 50) history.splice(0, history.length - 50);

    const messages: Anthropic.MessageParam[] = this.normalizeMessages([
      ...history,
    ]);
    const collected: string[] = [];

    for (let round = 0; round < 10; round++) {
      const systemPrompt = await buildSystem(chatId, this.db, userName);
      const response = await client.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      });

      const textBlocks = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text);

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      if (toolUses.length === 0) {
        const finalText = textBlocks.join('\n').trim();
        if (finalText) {
          const finalContent: Anthropic.TextBlockParam[] = [
            { type: 'text', text: finalText },
          ];
          history.push({ role: 'assistant', content: finalContent });
          await this.persistMessage(chatId, 'assistant', finalContent);
          collected.push(finalText);
        }
        return collected.join('\n');
      }

      messages.push({ role: 'assistant', content: response.content });
      history.push({ role: 'assistant', content: response.content });
      await this.persistMessage(chatId, 'assistant', response.content);

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        this.logger.log(`tool=${tu.name} input=${JSON.stringify(tu.input)}`);
        const resultStr = await executeTool(
          tu.name,
          tu.input as Record<string, unknown>,
          chatId,
          this.db,
        );
        this.logger.log(`result=${resultStr.slice(0, 200)}`);

        // Si la herramienta devuelve formatted_html, capturarlo
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

        // Strip formatted_html antes de devolver a Claude (ya capturado)
        let resultForClaude = resultStr;
        try {
          const parsed = JSON.parse(resultStr) as Record<string, unknown>;
          if (parsed.formatted_html) {
            delete parsed.formatted_html;
            resultForClaude = JSON.stringify(parsed);
          }
        } catch {
          /* no es JSON */
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: resultForClaude,
        });
      }
      messages.push({ role: 'user', content: toolResults });
      history.push({ role: 'user', content: toolResults });
      await this.persistMessage(chatId, 'user', toolResults);
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

    const freshMessages: Anthropic.MessageParam[] = [
      { role: 'user', content: userText },
    ];
    const systemPrompt = await buildSystem(chatId, this.db);
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      tools: TOOLS,
      messages: freshMessages,
    });
    const finalText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (finalText) {
      conversations.set(chatId, [
        { role: 'user', content: userText },
        { role: 'assistant', content: [{ type: 'text', text: finalText }] },
      ]);
      await this.persistMessage(chatId, 'user', userText);
      await this.persistMessage(chatId, 'assistant', [
        { type: 'text', text: finalText },
      ]);
    }
    return finalText;
  }

  /**
   * Punto de entrada público: procesa un mensaje y devuelve la respuesta del agente.
   */
  async chat(
    chatId: number,
    userText: string,
    userName?: string,
  ): Promise<string> {
    try {
      return await this.runAgentCore(chatId, userText, userName);
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
