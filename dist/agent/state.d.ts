import Anthropic from '@anthropic-ai/sdk';
export declare const ANTHROPIC_MODEL: string;
export declare const client: Anthropic;
export interface SessionData {
    token: string;
    user_id: string | number;
    name: string;
    es_vip: boolean;
    language?: string;
}
export declare const conversations: Map<number, Anthropic.Messages.MessageParam[]>;
export declare const sessions: Map<number, SessionData>;
