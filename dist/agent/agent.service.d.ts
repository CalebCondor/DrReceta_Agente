import { DbService } from './db.service';
export declare class AgentService {
    private readonly db;
    private readonly logger;
    constructor(db: DbService);
    private loadHistoryIfEmpty;
    private normalizeMessages;
    private persistMessage;
    private runAgentCore;
    private retryWithFreshHistory;
    chat(chatId: number, userText: string): Promise<string>;
}
