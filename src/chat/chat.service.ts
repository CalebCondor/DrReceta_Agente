import { Injectable } from '@nestjs/common';
import { DbService } from '../agent/db.service';

@Injectable()
export class ChatService {
  constructor(private readonly db: DbService) {}

  async getChatsByUserId(
    userId: number,
  ): Promise<{ role: string; content: unknown; created_at: string }[]> {
    const { rows } = await this.db.query(
      `SELECT role, content, (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Puerto_Rico')::text AS created_at
       FROM historial_mensajes
       WHERE chat_id = $1
       ORDER BY created_at ASC`,
      [userId],
    );
    return rows as { role: string; content: unknown; created_at: string }[];
  }

  async deleteByUserIdAndDate(userId: number, fecha: string): Promise<number> {
    const { rows } = await this.db.query(
      `DELETE FROM historial_mensajes
       WHERE chat_id = $1 AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Puerto_Rico')::date = $2::date
       RETURNING id`,
      [userId, fecha],
    );
    return (rows as { id: number }[]).length;
  }

  async getAllUserIds(): Promise<{ chat_id: number; fechas: string[] }[]> {
    const { rows } = await this.db.query(
      `SELECT chat_id, ARRAY_AGG(DISTINCT (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Puerto_Rico')::date::text ORDER BY (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Puerto_Rico')::date::text ASC) AS fechas
       FROM historial_mensajes
       GROUP BY chat_id
       ORDER BY chat_id ASC`,
    );
    return (rows as { chat_id: number; fechas: string[] }[]).map((r) => ({
      chat_id: r.chat_id,
      fechas: r.fechas,
    }));
  }

  async listPreguntasRespuestas(): Promise<
    {
      id: number;
      pregunta: string;
      respuesta: string;
      categoria: string;
      updated_at: string;
    }[]
  > {
    const { rows } = await this.db.query(
      'SELECT id, pregunta, respuesta, categoria, updated_at FROM conocimiento_especifico ORDER BY id ASC',
    );
    return (
      rows as Array<{
        id: number;
        pregunta: string;
        respuesta: string;
        categoria: string;
        updated_at: Date;
      }>
    ).map((r) => ({
      id: Number(r.id),
      pregunta: String(r.pregunta),
      respuesta: String(r.respuesta),
      categoria: r.categoria ? String(r.categoria) : 'general',
      updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : '',
    }));
  }

  async insertPreguntaRespuesta(
    pregunta: string,
    respuesta: string,
    categoria: string = 'general',
  ): Promise<{ success: boolean; id?: number; categoria?: string }> {
    const { rows } = await this.db.query(
      'INSERT INTO conocimiento_especifico (pregunta, respuesta, categoria) VALUES ($1, $2, $3) RETURNING id, categoria',
      [pregunta, respuesta, categoria],
    );
    const row = rows[0] as { id?: number; categoria?: string } | undefined;
    const id =
      row && typeof row.id !== 'undefined' ? Number(row.id) : undefined;
    return { success: true, id, categoria: row?.categoria };
  }

  async isChatPaused(chatId: number): Promise<boolean> {
    const { rows } = await this.db.query(
      `SELECT 1 FROM chats_pausados
       WHERE chat_id = $1 AND reanudado_en IS NULL
       LIMIT 1`,
      [chatId],
    );
    return (rows as unknown[]).length > 0;
  }

  async pauseChat(
    chatId: number,
  ): Promise<{ alreadyPaused: boolean; pausado_en: string }> {
    const existing = await this.isChatPaused(chatId);
    if (existing) {
      const { rows } = await this.db.query(
        `SELECT pausado_en FROM chats_pausados
         WHERE chat_id = $1 AND reanudado_en IS NULL LIMIT 1`,
        [chatId],
      );
      const r = rows[0] as { pausado_en: Date } | undefined;
      return {
        alreadyPaused: true,
        pausado_en: r?.pausado_en ? new Date(r.pausado_en).toISOString() : '',
      };
    }

    await this.db.query(
      `INSERT INTO chats_pausados (chat_id)
       VALUES ($1)
       ON CONFLICT (chat_id) DO UPDATE
         SET pausado_en = CURRENT_TIMESTAMP,
             reanudado_en = NULL
       WHERE chats_pausados.reanudado_en IS NOT NULL`,
      [chatId],
    );
    const { rows } = await this.db.query(
      `SELECT pausado_en FROM chats_pausados WHERE chat_id = $1`,
      [chatId],
    );
    const r = rows[0] as { pausado_en: Date } | undefined;
    return {
      alreadyPaused: false,
      pausado_en: r?.pausado_en ? new Date(r.pausado_en).toISOString() : '',
    };
  }

  async resumeChat(
    chatId: number,
  ): Promise<{ wasPaused: boolean; reanudado_en: string }> {
    const { rows } = await this.db.query(
      `UPDATE chats_pausados
       SET reanudado_en = CURRENT_TIMESTAMP
       WHERE chat_id = $1 AND reanudado_en IS NULL
       RETURNING reanudado_en`,
      [chatId],
    );
    const r = rows[0] as { reanudado_en: Date } | undefined;
    if (!r) {
      return { wasPaused: false, reanudado_en: '' };
    }
    return {
      wasPaused: true,
      reanudado_en: new Date(r.reanudado_en).toISOString(),
    };
  }

  async getPauseStatus(chatId: number): Promise<{
    paused: boolean;
    pausado_en?: string;
    reanudado_en?: string;
  }> {
    const { rows } = await this.db.query(
      `SELECT pausado_en, reanudado_en
       FROM chats_pausados
       WHERE chat_id = $1
       ORDER BY pausado_en DESC
       LIMIT 1`,
      [chatId],
    );
    const r = rows[0] as
      | {
          pausado_en: Date;
          reanudado_en: Date | null;
        }
      | undefined;
    if (!r) return { paused: false };
    return {
      paused: r.reanudado_en === null,
      pausado_en: new Date(r.pausado_en).toISOString(),
      reanudado_en: r.reanudado_en
        ? new Date(r.reanudado_en).toISOString()
        : undefined,
    };
  }

  async saveHumanMessage(
    chatId: number,
    message: string,
  ): Promise<{ success: boolean; id?: number; error?: string }> {
    if (!message || !message.trim()) {
      return { success: false, error: 'El mensaje está vacío' };
    }
    try {
      const { rows } = await this.db.query(
        `INSERT INTO historial_mensajes (chat_id, role, content)
         VALUES ($1, 'human', $2)
         RETURNING id`,
        [chatId, JSON.stringify(message.trim())],
      );
      const row = rows[0] as { id?: number } | undefined;
      return { success: true, id: row?.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'DB error';
      return { success: false, error: msg };
    }
  }
}
