import { AgentService } from '../agent/agent.service';
declare class ChatDto {
    chat_id: number;
    message: string;
}
export declare class ChatController {
    private readonly agentService;
    constructor(agentService: AgentService);
    chat(body: ChatDto): Promise<{
        success: boolean;
        response: string;
    }>;
}
export {};
