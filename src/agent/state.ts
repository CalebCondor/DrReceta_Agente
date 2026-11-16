import Anthropic from '@anthropic-ai/sdk';

// Usamos el SDK de Anthropic apuntando al endpoint Anthropic-compatible
// de MiniMax. Esto hace que el razonamiento venga en bloques `type: "thinking"`
// SEPARADOS de los bloques `type: "text"`, evitando que el thinking se
// filtre al usuario (problema con el endpoint OpenAI-compatible de MiniMax-M3).
export const USE_ANTHROPIC = true;

export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'MiniMax-M3';
export const ANTHROPIC_BASE_URL =
  process.env.ANTHROPIC_BASE_URL ?? 'https://api.minimax.io/anthropic';
export const ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY ?? process.env.MINIMAX_API_KEY ?? '';

export const client = USE_ANTHROPIC
  ? new Anthropic({
      apiKey: ANTHROPIC_API_KEY,
      baseURL: ANTHROPIC_BASE_URL,
      // El endpoint Anthropic-compatible de MiniMax requiere la API key en
      // `X-Api-Key` (no acepta solo `Authorization: Bearer`). Lo mandamos
      // como header adicional; si el endpoint ignora `Authorization`, listo.
      defaultHeaders: { 'X-Api-Key': ANTHROPIC_API_KEY },
      // Timeout duro por llamada al SDK. Si el proveedor se cuelga, el SDK
      // aborta en vez de quedarse esperando indefinidamente. Combinado con
      // el timeout duro de `AgentService.chat()` (60s), el frontend nunca
      // debería quedarse colgado más de eso.
      timeout: 45_000,
    })
  : (null as unknown as Anthropic);

// Legacy OpenAI-compatible (ya no se usa, pero se conserva para referencia)
export const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY ?? '';
export const MINIMAX_MODEL = process.env.MINIMAX_MODEL ?? 'MiniMax-M3';
export const MINIMAX_BASE_URL =
  process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/v1';
export const MINIMAX_ENABLED =
  MINIMAX_API_KEY.length > 0 && !MINIMAX_API_KEY.startsWith('sk-cp-REPLACE');

/**
 * Alcance hospitalario del usuario (multi-tenant).
 *
 * En Audita un usuario sólo puede consultar los hospitales a los que tiene
 * acceso (tabla `Usuario_Hospital`). Ese alcance lo resuelve el backend .NET
 * en `GET /api/hospitales/activos`, que — cuando la request lleva JWT —
 * devuelve SOLO los hospitales asignados al usuario autenticado.
 *
 * `restringido` distingue dos situaciones que el prompt debe tratar de
 * forma distinta:
 *   · `true`  → el alcance se resolvió: `hospitalesIds` es la lista EXACTA
 *               (puede estar vacía si el usuario no tiene ningún hospital).
 *   · `false` → no se pudo resolver (no hay token, o el backend no
 *               respondió): en ese caso NO se recorta nada, porque no
 *               sabemos qué|datum es lo permitido.
 */
export interface SessionScope {
  /** IDs de hospital (`hosId`) a los que el usuario tiene acceso. */
  hospitalesIds: number[];
  /** Nombres de hospital (`hosNombre`) a los que el usuario tiene acceso. */
  hospitales: string[];
  /** Rol del usuario (claim `rol` del JWT), si se pudo leer. */
  rol?: string;
  /** `true` cuando el alcance se resolvió contra el backend de Audita. */
  restringido: boolean;
}

export interface SessionData {
  /**
   * Token JWT de Audita. Lo envía el frontend en cada mensaje de chat y
   * el agente lo reenvía como `Authorization: Bearer` a los endpoints de
   * `/api/*`.
   *
   * IMPORTANTE: NUNCA se loguea ni se devuelve en una respuesta.
   */
  token?: string;
  user_id?: string | number;
  name?: string;
  es_vip?: boolean;
  language?: string;
  /** Alcance hospitalario del usuario (ver `SessionScope`). */
  scope?: SessionScope;
  /**
   * Epoch (ms) de la última resolución del alcance. Sirve para no
   * pegarle al backend de Audita en cada mensaje del chat.
   */
  scopeResolvedAt?: number;
  /**
   * Token con el que se resolvió `scope`.
   *
   * El alcance se cachea por chat, pero un mismo `chat_id` puede
   * recibir el token de OTRO usuario (p. ej. el navegador reinicia sesión
   * y el `chat_id` sigue siendo el mismo). Si el token cambia, el
   * alcance cacheado es de otro usuario y hay que resolverlo de nuevo:
   * si no, el prompt le announce al usuario los hospitales de otra
   * persona.
   */
  scopeToken?: string;
}

export interface MiniMaxMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  reasoning_content?: string | null;
  reasoning_details?: Array<{ text?: string; [k: string]: unknown }> | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: MiniMaxToolCall[];
}

export interface MiniMaxToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface MiniMaxChatChoice {
  index: number;
  message: MiniMaxMessage;
  finish_reason: string;
}

export interface MiniMaxChatResponse {
  id: string;
  model: string;
  choices: MiniMaxChatChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export async function callMiniMax(
  body: Record<string, unknown>,
  timeoutMs = 30000,
): Promise<MiniMaxChatResponse> {
  if (!MINIMAX_ENABLED)
    throw new Error('MiniMax fallback is not configured (missing API key)');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      throw new Error(`MiniMax HTTP ${r.status}: ${errText.slice(0, 500)}`);
    }
    return (await r.json()) as MiniMaxChatResponse;
  } finally {
    clearTimeout(timer);
  }
}

// In-memory stores (shared per process).
// `conversations` es la que usa el flujo Anthropic (la que está activa).
// `minimaxConversations` se conserva por compatibilidad pero ya no se usa.
export const conversations = new Map<number, Anthropic.MessageParam[]>();
export const minimaxConversations = new Map<number, MiniMaxMessage[]>();
export const sessions = new Map<number, SessionData>();
