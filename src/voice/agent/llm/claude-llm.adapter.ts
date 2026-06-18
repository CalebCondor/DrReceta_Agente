import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { ClaudeLlmService } from './claude-llm.service';

/**
 * Helper que toma un ChatContext de LiveKit y lo convierte al formato
 * MessageParam[] de Anthropic. No es trivial porque LiveKit usa una
 * estructura distinta (ChatRole, ChatItem con varios tipos, etc.).
 *
 * Para mantener la integración simple, en este adapter asumimos que el
 * caller nos pasa un array plano de mensajes ya formateados, accedido vía
 * `chatCtx.items`. Si en el futuro hace falta mapear ChatItem más complejos
 * (function calls, audio, etc.), se agrega acá.
 */
function chatCtxToMessages(chatCtx: unknown): Anthropic.MessageParam[] {
  const ctx = chatCtx as { items?: Array<{ role: string; content: unknown }> };
  if (!ctx?.items || !Array.isArray(ctx.items)) return [];

  const out: Anthropic.MessageParam[] = [];
  for (const item of ctx.items) {
    if (item.role === 'system') continue; // system va aparte
    if (item.role === 'user' || item.role === 'assistant') {
      // content puede ser string o array de {type, text} blocks
      if (typeof item.content === 'string') {
        out.push({
          role: item.role,
          content: item.content,
        });
      } else if (Array.isArray(item.content)) {
        // Simplificación: concatenar text blocks
        const text = (item.content as unknown[])
          .map((b: unknown) => {
            if (
              typeof b === 'object' &&
              b !== null &&
              'type' in b &&
              (b as { type: string }).type === 'text' &&
              'text' in b
            ) {
              return (b as { text: string }).text;
            }
            return '';
          })
          .join('')
          .trim();
        if (text) {
          out.push({
            role: item.role,
            content: text,
          });
        }
      }
    } else if (item.role === 'tool') {
      // Tool result messages (LiveKit usa role 'tool' o 'user' con tool_result blocks)
      // Anthropic requiere role: 'user' con tool_result blocks
      if (Array.isArray(item.content)) {
        const blocks = item.content as unknown[];
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const b of blocks) {
          if (
            typeof b === 'object' &&
            b !== null &&
            'type' in b &&
            (b as { type: string }).type === 'tool_result'
          ) {
            const blk = b as {
              tool_call_id?: string;
              toolUseId?: string;
              content?: unknown;
              output?: unknown;
            };
            toolResults.push({
              type: 'tool_result',
              tool_use_id: blk.tool_call_id ?? blk.toolUseId ?? '',
              content:
                typeof blk.content === 'string'
                  ? blk.content
                  : JSON.stringify(blk.content ?? blk.output ?? ''),
            });
          }
        }
        if (toolResults.length > 0) {
          out.push({ role: 'user', content: toolResults });
        }
      }
    }
  }
  return out;
}

export interface ClaudeLlmStreamHandle {
  label: string;
  close(): void;
  [Symbol.asyncIterator](): ClaudeLlmStreamHandle;
  next(): Promise<IteratorResult<any>>;
}

/**
 * Crea un stream async-iterable que envuelve ClaudeLlmService y emite
 * ChatChunks compatibles con el pipeline de LiveKit Agents.
 *
 * Como con STT/TTS, evitamos extender directamente la clase base `LLM` de
 * LiveKit por los problemas de #private brand fields; el wrapper expone la
 * misma API (label, chat() → AsyncIterable<ChatChunk>) y se puede enchufar
 * al pipeline vía wrapper si hace falta.
 */
export function createClaudeLlmStream(
  service: ClaudeLlmService,
  chatId: number,
  chatCtx: unknown,
): ClaudeLlmStreamHandle {
  const queue: unknown[] = [];
  let closed = false;
  const END: unique symbol = Symbol('END_LLM_STREAM');
  const logger = new Logger('ClaudeLlmStream');

  void (async () => {
    try {
      const messages = chatCtxToMessages(chatCtx);
      if (messages.length === 0) {
        logger.warn('Empty chatCtx, emitting empty chunk');
        queue.push({
          id: `llm-${Date.now()}`,
          delta: { role: 'assistant' as const, content: '' },
        });
        queue.push(END);
        return;
      }

      const result = await service.runTurn(chatId, messages);
      logger.log(
        `[chat ${chatId}] turn done rounds=${result.rounds} tools=${result.toolCalls.length} textLen=${result.text.length}`,
      );

      // Emitir tool calls ejecutadas (para métricas del pipeline)
      for (let i = 0; i < result.toolCalls.length; i++) {
        const tc = result.toolCalls[i];
        queue.push({
          id: `llm-${Date.now()}-tool-${i}`,
          delta: {
            role: 'assistant' as const,
            toolCalls: [
              {
                id: `tc-${i}-${Date.now()}`,
                callId: `tc-${i}-${Date.now()}`,
                name: tc.name,
                arguments: JSON.stringify(tc.input),
              },
            ],
          },
        });
      }

      // Emitir texto final como un solo chunk
      if (result.text) {
        queue.push({
          id: `llm-${Date.now()}-text`,
          delta: { role: 'assistant' as const, content: result.text },
        });
      } else {
        // Fallback si Claude solo llamó tools sin texto
        queue.push({
          id: `llm-${Date.now()}-fallback`,
          delta: {
            role: 'assistant' as const,
            content: 'Listo, ¿algo más en lo que pueda ayudarte?',
          },
        });
      }
      queue.push(END);
    } catch (e) {
      logger.error(`LLM stream failed: ${String(e)}`);
      queue.push({
        id: `llm-${Date.now()}-error`,
        delta: {
          role: 'assistant' as const,
          content: 'Disculpa, tuve un problema técnico. ¿Puedes repetir?',
        },
      });
      queue.push(END);
    }
  })();

  const handle: ClaudeLlmStreamHandle = {
    label: 'claude-llm-stream',
    close() {
      closed = true;
    },
    [Symbol.asyncIterator]() {
      return handle;
    },
    async next(): Promise<IteratorResult<any>> {
      if (closed && queue.length === 0) {
        return { value: undefined, done: true };
      }
      while (queue.length === 0) {
        await new Promise<void>((r) => setTimeout(r, 5));
        if (closed && queue.length === 0) {
          return { value: undefined, done: true };
        }
      }
      const v = queue.shift()!;
      if (v === END) {
        return { value: undefined, done: true };
      }
      return { value: v, done: false };
    },
  };
  return handle;
}

/**
 * Adapter LLM con la API que LiveKit Agents espera. Lo exportamos para
 * que el pipeline de LiveKit pueda usarlo si en el futuro migramos del
 * enfoque wrapper a la integración nativa.
 */
export class ClaudeLlmAdapter {
  readonly label = 'claude-anthropic';
  readonly model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5';
  readonly provider = 'anthropic';
  private readonly logger = new Logger(ClaudeLlmAdapter.name);
  private readonly service: ClaudeLlmService;

  constructor(service: ClaudeLlmService) {
    this.service = service;
  }

  /**
   * `chat()` retorna un stream async-iterable. Acepta el chatCtx de LiveKit
   * directamente.
   */
  chat(opts: { chatCtx: unknown; toolCtx?: unknown }): ClaudeLlmStreamHandle {
    // chatId por hash del phone number — el caller debe inyectarlo
    // vía el `extra` del chatCtx o setearlo antes. En este adapter básico
    // usamos 0 como placeholder; el pipeline real (Fase 8) lo va a inyectar.
    const ctx = opts.chatCtx as { extra?: { chatId?: number } } | undefined;
    const chatId = ctx?.extra?.chatId ?? 0;
    return createClaudeLlmStream(this.service, chatId, opts.chatCtx);
  }
}
