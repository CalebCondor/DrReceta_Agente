import { AgentService } from '../agent/agent.service';
import { ChatService } from './chat.service';
declare class ChatDto {
    chat_id: number;
    message: string;
}
export declare class ChatController {
    private readonly agentService;
    private readonly chatService;
    constructor(agentService: AgentService, chatService: ChatService);
    chat(body: ChatDto): Promise<{
        success: boolean;
        response: string;
    }>;
    getChatsByUser(usId: number): Promise<{
        success: boolean;
        chat_id: number;
        total: number;
        messages: {
            role: string;
            content: unknown;
            created_at: string;
        }[];
    }>;
    getAllUserIds(): Promise<{
        success: boolean;
        total: number;
        user_ids: number[];
    }>;
}
export {};
