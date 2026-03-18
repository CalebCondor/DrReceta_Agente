import { DbService } from './db.service';
export declare function executeTool(toolName: string, toolInput: Record<string, unknown>, chatId: number, db: DbService): Promise<string>;
