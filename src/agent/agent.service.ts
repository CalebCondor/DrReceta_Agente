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
import { buildSystem, containsUnverifiedClaims, ToolStatus } from './system';
import { DbService } from './db.service';
import { ChatGateway } from '../chat/chat.gateway';

/**
 * Limpia texto generado por el assistant eliminando:
 *   • Bloques `<pre>...</pre>` completos (multilínea).
 *   • Frases prohibidas específicas que el modelo imita desde su historial
 *     viejo aunque el system prompt las prohíba (p.ej.: "Solo los hospitales
 *     X y Y registran actividad", "tasa de recuperación global").
 *   • Frases hechas tipo "Se observa que…", "En resumen…", "Como podemos
 *     ver…", "Esto sugiere que…", "En conclusión…".
 *   • Líneas finales sueltas que son solo interpretación (sin números) y
 *     quedaron tras una respuesta de datos.
 *
 * Se aplica al texto del assistant ANTES de:
 *   (a) pasarlo al modelo como parte del historial en `loadHistoryIfEmpty`,
 *       evitando que el modelo copie el formato viejo.
 *   (b) guardarlo en BD con `persistMessage`, evitando acumular más
 *       respuestas contaminadas.
 */
function sanitizeAssistantText(text: string): string {
  if (!text) return text;

  // 1) Eliminar TODO bloque <pre ...>...</pre> (incluso multilínea).
  let out = text.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, '');

  // 2) Eliminar frases hechas prohibidas (al inicio, en medio, o como
  //    línea completa). Coincide con tolerancia a mayúsculas iniciales y
  //    posibles caracteres intermedios.
  const forbiddenFragments: RegExp[] = [
    // Bloques genéricos
    /^.*\bSolo los hospitales? .*registran actividad\.?\s*$/gim,
    /^.*\bLos hospitales? .*no tienen datos\.?\s*$/gim,
    /^.*\btasa de recuperación\b.*$/gim,
    /^.*\btasa de aprobación\b.*$/gim,
    /^.*\btasa global\b.*$/gim,
    // Frases hechas
    /^.*\bSe observa que\b.*$/gim,
    /^.*\bEn resumen\b.*$/gim,
    /^.*\bComo podemos ver\b.*$/gim,
    /^.*\bEsto sugiere que\b.*$/gim,
    /^.*\bEn conclusión\b.*$/gim,
    /^.*\bNótese que\b.*$/gim,
    /^.*\bCabe destacar que\b.*$/gim,
    /^.*\bEs importante señalar que\b.*$/gim,
    // Filtraciones de tool calls / JSON crudo / tablas (NUNCA debe aparecer en respuesta al usuario)
    /^.*\bJSON crudo\b.*$/gim,
    /^.*\bAqui está el JSON\b.*$/gim,
    /^.*\bAquí está el JSON\b.*$/gim,
    /^.*\bEl sistema añadió\b.*$/gim,
    /^.*\bLa tabla (anterior|anterior|con|que se muestra)\b.*$/gim,
    /^.*\b(tabla con|tabla anterior|tabla arriba|tabla de arriba)\b.*$/gim,
    /^.*\bdevuelt[oa]s? por (la herramienta|el (endpoint|sistema|backend))\b.*$/gim,
    /^.*\b(raw|rawJson|rawjson|tool[_ ]?result)\b.*$/gi,
    /^.*\b(Respuesta|HTTP) (cruda|sin procesar)\b.*$/gim,
    // ANUNCIOS DE ACCIÓN SIN EJECUTAR (deben pasar por ANUNCIO_SIN_ACCION, pero
    // también los bloqueamos aquí para que el cliente no vea el texto filtrado).
    /^.*\bllamando( (a(l)?|del?))? (la |el |los |las )?(cat[áa]logo|hospitales?|planes?|herramienta|tool|endpoint|consulta|api)\b.*$/gim,
    /^.*\bconsultando( (a(l)?|del?))? (la |el |los |las )?(cat[áa]logo|hospitales?|planes?|herramienta|tool|endpoint|consulta|api)\b.*$/gim,
    /^.*\bejecutando( (la|el|los|las))? (consulta|tool|llamada|herramienta)\b.*$/gim,
    /^.*\biniciando (consulta|llamada)\b.*$/gim,
    /^.*\bobteniendo (datos|informaci[oó]n)\b.*$/gim,
    /^.*\bno puedo ejecutar( la consulta| la herramienta)?\b.*$/gim,
    /^.*\bcon (los|las|tus) filtros (de |de la )(consulta|pregunta|solicitud) anterior\b.*$/gim,
    /^.*\busando (los|las) (mismos|anteriores) filtros\b.*$/gim,
    // AFIRMAR RESULTADOS SIN HABER LLAMADO A UNA TOOL
    /^.*\bno (tengo|hay|existen) (resultados?|datos?)\b.*$/gim,
    /^.*\b(no se|pude) (obtener|conseguir) (datos?|resultados?)\b.*$/gim,
    /^.*\bla consulta (no|no ha) (devolvi[oó]|retorn[oó]|tuvo)\b.*$/gim,
    // RENDICIÓN: ofrecer "calcular" o "confirmar" en vez de mostrar el dato
    /^.*\b¿(prefieres|quieres|deseas) (que (calcule|te calcule|calcule|usemos|yo)|calcule|que confirme)\b.*$/gim,
    /^.*\bpara (responder|consultar) con datos v[aá]lidos[, ]+(¿(prefieres|quieres)|qu[eé])\b.*$/gim,
    /^.*\b(no dispongo|no cuento) de (una )?herramienta(s)? que (devuelvan?|de) (directamente|el campo)\b.*$/gim,
    /^.*\bno (dispongo|cuento) de (un|una|el|los|las)?\s*(campo|herramienta|tool|funci[oó]n) (directo|directamente|que|para|que devuelva)\b.*$/gim,
    /^.*\b(no dispongo|no cuento) de (un|una|el|los|las)?\s*campo (directo|directamente|llamado)\b.*$/gim,
    // FÓRMULA DENEGADO − RECUPERADO (prohibida — solo aplica a dinero, no a días)
    /^.*\b(aplicando|usando) (la )?f[oó]rmula (DENEGADO|APROBADO)\s*[\-−]\s*(RECUPERADO|DENEGADO)\b.*$/gim,
    /^.*\bDENEGADO\s*[\-−]\s*RECUPERADO\b.*$/gim,
    // PEDIR IDs AL USUARIO (NUNCA — el modelo debe mapear internamente con tools de catálogo)
    /^.*\b(ind[ií]came|indica|dame|dime|p[aá]same|m[aá]ndame|env[ií]ame|necesito|requiero|facil[ií]tame|comparte) (el |los )?(id|ID|Id|c[oó]digo|identificador)( (num[eé]rico|de (hospital|plan|hospitales|planes)))?\b.*$/gim,
    /^.*\b(¿)?(cu[aá]l|cu[aá]les) (es|son) (el|los) (id|ID|Id|c[oó]digo|identificador)( (num[eé]rico|de (hospital|plan|hospitales|planes)))?\??/gim,
    /^.*\b(id|ID) (del|de la) (hospital|plan|hospitales|planes)\b.*$/gim,
    /^.*\b(el|los) (id|ID) (del|de la|de los|de las) (hospital|plan|hospitales|planes)\b.*$/gim,
    /^.*\bpara identificar\b.*$/gim,
    /^.*\bID o nombre\b.*$/gim,
    /^.*\bnombre o ID\b.*$/gim,
    /^.*\bidentificador o nombre\b.*$/gim,
    /^.*\bnombre o identificador\b.*$/gim,
    /^.*\bID o n[uú]mero\b.*$/gim,
    /^.*\bn[uú]mero o ID\b.*$/gim,
    /^.*\b(?:[a[ñn]o|mes|periodo|per[ií]odo)\b.*\bID\b.*$/gim,
    /^.*\bID\b.*\b(?:[a[ñn]o|mes|periodo|per[ií]odo)\b.*$/gim,
    /^.*\bind[ií]came:?\s+.*\bID\b.*$/gim,
    /^.*\b(?:necesito|requiero|p[áa]same|comparte)[\s:]+\s*(?:el|los)?\s*(?:id|ID)\b.*$/gim,
    // PREGUNTAR POR EL AÑO (NUNCA — siempre se infiere currentYear)
    /^.*\b(¿)?(de qu[eé]|qu[eé]|para qu[eé]|en qu[eé]|a qu[eé]) (a[ñn]o|periodo|per[ií]odo)\b.*$/gim,
    /^.*\b(¿)?qu[eé] (a[ñn]o|periodo|per[ií]odo)\b.*$/gim,
    /^.*\b(ind[ií]came|indica|dame|dime) (el|el) a[ñn]o\b.*$/gim,
    /^.*\b(¿)?(de|a|para) cu[aá]l a[ñn]o\b.*$/gim,
    /^.*\b(¿)?(en|a) qu[eé] (a[ñn]o|periodo|per[ií]odo) (es|se|te refieres|dices|dijiste|mencionas)\b.*$/gim,
    /^.*\bel a[ñn]o en cuesti[oó]n\b.*$/gim,
    /^.*\b(?:ind[ií]came|indica|dame|dime)[:\s]+.*\ba[ñn]o\b.*$/gim,
    // PEDIR TIPO DE CONCEPTO (NUNCA — "concepto" en este contexto siempre = determinación adversa)
    /^.*\b(por|qu[eé]) (tipo de )?concepto\b.*$/gim,
    /^.*\b(qu[eé]|cu[aá]l) (tipo |clase de )?concepto\b.*$/gim,
    /^.*\b(¿)?(qu[eé]|cu[aá]l) (es|son) (el|los) (tipo |clase de )?concepto\b.*$/gim,
    // PEDIR CONFIRMACIÓN DE FILTROS INNECESARIA (el modelo ya tiene lo que necesita)
    /^.*\b(¿)?(qu[eé]|cu[aá]l) (filtros?|valores?|par[aá]metros?) (aplico|uso|utilizo|le pongo|debo usar|hay que usar)\b.*$/gim,
    /^.*\b(¿)?(qu[eé]|cu[aá]les) (aplico|uso|utilizo)\b.*$/gim,
    /^.*\baplicar (esos |estos |los )?filtros\b.*$/gim,
    /^.*\b(¿)?confirmo\b.*$/gim,
    /^.*\b(¿)?(qu[eé]) (te gustar[ií]a |quieres? |prefieres? )?aplicar\b.*$/gim,
    // DECIR QUE LA HERRAMIENTA NO SE PUEDE USAR (incorrecto, sí se puede)
    /^.*\bno (se puede|puede) usar (la herramienta|el endpoint|la api)\b.*$/gim,
    /^.*\b(la herramienta|el endpoint) (no funciona|no aplica|no soporta) (sin|si no (hay|tiene))\b.*$/gim,
    /^.*\bsin (filtro de )?(plan|mes|periodo|a[ñn]o).*no (se puede|puede)\b.*$/gim,
    // "Necesito que indiques/me digas/dé…"
    /^.*\bnecesito que (indiques?|me digas|me indiques?|proporciones?|me proporciones?|me (digas|des)|me confirmes)\b.*$/gim,
    /^.*\bnecesito (el |los |que me des |que me digas |saber )?(el|los|a[ñn]o|mes|periodo|plan|hospital|indicador|filtro|par[aá]metro)\b.*$/gim,
    /^.*\bpara (poder )?(consultar|responder|usar|llamar|ejecutar).*necesito\b.*$/gim,
    /^.*\b(indica|dime|dame|comparte) (el |los )?(a[ñn]o|mes|periodo|plan|hospital|indicador|filtro)\b.*$/gim,
    // RE-PEDIR FILTROS YA DISCUTIDOS EN LA CONVERSACIÓN
    /^.*\bpara (responder|consultar|poder (responder|consultar)) correctamente\b.*$/gim,
    /^.*\bconfirma (los |tus )?filtros\b.*$/gim,
    /^.*\bvuelve(?: a)? (confirmar|indicar|pedir|decirme|dame|solicitar)\b.*$/gim,
    /^.*\b(de nuevo|nuevamente) (confirma|indica|decime|dame)\b.*$/gim,
  ];
  for (const re of forbiddenFragments) {
    out = out.replace(re, '');
  }

  // 3) Eliminar porcentaje suelto pegado a "tasa" o "porcentaje":
  //    "...es del 8.0%."  o "...fue del 8%."
  out = out.replace(
    /(?:^|\s)(?:[A-ZÁÉÍÓÚÑ][^.\n]{2,160}?)\s+(?:es|fue|equivale a|representa|corresponde a)\s+(?:del?|al?)\s+\d[\d.,]*%\.?/gi,
    '',
  );

  // 4) Recortar líneas vacías duplicadas y espacios sobrantes.
  out = out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return out;
}

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
          `SELECT [role], content
           FROM historial_mensajes
           WHERE chat_id = $1
           ORDER BY created_at ASC
           OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY`,
          [chatId],
        );
        const history: Anthropic.MessageParam[] = rows
          .map((r: { role: string; content: unknown }) => {
            let text = '';
            if (typeof r.content === 'string') {
              try {
                const parsed = JSON.parse(r.content) as unknown;
                if (typeof parsed === 'string') {
                  // Formato antiguo (anterior a SQL Server 2025): contenido
                  // guardado como JSON string entre comillas (`'"hola"'`).
                  // JSON.parse devuelve el string original.
                  text = parsed;
                } else if (
                  parsed !== null &&
                  typeof parsed === 'object' &&
                  'text' in (parsed as Record<string, unknown>) &&
                  typeof (parsed as { text?: unknown }).text === 'string'
                ) {
                  // Formato actual: contenido guardado como objeto
                  // `{"text":"..."}` (SQL Server 2025 ISJSON solo acepta
                  // objetos/arrays). Extraemos el campo `text` para que el
                  // modelo vea solo texto plano y no imite el envoltorio.
                  text = (parsed as { text: string }).text;
                } else {
                  // Otros objetos/arrays: caemos al string plano por seguridad.
                  text = JSON.stringify(parsed);
                }
              } catch {
                text = r.content;
              }
            } else if (r.content !== null && r.content !== undefined) {
              text = JSON.stringify(r.content);
            }
            const role: 'user' | 'assistant' =
              r.role === 'assistant' ? 'assistant' : 'user';
            // Sanitizamos los mensajes del assistant al cargarlos: elimina
            // bloques <pre>, frases hechas y conclusiones interpretativas
            // que el modelo podría imitar de mensajes antiguos guardados
            // antes de que se reforzaran las reglas de formato.
            if (role === 'assistant') {
              text = sanitizeAssistantText(text);
            }
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
    // La columna `content` es NVARCHAR(MAX) con CHECK (ISJSON(content)=1).
    //
    // IMPORTANTE: en SQL Server 2025 (compat level 170) `ISJSON()` SOLO
    // acepta objetos y arrays — devuelve 0 para escalares JSON (cadenas,
    // números, booleans, null). Esto rompe el formato anterior donde
    // guardábamos el contenido como un string JSON entre comillas
    // (`'"hola"'`). Ahora lo envolvemos siempre en un objeto
    // `{"text":"..."}`, que sí pasa `ISJSON()` en cualquier versión.
    //
    // Al LEER el historial (`loadHistoryIfEmpty`), extraemos el campo
    // `text` del objeto, de modo que el modelo nunca ve el envoltorio
    // y no imita la estructura en sus respuestas.
    let stored: string;
    try {
      const str =
        typeof content === 'string'
          ? content
          : content == null
            ? ''
            : JSON.stringify(content);
      stored = `{"text":${JSON.stringify(str)}}`;
    } catch {
      stored = '{"text":""}';
    }

    // Defensa: validamos con `JSON.parse` que `stored` sea JSON válido
    // antes de mandarlo. Si no lo es, caemos al fallback y logueamos el
    // contenido para diagnosticar.
    try {
      JSON.parse(stored);
    } catch {
      const preview =
        stored.length > 300
          ? `${stored.slice(0, 300)}...[+${stored.length - 300}]`
          : stored;
      this.logger.error(
        `[persistMessage] stored no es JSON valido (chat=${chatId}, role=${role}, ` +
          `len=${stored.length}): ${preview}`,
      );
      stored = '{"text":""}';
    }

    try {
      await this.db.query(
        'INSERT INTO historial_mensajes (chat_id, [role], content) VALUES ($1, $2, $3)',
        [chatId, role, stored],
      );
    } catch (e) {
      const preview =
        stored.length > 300
          ? `${stored.slice(0, 300)}...[+${stored.length - 300}]`
          : stored;
      this.logger.error(
        `Error persisting message (chat=${chatId}, role=${role}, ` +
          `content_len=${stored.length}): ${e}. Content: ${preview}`,
      );
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

    // Tracking acumulado de TODAS las tools llamadas en este turno (a través
    // de todas las rondas del loop). Se usa para validar que las cifras que
    // el modelo escriba provengan de un resultado de herramienta, y no sean
    // alucinaciones. Si no se llama ninguna tool y el draft contiene cifras,
    // se rechaza y se reintenta con una corrección inyectada al historial.
    const turnToolCalls: string[] = [];
    const turnToolResults: string[] = [];
    const turnToolStatuses: ToolStatus[] = [];

    // Buffer circular de los últimos drafts de texto del modelo. Sirve
    // para detectar BUCLES: si el modelo produce el mismo texto (o muy
    // parecido) varias rondas seguidas, sabemos que está "atorado" en
    // una respuesta alucinada o de "no puedo". En ese caso, en lugar
    // de seguir iterando (lo que al final acepta la alucinación al
    // agotar el round limit), cortamos y devolvemos un mensaje útil.
    const recentDrafts: string[] = [];
    const MAX_RECENT_DRAFTS = 4;

    // Bandera: en el próximo round, forzar al modelo a usar una tool
    // (Anthropic soporta `tool_choice: 'any'`). Se activa cuando detectamos
    // que el modelo ANUNCIA una acción ("reintentando", "vuelvo a consultar")
    // sin ejecutarla. Si lo dejamos, el modelo se queda en un bucle de
    // "digo que voy a llamar a la tool" sin llamarla nunca.
    let forceToolChoice: 'any' | undefined;

    for (let round = 0; round < 10; round++) {
      const systemPrompt = await buildSystem(chatId, this.db);

      // ─── Depurador: qué tools tiene disponibles el modelo en este turno ───
      // Logueamos los nombres de las tools disponibles y el historial para
      // poder diagnosticar por qué el modelo elige (o NO elige) una tool
      // concreta. Especialmente útil cuando el modelo alucina "no dispongo
      // de herramienta X" pese a estar listada.
      this.logger.log(
        `[DEBUG round=${round}] tools_disponibles=[${TOOLS.map((t) => t.name).join(', ')}] ` +
          `history.len=${history.length} force_tool_choice=${forceToolChoice ?? '-'}`,
      );

      const response = await client.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: TOOLS,
        // Si la ronda anterior detectó un anuncio sin ejecución, forzamos
        // al modelo a llamar a una tool en esta ronda. Si no, lo dejamos
        // en `auto` (default) para que pueda responder sin tool a saludos
        // u otras consultas.
        ...(forceToolChoice
          ? { tool_choice: { type: forceToolChoice } as const }
          : {}),
        messages: [...history],
      });
      // Consumir la bandera: solo se usa una vez por rechazo.
      forceToolChoice = undefined;

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

      this.logger.log(
        `[Anthropic] round=${round} stop_reason=${response.stop_reason} ` +
          `usage(in={input:${response.usage?.input_tokens ?? 0},` +
          `output:${response.usage?.output_tokens ?? 0}}) ` +
          `text=${textBlocks.length} tool=${toolUseBlocks.length} thinking=${thinkingBlocks.length}`,
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

      this.logger.log(
        `[Anthropic] round=${round} assistantText.len=${assistantText.length} ` +
          `preview="${assistantText.slice(0, 120).replace(/\n/g, ' ')}"`,
      );

      // Sin tool calls → respuesta final
      if (
        toolUseBlocks.length === 0 ||
        response.stop_reason === 'end_turn' ||
        response.stop_reason === 'stop_sequence'
      ) {
        const fallback = collected.join('\n');
        let textToSave = assistantText || fallback;

        // ═══ DETECCIÓN DE BUCLE ═══
        // Si el modelo lleva N rondas produciendo textos muy parecidos
        // (≥80% idénticos) sin llamar tools de datos, está atorado
        // alucinando. Cortamos y devolvemos un mensaje útil en vez de
        // seguir iterando hasta agotar el round limit (que al final
        // termina aceptando la alucinación).
        recentDrafts.push(textToSave);
        if (recentDrafts.length > MAX_RECENT_DRAFTS) recentDrafts.shift();
        if (recentDrafts.length >= 3) {
          const last = recentDrafts[recentDrafts.length - 1];
          const similarCount = recentDrafts.filter(
            (d) => d.slice(0, 80) === last.slice(0, 80),
          ).length;
          if (similarCount >= 3) {
            this.logger.warn(
              `[Anthropic] BUCLE detectado (chat=${chatId}): ` +
                `el modelo repite la misma respuesta ${similarCount} rondas. Cortando.`,
            );
            const loopMsg =
              'Tuve un problema técnico al procesar tu consulta. ¿Puedes reformularla? ' +
              'Por ejemplo: "días denegados del Hospital San Lucas en octubre 2026".';
            await this.persistMessage(chatId, 'assistant', loopMsg);
            return loopMsg;
          }
        }

        // ═══ VALIDACIÓN ANTI-ALUCINACIÓN ═══
        // Verifica que las cifras/IDs/nombres del draft provengan de los
        // resultados de herramientas llamadas en este turno. Si NO se
        // llamó ninguna tool de datos y el draft contiene cifras, o si
        // las cifras no aparecen en los resultados, RECHAZAMOS la
        // respuesta, inyectamos una corrección en el historial y dejamos
        // que el modelo lo intente de nuevo. Esto evita que el modelo
        // invente IDs (como "1123 — Plan B") cuando debería estar
        // llamando a `obtener_planes_disponibles`.
        if (textToSave) {
          // ── Detector: anuncio de acción sin ejecución ──
          // El modelo a veces responde con frases como "Reintentando…",
          // "Vuelvo a consultar…", "Permíteme un momento…", "Dame un
          // momento" SIN haber llamado a una tool. Es un bucle sin salida:
          // el modelo se queda diciendo que va a actuar y nunca lo hace.
          // Cuando detectamos este patrón sin tool call, RECHAZAMOS la
          // respuesta, inyectamos una corrección muy explícita y forzamos
          // `tool_choice: 'any'` en el siguiente round para que el modelo
          // ESTÉ OBLIGADO a llamar a una tool antes de volver a hablar.
          const announceRe =
            /\b(reintent(ando|o(?:r)?)?|vuelvo a (intentar|consultar|llamar|hacer|mostrar)|perm[íi]teme|dame un momento|ahora (mismo )?(lo )?(consulto|llamo|veo)|dame un segundo|espera un momento|un momento por favor|aquí (va|está|tienes)|voy a (consultar|llamar|verificar|revisar|mostrar|proceder|reintentar|mapear|buscar)|procedo a|te (muestro|cuento|digo)|aquí te (muestro|cuento)|aqu[ií] va|el resultado|los resultados|llamando( (a(l)?|del?))? (la |el |los |las )?(cat[áa]logo|hospitales?|planes?|herramienta|tool|endpoint|consulta|api)|consultando( (a(l)?|del?))? (la |el |los |las )?(cat[áa]logo|hospitales?|planes?|herramienta|tool|endpoint|consulta|api)|ejecutando( (la|el|los|las))? (consulta|tool|llamada|herramienta)|iniciando (consulta|llamada)|obteniendo (datos|informaci[oó]n)|(no puedo|no puedo) ejecutar( la consulta| la herramienta)?|no tengo (en contexto|los?) (el|los?) (id|hosid|planid)|con (los|las|tus) filtros (de |de la )(consulta|pregunta|solicitud) anterior|usando (los|las) (mismos|anteriores) filtros)\b/i;
          if (
            announceRe.test(textToSave) &&
            turnToolCalls.length === 0 &&
            round < 4
          ) {
            this.logger.warn(
              `[Anthropic] round=${round} ANUNCIO_SIN_ACCION (chat=${chatId}): ` +
                `modelo anunció acción sin tool call. preview="${textToSave.slice(0, 80)}"`,
            );
            history.push({ role: 'assistant', content: response.content });
            history.push({
              role: 'user',
              content:
                '[SISTEMA — ANUNCIO SIN ACCIÓN] Tu respuesta anterior fue RECHAZADA: ' +
                'anunciaste una acción ("reintentando", "llamando al catálogo", "voy a…", ' +
                '"no puedo ejecutar la consulta", "no tengo en contexto los hosId", etc.) ' +
                'sin EJECUTAR la herramienta. NO la repitas.\n\n' +
                'FLUJO CORRECTO cuando te falta un `hosId`:\n' +
                '1. LLAMA INMEDIATAMENTE a `obtener_hospitales_disponibles` con `{}`.\n' +
                '2. Cuando recibas el catálogo, mapea "San Lucas" → `hosId` internamente.\n' +
                '3. Si también falta el plan, LLAMA a `obtener_planes_disponibles` con `{}`.\n' +
                '4. SOLO DESPUÉS de tener los IDs, llama a la herramienta de DATOS.\n\n' +
                'PROHIBIDO en tu próxima respuesta:\n' +
                '❌ Decir "llamando al catálogo", "consultando el catálogo", "ejecutando la consulta", ' +
                '   "reintentando", "permíteme", "voy a…", "no puedo ejecutar la consulta", ' +
                '   "no tengo en contexto los hosId", "obteniendo datos".\n\n' +
                'OBLIGATORIO en tu próxima respuesta:\n' +
                '✅ LLAMAR a `obtener_hospitales_disponibles` con `input = {}` (tool_use, no texto).\n' +
                '✅ O, si ya tienes el hosId mapeado, llamar a la herramienta de datos correspondiente.\n' +
                '✅ El primer elemento de tu respuesta DEBE ser un `tool_use`, no texto.',
            });
            forceToolChoice = 'any';
            continue;
          }

          const validation = containsUnverifiedClaims(
            textToSave,
            turnToolCalls,
            turnToolResults,
            turnToolStatuses,
            // Pasamos también los tool_results previos del historial para que
            // el validador no rechace al modelo cuando REUSA datos que ya
            // obtuvo en turnos anteriores (p.ej. listas de catálogos).
            extractHistoricalToolResults(history),
          );
          if (validation.suspicious && round < 4) {
            // (deja la lógica de abajo con el mensaje de alucinación)

            this.logger.warn(
              `[Anthropic] round=${round} RECHAZADO (chat=${chatId}): ` +
                validation.reasons.join(' | '),
            );
            history.push({ role: 'assistant', content: response.content });
            history.push({
              role: 'user',
              content:
                '[SISTEMA — ALUCINACIÓN RECHAZADA] Tu respuesta anterior contenía ' +
                'cifras o datos concretos que NO provienen de una herramienta de ' +
                'datos llamada en este turno. Esos números son INVENTADOS.\n\n' +
                'PRÓXIMA RESPUESTA — REGLA ÚNICA Y OBLIGATORIA:\n' +
                'TU PRIMER Y ÚNICO MOVIMIENTO debe ser un `tool_use` (no texto, no ' +
                'muletillas, no saludos). NADA de texto antes del tool_use.\n\n' +
                'FLUJO CORRECTO (en este orden estricto):\n' +
                '1. Si NO tienes el `hosId` mapeado en este turno, PRIMER `tool_use` = ' +
                '   `obtener_hospitales_disponibles` con `input = {}`.\n' +
                '2. Con el `hosId` mapeado, SEGUNDO `tool_use` = la herramienta de ' +
                '   datos que corresponda al indicador pedido:\n' +
                '   - "facturado" / "perdido" / "dinero" / "$" / "monto" → `consultar_montos_por_estado`\n' +
                '   - "días aprobados/denegados/recuperados" → `consultar_resumen_financiero_hospitales`\n' +
                '   - "determinación más frecuente" / "más común" → `consultar_determinacion_adversa_mas_frecuente`\n' +
                '   - "más días denegados" / "mayores pérdidas" / "conceptos con pérdidas" → `consultar_concepto_mas_dias_denegados`\n' +
                '3. Cuando recibas el `tool_result`, redacta la respuesta final usando ' +
                '   SOLO los datos del resultado, en formato limpio.\n\n' +
                '❌ NUNCA produzcas texto antes del primer tool_use. NUNCA pidas filtros ' +
                'que el usuario ya dio. NUNCA inventes cifras. NUNCA digas "no tengo ' +
                'resultados válidos" sin haber llamado antes a una herramienta.',
            });
            // Forzamos al modelo a llamar a una tool en el siguiente round.
            // Sin esto, el modelo puede volver a inventar texto.
            forceToolChoice = 'any';
            continue;
          }

          // ═══ RECHAZO POR "RENDICIÓN" EN RONDAS POSTERIORES ═══
          // Si el modelo ya fue rechazado al menos una vez (round >= 1) y
          // aún así NO llamó a una herramienta de datos, y su respuesta es
          // una "pregunta vaga al usuario" (no saludo, no respuesta
          // concreta), RECHAZAMOS otra vez. Esto evita que el modelo se
          // rinda con "¿de qué hospital/plan/año quieres?" cuando ya fue
          // corregido explícitamente. El bot debe seguir intentando llamar
          // a la tool hasta agotar el round limit.
          if (
            round >= 1 &&
            turnToolCalls.length === 0 &&
            turnToolResults.length === 0 &&
            // No es una respuesta final de "no tengo datos" (eso se filtra
            // por sanitización más abajo). Aquí solo capturamos "preguntas
            // vagas" que parecen rinden al modelo.
            /\b(para (responder|consultar|eso|ello|esto) (correctamente|necesito|te pido)|¿?(de|cu[áa]l|cu[áa]les|qu[ée])\s+(hospital(es)?|plan(es)?|a[ñn]o|mes|periodo|indicador|filtro)|d[ií]game? (el|los) (hospital|plan|a[ñn]o|mes|indicador|filtro)|qu[ée] (hospital|plan|a[ñn]o|mes|indicador|filtro) (quieres|deseas|necesitas))\b/i.test(
              textToSave,
            )
          ) {
            this.logger.warn(
              `[Anthropic] round=${round} RENDICION (chat=${chatId}): ` +
                `modelo no llamó tool y pidió filtros ya discutidos. preview="${textToSave.slice(0, 80)}"`,
            );
            history.push({ role: 'assistant', content: response.content });
            history.push({
              role: 'user',
              content:
                '[SISTEMA — NO TE RINDAS] Tu respuesta anterior fue RECHAZADA: ' +
                'pides filtros que el usuario YA DIJO (o que ya deberían estar ' +
                'en el contexto de esta conversación).\n\n' +
                'PRÓXIMA RESPUESTA — REGLA ÚNICA:\n' +
                'Tu primer y único movimiento DEBE ser un `tool_use`. NADA de ' +
                'texto antes. NADA de "permíteme", "voy a…", "dame un momento".\n\n' +
                'LLAMA INMEDIATAMENTE a la herramienta de datos correspondiente. ' +
                'Si necesitas el `hosId`, PRIMER tool_use = `obtener_hospitales_disponibles` ' +
                'con `input = {}`. Si necesitas el `id` del plan, PRIMER tool_use = ' +
                '`obtener_planes_disponibles` con `input = {}`. Después de mapear, ' +
                'llama a la herramienta de DATOS con los IDs.\n\n' +
                'Indicador pedido → herramienta:\n' +
                '- "facturado" / "perdido" / "$" / "monto" / "dinero" → `consultar_montos_por_estado`\n' +
                '- "días aprobados/denegados/recuperados" → `consultar_resumen_financiero_hospitales`\n' +
                '- "determinación más frecuente" / "más común" → `consultar_determinacion_adversa_mas_frecuente`\n' +
                '- "más días denegados" / "mayores pérdidas" → `consultar_concepto_mas_dias_denegados`',
            });
            forceToolChoice = 'any';
            continue;
          }

          // Sanitizamos ANTES de persistir y de devolver al usuario, así
          // no acumulamos más respuestas con bloques <pre>, frases hechas
          // o tasas no pedidas en la BD, y el cliente recibe el texto
          // ya limpio.
          textToSave = sanitizeAssistantText(textToSave);
          if (!textToSave && round < 9) {
            // La respuesta quedó vacía tras sanitizar: contenía SOLO
            // frases prohibidas (p. ej. "indícame el ID del hospital"
            // o "¿de qué año?"). Forzamos regeneración inyectando
            // una corrección del sistema, igual que cuando el validador
            // de cifras rechaza.
            this.logger.warn(
              `[Anthropic] round=${round} RECHAZADO (chat=${chatId}): ` +
                `respuesta vacía tras sanitizar (solo contenía frases prohibidas).`,
            );
            history.push({ role: 'assistant', content: response.content });
            history.push({
              role: 'user',
              content:
                '[SISTEMA — RECHAZO] Tu respuesta anterior contenía SOLO frases prohibidas ' +
                '("indícame el ID", "ID o nombre", "para identificar", "¿de qué año?", etc.) y ' +
                'tras limpiarla quedó VACÍA. NO la repitas.\n\n' +
                'FORMATO DE PREGUNTA OBLIGATORIO cuando faltan filtros:\n' +
                '✅ "Para 2026, ¿de qué hospital y qué plan?"\n' +
                '✅ "¿Hospital San Lucas y MMM Advantage, correcto?"\n' +
                '❌ "indícame: año, ID o nombre del hospital"  ← ESTO ESTÁ PROHIBIDO\n' +
                '❌ "indícame el año y el ID del hospital"     ← ESTO ESTÁ PROHIBIDO\n' +
                '❌ "para identificar… indícame el ID"         ← ESTO ESTÁ PROHIBIDO\n' +
                '❌ "¿de qué año?"                              ← ESTO ESTÁ PROHIBIDO\n\n' +
                'RECUERDA:\n' +
                '1. NUNCA pidas IDs. Pide SIEMPRE por nombre (hospital y/o plan).\n' +
                '2. NUNCA preguntes por el año: usa 2026 (currentYear) por defecto.\n' +
                '3. Si faltan filtros, pregunta TODOS a la vez en UNA sola frase corta.\n' +
                '4. Si la consulta es completa (hospital + plan), llama YA a la herramienta correspondiente.',
            });
            forceToolChoice = 'any';
            continue;
          }
          if (textToSave) {
            // Si `collected` ya tiene entries (de un tool_use previo),
            // sobreescribimos la última con el texto final del assistant.
            // Si `collected` está vacío (respuesta directa sin tools),
            // hay que hacer PUSH — usar `arr[-1] = x` no agrega nada en JS.
            if (collected.length > 0) {
              collected[collected.length - 1] = textToSave;
            } else {
              collected.push(textToSave);
            }
            history.push({ role: 'assistant', content: response.content });
            await this.persistMessage(chatId, 'assistant', textToSave);
          } else {
            this.logger.warn(
              `Respuesta del modelo quedó vacía tras sanitizar para chat ${chatId}.`,
            );
          }
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
        const toolStart = Date.now();
        this.logger.log(
          `[DEBUG] >>> TOOL_CALL name=${tu.name} id=${tu.id} input=${JSON.stringify(args)}`,
        );

        const resultStr = await executeTool(tu.name, args, chatId, this.db);
        const toolElapsed = Date.now() - toolStart;

        // Status rápido para depuración
        let quickStatus = 'ok';
        try {
          const j = JSON.parse(resultStr) as { success?: boolean };
          if (j?.success === false) quickStatus = 'error';
        } catch {
          if (/error|exception|fail/i.test(resultStr.slice(0, 200))) {
            quickStatus = 'error';
          }
        }

        this.logger.log(
          `[DEBUG] <<< TOOL_RESULT name=${tu.name} ${toolElapsed}ms status=${quickStatus} ` +
            `result.len=${resultStr.length} preview="${resultStr.slice(0, 300).replace(/\n/g, ' ')}"`,
        );

        // Tracking acumulado para `containsUnverifiedClaims`. Necesitamos
        // registrar nombre + resultado crudo + status (ok/empty/error) de
        // CADA tool llamada, para que el validador pueda comparar las
        // cifras del draft final contra los valores reales.
        turnToolCalls.push(tu.name);
        turnToolResults.push(resultStr);
        let toolStatus: ToolStatus = 'ok';
        try {
          const parsed = JSON.parse(resultStr) as {
            success?: boolean;
            error?: string;
            message?: string;
          };
          if (parsed.success === false) toolStatus = 'error';
          else if (
            Array.isArray((parsed as { resultados?: unknown[] }).resultados) &&
            (parsed as { resultados: unknown[] }).resultados.length === 0
          ) {
            toolStatus = 'empty';
          }
        } catch {
          /* resultStr no es JSON — lo tratamos como ok si no es error */
          if (/error|exception|fail/i.test(resultStr.slice(0, 200))) {
            toolStatus = 'error';
          }
        }
        turnToolStatuses.push(toolStatus);

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

    // Resumen de depuración al final del turno: qué tools se llamaron (o NO)
    this.logger.log(
      `[DEBUG] FIN chat=${chatId} tools_llamadas=[${turnToolCalls.join(', ') || 'NINGUNA'}] ` +
        `status=[${turnToolStatuses.join(', ') || '-'}]`,
    );
    if (turnToolCalls.length === 0) {
      this.logger.warn(
        `[DEBUG] chat=${chatId} ⚠️  el modelo NO llamó ninguna tool de datos en este turno`,
      );
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
      // Sanitizamos la respuesta del assistant antes de devolverla al
      // usuario y antes de guardarla en BD.
      const sanitized = sanitizeAssistantText(finalText);
      if (sanitized) {
        conversations.set(chatId, [
          { role: 'user', content: userText },
          { role: 'assistant', content: response.content },
        ]);
        await this.persistMessage(chatId, 'user', userText);
        await this.persistMessage(chatId, 'assistant', sanitized);
        return sanitized;
      }
    }
    return finalText;
  }

  /**
   * Punto de entrada público: procesa un mensaje y devuelve la respuesta del agente.
   */
  async chat(chatId: number, userText: string): Promise<string> {
    try {
      const { rows } = await this.db.query(
        `SELECT TOP 1 1
         FROM chats_pausados
         WHERE chat_id = $1 AND reanudado_en IS NULL`,
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

/**
 * Extrae los strings de contenido de TODOS los `tool_result` blocks presentes
 * en el historial de la conversación. Se usa para que el validador
 * `containsUnverifiedClaims` acepte como "verificadas" las cifras que el
 * modelo reusa de turnos anteriores (p.ej. listas de catálogos cacheadas).
 *
 * Soporta los dos formatos que Anthropic acepta:
 *  - `content: string` (texto plano)
 *  - `content: ContentBlock[]` (puede contener bloques `text`)
 */
export function extractHistoricalToolResults(
  history: Anthropic.Messages.MessageParam[],
): string[] {
  const out: string[] = [];
  for (const msg of history) {
    if (msg.role !== 'user') continue;
    const content = msg.content;
    if (typeof content === 'string') {
      out.push(content);
      continue;
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        const b = block as { type?: string; content?: unknown };
        if (b.type === 'tool_result') {
          const c = b.content;
          if (typeof c === 'string') {
            out.push(c);
          } else if (Array.isArray(c)) {
            for (const sub of c) {
              const sb = sub as { type?: string; text?: string };
              if (sb.type === 'text' && typeof sb.text === 'string') {
                out.push(sb.text);
              }
            }
          }
        }
      }
    }
  }
  return out;
}
