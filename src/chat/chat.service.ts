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

  async deleteByUserIdAndDate(userId: number, fecha: string): Promise<number> {
    const { rows } = await this.db.query(
      `DELETE FROM historial_mensajes
       WHERE chat_id = $1 AND DATE(created_at) = $2::date
       RETURNING id`,
      [userId, fecha],
    );
    return (rows as { id: number }[]).length;
  }

  async getAllUserIds(): Promise<{ chat_id: number; fechas: string[] }[]> {
    const { rows } = await this.db.query(
      `SELECT chat_id, ARRAY_AGG(DISTINCT DATE(created_at)::text ORDER BY DATE(created_at)::text ASC) AS fechas
       FROM historial_mensajes
       GROUP BY chat_id
       ORDER BY chat_id ASC`,
    );
    return (rows as { chat_id: number; fechas: string[] }[]).map((r) => ({
      chat_id: r.chat_id,
      fechas: r.fechas,
    }));
  }
}
