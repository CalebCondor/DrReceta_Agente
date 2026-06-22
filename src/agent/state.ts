import Anthropic from '@anthropic-ai/sdk';

if (!process.env.ANTHROPIC_API_KEY)
  throw new Error('Missing ANTHROPIC_API_KEY');

export const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929';
export const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

// In-memory stores (shared per process)
export const conversations = new Map<number, Anthropic.MessageParam[]>();
export const minimaxConversations = new Map<number, MiniMaxMessage[]>();
export const sessions = new Map<number, SessionData>();
