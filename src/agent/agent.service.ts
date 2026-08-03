// src/agent/agent.service.ts
// Núcleo del agente MiniMax (OpenAI-compatible), desacoplado de cualquier transporte

import { Injectable, Logger } from '@nestjs/common';
import {
  callMiniMax,
  MINIMAX_MODEL,
  conversations,
  minimaxConversations,
  MiniMaxMessage,
  MiniMaxToolCall,
  // USE_ANTHROPIC, // Claude deshabilitado por ahora — solo MiniMax
} from './state';
import { TOOLS } from './tools';
import { executeTool } from './executor';
import { buildSystem } from './system';
import { DbService } from './db.service';
import { ChatGateway } from '../chat/chat.gateway';

/**
 * Extrae la respuesta final dirigida al usuario.
 * Estrategia estructural: el modelo DEBE envolver su respuesta real en
 * `<respuesta>...</respuesta>`. Si encuentra los tags, devuelve el contenido
 * entre ellos (que es lo único que verá el usuario). Si el modelo no usó
 * los tags, hace fallback a stripInternalReasoning (limpieza por patrones).
 *
 * Esto es robusto frente a que el modelo "piense en voz alta" en infinitas
 * formas antes de la respuesta: el contenido FUERA de los tags se descarta
 * siempre, sin importar lo que contenga.
 */
function extractFinalResponse(text: string): string {
  if (!text) return text;
  // Regex tolerante:
  //   - <\s*respuesta\s*>  → tolera saltos/espacios DENTRO del tag de apertura
  //     (ej. "<\nrespuesta>" o "< respuesta >")
  //   - (?:<\s*\/\s*respuesta\s*>|$) → cierra con </respuesta> (también tolerante)
  //     O si no hay cierre, captura hasta el final del texto
  //   - [\s\S]*?  → no codicioso: toma el primer bloque desde el <respuesta>
  const re = /<\s*respuesta\s*>([\s\S]*?)(?:<\s*\/\s*respuesta\s*>|$)/i;
  const match = text.match(re);
  if (match && match[1]) {
    const inner = match[1].trim();
    // Si el modelo puso el cierre pero dejó contenido meta DESPUÉS de </respuesta>,
    // el match ya solo toma lo de adentro, así que está limpio.
    if (inner) return inner;
  }
  return stripInternalReasoning(text);
}

/**
 * Quita del texto cualquier párrafo inicial que parezca razonamiento interno
 * del modelo (planificación, meta-comentarios, narración de herramientas, etc.)
 * antes de la respuesta real dirigida al usuario. Usado como fallback de
 * extractFinalResponse cuando el modelo no envolvió su respuesta en tags.
 */
function stripInternalReasoning(text: string): string {
  if (!text) return text;
  const internalPatterns: RegExp[] = [
    // Tercera persona sobre el usuario (inglés)
    /^the users?\b/i,
    // Primera persona planificando (inglés)
    /^i (should|will|need|can|must|already|just|also|notice|see|think|believe|want|have|had|'ll|'ve|'d|am|was|to)\b/i,
    /^i\b/i,
    // "Let me" / "Let's"
    /^let(?:'s| me)\b/i,
    // Transiciones/meta al inicio (inglés)
    /^actually[,\s]/i,
    /^looking (?:at|into)\b/i,
    /^note (?:that|:)\b/i,
    /^wait[,\s]/i,
    /^so[,\s]/i,
    /^now[,\s]/i,
    /^first[,\s]/i,
    /^remember\b/i,
    /^okay[,\s]/i,
    /^alright[,\s]/i,
    /^additionally\b/i,
    /^furthermore\b/i,
    /^moreover\b/i,
    /^in this case\b/i,
    /^for this\b/i,
    /^this means\b/i,
    /^based on\b/i,
    /^according to\b/i,
    /^since\b/i,
    // Menciones de herramientas/sistema
    /^the tool\b/i,
    /^the knowledge\b/i,
    /^the search\b/i,
    /^the system\b/i,
    /^the prompt\b/i,
    // Equivalentes en español
    /^voy a\b/i,
    /^debería\b/i,
    /^debo\b/i,
    /^el usuario\b/i,
    /^según\b/i,
    /^la herramienta\b/i,
    /^la base de\b/i,
    /^te informo que\b/i,
    // Otros
    /without narrating/i,
    /internal process/i,
    // Meta-planificación / recitado de instrucciones del system prompt
    /^tags\s*$/i,
    /^be brief\b/i,
    /^be friendly\b/i,
    /^let me craft\b/i,
    /^let me write\b/i,
    /^craft a\b/i,
    /^i need to craft\b/i,
    /^i need to write\b/i,
    /^draft (?:a|the)\b/i,
  ];
  const lines = text.split('\n');
  let start = 0;
  while (start < lines.length) {
    const line = lines[start].trim();
    if (line === '') {
      start++;
      continue;
    }
    if (internalPatterns.some((p) => p.test(line))) {
      start++;
      continue;
    }
    break;
  }
  return lines.slice(start).join('\n').trim();
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly db: DbService,
    private readonly chatGateway: ChatGateway,
  ) {}

  /** Convierte la definición Anthropic de tools al formato OpenAI-compatible usado por MiniMax */
  private toOpenAITools(): Array<Record<string, unknown>> {
    return TOOLS.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  /** Carga el historial desde la base de datos si la memoria en vivo está vacía */
  private async loadHistoryIfEmpty(chatId: number): Promise<MiniMaxMessage[]> {
    if (!minimaxConversations.has(chatId)) {
      try {
        const { rows } = await this.db.query(
          'SELECT role, content FROM historial_mensajes WHERE chat_id = $1 ORDER BY created_at ASC LIMIT 50',
          [chatId],
        );
        const history: MiniMaxMessage[] = rows.map(
          (r: { role: string; content: unknown }) => {
            const role: MiniMaxMessage['role'] =
              r.role === 'assistant'
                ? 'assistant'
                : r.role === 'tool'
                  ? 'tool'
                  : 'user';
            let content: string = '';
            if (typeof r.content === 'string') {
              try {
                const parsed = JSON.parse(r.content) as unknown;
                content =
                  typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
              } catch {
                content = r.content;
              }
            } else if (r.content !== null && r.content !== undefined) {
              content = JSON.stringify(r.content);
            }
            return { role, content };
          },
        );
        minimaxConversations.set(chatId, history);
      } catch (e) {
        this.logger.error(`Error loading history for ${chatId}: ${e}`);
        minimaxConversations.set(chatId, []);
      }
    }
    return minimaxConversations.get(chatId)!;
  }

  /**
   * Normaliza mensajes MiniMax persistidos: descarta entradas corruptas
   * y conserva el orden conversacional.
   */
  private normalizeMessages(msgs: MiniMaxMessage[]): MiniMaxMessage[] {
    return msgs.filter(
      (m) =>
        m && (m.role === 'user' || m.role === 'assistant' || m.role === 'tool'),
    );
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
    msgs: Array<{ role: 'user' | 'assistant' | 'tool'; content: unknown }>,
  ): void {
    const history = minimaxConversations.get(chatId) ?? [];
    for (const m of msgs) {
      const content =
        typeof m.content === 'string'
          ? m.content
          : m.content === null || m.content === undefined
            ? ''
            : JSON.stringify(m.content);
      history.push({ role: m.role, content });
    }
    if (history.length > 50) history.splice(0, history.length - 50);
    minimaxConversations.set(chatId, history);
  }

  /**
   * Núcleo del agente. Desacoplado del transporte.
   * Devuelve el texto final consolidado.
   */
  private async runAgentCore(
    chatId: number,
    userText: string,
  ): Promise<string> {
    const history = await this.loadHistoryIfEmpty(chatId);

    history.push({ role: 'user', content: userText });
    if (history.length > 50) history.splice(0, history.length - 50);
    await this.persistMessage(chatId, 'user', userText);

    const messages: MiniMaxMessage[] = this.normalizeMessages([...history]);
    const collected: string[] = [];
    const tools = this.toOpenAITools();

    for (let round = 0; round < 10; round++) {
      const systemPrompt = await buildSystem(chatId, this.db);
      const apiMessages: MiniMaxMessage[] = [
        { role: 'system', content: systemPrompt },
        ...messages,
      ];

      // Rama Anthropic deshabilitada por ahora — solo MiniMax
      // const response = USE_ANTHROPIC
      //   ? (() => {
      //       throw new Error(
      //         'Rama Anthropic no implementada en este cambio — define el bucle con client.messages.create y la API nativa de Anthropic',
      //       );
      //     })()
      //   :
      const response = await callMiniMax({
        model: MINIMAX_MODEL,
        messages: apiMessages,
        tools,
        tool_choice: 'auto',
      });

      const choice = response.choices?.[0];
      if (!choice) {
        this.logger.error(
          `MiniMax response without choices: ${JSON.stringify(response)}`,
        );
        return collected.join('\n');
      }

      const assistantMessage = choice.message;
      const toolCalls: MiniMaxToolCall[] = assistantMessage.tool_calls ?? [];
      const assistantText = (assistantMessage.content ?? '').toString().trim();

      // Diagnóstico: ¿la API separó el razonamiento en reasoning_details?
      // Si está presente y es no-vacío, el `content` debería venir limpio.
      const reasoningDetails = assistantMessage.reasoning_details;
      if (Array.isArray(reasoningDetails) && reasoningDetails.length > 0) {
        const len = reasoningDetails.reduce(
          (acc, d) => acc + (typeof d?.text === 'string' ? d.text.length : 0),
          0,
        );
        this.logger.log(
          `[MiniMax] reasoning_split OK: ${reasoningDetails.length} bloques, ${len} chars separados. content.length=${assistantText.length}`,
        );
      } else if (assistantText.length > 200) {
        // No hay reasoning_details y el content es largo → puede tener
        // razonamiento filtrado; el post-procesado lo limpiará.
        this.logger.debug(
          `[MiniMax] reasoning_split NO presente. content.length=${assistantText.length}`,
        );
      }

      if (toolCalls.length === 0) {
        const cleanText = extractFinalResponse(assistantText);
        const fallback = collected.join('\n');
        const textToSave = cleanText || fallback;
        if (textToSave) {
          collected.push(textToSave);
          const assistantPersist = {
            role: 'assistant' as const,
            content: textToSave,
          };
          this.appendToHistory(chatId, [assistantPersist]);
          await this.persistMessage(chatId, 'assistant', textToSave);
        } else if (assistantText) {
          this.logger.warn(
            `Respuesta del modelo quedó vacía tras extracción para chat ${chatId}.`,
          );
        }
        return collected.join('\n');
      }

      const assistantForHistory: MiniMaxMessage = {
        role: 'assistant',
        content: assistantText || null,
        tool_calls: toolCalls,
      };
      messages.push(assistantForHistory);
      this.appendToHistory(chatId, [
        { role: 'assistant', content: assistantText || '' },
      ]);
      // No persistimos el assistant intermedio con tool_calls: solo guardamos
      // el mensaje del usuario y la respuesta final del asistente en la DB.

      for (const tc of toolCalls) {
        this.logger.log(
          `tool=${tc.function.name} input=${tc.function.arguments}`,
        );

        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments || '{}') as Record<
            string,
            unknown
          >;
        } catch (e) {
          this.logger.warn(
            `Invalid JSON in tool args for ${tc.function.name}: ${e}`,
          );
        }

        const resultStr = await executeTool(
          tc.function.name,
          parsedArgs,
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

        // Strip formatted_html antes de devolver a MiniMax (ya capturado)
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

        const toolMsg: MiniMaxMessage = {
          role: 'tool',
          name: tc.function.name,
          tool_call_id: tc.id,
          content: resultForModel,
        };
        messages.push(toolMsg);
        this.appendToHistory(chatId, [
          { role: 'tool', content: resultForModel },
        ]);
        // No persistimos los tool results: solo mensaje del usuario y respuesta final.
      }
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
    minimaxConversations.delete(chatId);
    conversations.delete(chatId);
    try {
      await this.db.query('DELETE FROM historial_mensajes WHERE chat_id = $1', [
        chatId,
      ]);
    } catch (e) {
      this.logger.error(`Error cleaning history: ${e}`);
    }

    const freshMessages: MiniMaxMessage[] = [
      { role: 'user', content: userText },
    ];
    const systemPrompt = await buildSystem(chatId, this.db);
    // Rama Anthropic deshabilitada por ahora — solo MiniMax
    // const response = USE_ANTHROPIC
    //   ? (() => {
    //       throw new Error(
    //         'Rama Anthropic no implementada en este cambio — define el bucle con client.messages.create y la API nativa de Anthropic',
    //       );
    //     })()
    //   :
    const response = await callMiniMax({
      model: MINIMAX_MODEL,
      messages: [{ role: 'system', content: systemPrompt }, ...freshMessages],
      tools: this.toOpenAITools(),
      tool_choice: 'auto',
    });

    const rawText = (response.choices?.[0]?.message?.content ?? '')
      .toString()
      .trim();
    const finalText = extractFinalResponse(rawText);
    const textToSave = finalText;

    if (textToSave) {
      minimaxConversations.set(chatId, [
        { role: 'user', content: userText },
        { role: 'assistant', content: textToSave },
      ]);
      await this.persistMessage(chatId, 'user', userText);
      await this.persistMessage(chatId, 'assistant', textToSave);
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
