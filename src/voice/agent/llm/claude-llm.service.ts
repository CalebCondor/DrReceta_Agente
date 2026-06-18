import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { client, ANTHROPIC_MODEL } from '../../../agent/state';
import { TOOLS } from '../../../agent/tools';
import { executeTool } from '../../../agent/executor';
import { DbService } from '../../../agent/db.service';
import { buildSystem } from '../../../agent/system';
import { voiceSystemExtras } from '../prompts/voice-system.es-ES';

/**
 * Servicio que envuelve el SDK de Anthropic y ejecuta el loop de tool calling
 * reutilizando exactamente el flujo de `AgentService.runAgentCore` del agente
 * de chat existente.
 *
 * Diferencias vs el agente de chat:
 *   - Devuelve `text` + lista de tools ejecutadas (en vez de solo texto)
 *   - El system prompt se extiende con reglas de voz
 *   - Pensado para ser invocado por el adapter LiveKit, no por HTTP
 *
 * No modifica el agente de chat ni sus tools; las reutiliza 100%.
 */
@Injectable()
export class ClaudeLlmService {
  private readonly logger = new Logger(ClaudeLlmService.name);

  constructor(private readonly db: DbService) {}

  /**
   * Ejecuta un turno completo: convierte el ChatContext de LiveKit a mensajes
   * Anthropic, llama a Claude, ejecuta tools si las pide, itera hasta tener
   * respuesta final (o 10 rondas).
   */
  async runTurn(
    chatId: number,
    chatCtx: Anthropic.MessageParam[],
  ): Promise<{
    text: string;
    toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
    rounds: number;
  }> {
    const messages: Anthropic.MessageParam[] = this.normalize(chatCtx);
    const collected: string[] = [];
    const toolCalls: Array<{
      name: string;
      input: Record<string, unknown>;
    }> = [];
    let rounds = 0;

    for (let round = 0; round < 10; round++) {
      rounds = round + 1;
      const systemPrompt =
        (await buildSystem(chatId, this.db, undefined)) +
        '\n\n' +
        voiceSystemExtras();

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
        if (finalText) collected.push(finalText);
        break;
      }

      // Persistir turno del assistant (con tool_uses)
      await this.persist(chatId, 'assistant', response.content);
      messages.push({ role: 'assistant', content: response.content });

      // Ejecutar cada tool
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        toolCalls.push({
          name: tu.name,
          input: tu.input as Record<string, unknown>,
        });
        this.logger.log(
          `[chat ${chatId}] tool=${tu.name} input=${JSON.stringify(tu.input)}`,
        );
        const resultStr = await executeTool(
          tu.name,
          tu.input as Record<string, unknown>,
          chatId,
          this.db,
        );
        this.logger.log(`[chat ${chatId}] result=${resultStr.slice(0, 200)}`);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: resultStr,
        });
      }

      await this.persist(chatId, 'user', toolResults);
      messages.push({ role: 'user', content: toolResults });
    }

    return {
      text: collected.join('\n').trim(),
      toolCalls,
      rounds,
    };
  }

  /**
   * Normaliza mensajes al formato que Anthropic espera:
   * - Asistente: content debe ser array con text/tool_use blocks
   * - User: content debe ser string o array con text/tool_result blocks
   * - Elimina tool_use huérfanos (sin tool_result siguiente)
   */
  private normalize(msgs: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
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

    // Drop tool_use sin tool_result siguiente
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
            this.logger.warn('Dropped orphaned tool_use');
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
            this.logger.warn('Dropped orphaned tool_result');
            continue;
          }
        }
      }
      result.push(m);
    }
    return result;
  }

  private async persist(
    chatId: number,
    role: 'user' | 'assistant' | 'system',
    content: Anthropic.MessageParam['content'],
  ): Promise<void> {
    try {
      await this.db.query(
        'INSERT INTO historial_mensajes (chat_id, role, content) VALUES ($1, $2, $3)',
        [chatId, role, JSON.stringify(content)],
      );
    } catch (e) {
      this.logger.error(`persist failed: ${String(e)}`);
    }
  }
}
