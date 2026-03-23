// src/chat/chat.service.ts

import { Injectable } from '@nestjs/common';
import { DbService } from '../agent/db.service';

@Injectable()
export class ChatService {
  constructor(private readonly db: DbService) {}

  async getChatsByUserId(
    userId: number,
  ): Promise<{ role: string; content: unknown; created_at: string }[]> {
    const { rows } = await this.db.query(
      'SELECT role, content, created_at FROM historial_mensajes WHERE chat_id = $1 ORDER BY created_at ASC',
      [userId],
    );
    return rows as { role: string; content: unknown; created_at: string }[];
  }

  async getAllUserIds(): Promise<number[]> {
    const { rows } = await this.db.query(
      'SELECT DISTINCT chat_id FROM historial_mensajes ORDER BY chat_id ASC',
    );
    return (rows as { chat_id: number }[]).map((r) => r.chat_id);
  }
}
