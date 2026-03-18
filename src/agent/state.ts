import Anthropic from '@anthropic-ai/sdk';

if (!process.env.ANTHROPIC_API_KEY)
  throw new Error('Missing ANTHROPIC_API_KEY');

export const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929';
export const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface SessionData {
  token: string;
  user_id: string | number;
  name: string;
  es_vip: boolean;
}

// In-memory stores (shared per process)
export const conversations = new Map<number, Anthropic.MessageParam[]>();
export const sessions = new Map<number, SessionData>();
