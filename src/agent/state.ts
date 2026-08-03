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
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY, baseURL: ANTHROPIC_BASE_URL })
  : (null as unknown as Anthropic);

// Legacy OpenAI-compatible (ya no se usa, pero se conserva para referencia)
export const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY ?? '';
export const MINIMAX_MODEL = process.env.MINIMAX_MODEL ?? 'MiniMax-M3';
export const MINIMAX_BASE_URL =
  process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/v1';
export const MINIMAX_ENABLED =
  MINIMAX_API_KEY.length > 0 && !MINIMAX_API_KEY.startsWith('sk-cp-REPLACE');

export interface SessionData {
  token: string;
  user_id: string | number;
  name: string;
  es_vip: boolean;
  language?: string;
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
