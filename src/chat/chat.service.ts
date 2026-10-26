import { Injectable } from '@nestjs/common';
import { DbService } from '../agent/db.service';

@Injectable()
export class ChatService {
  constructor(private readonly db: DbService) {}

  async getChatsByUserId(
    userId: number,
  ): Promise<{ role: string; content: unknown; created_at: string }[]> {
    const { rows } = await this.db.query(
      `SELECT role, content,
              to_char(timezone('America/Puerto_Rico', created_at AT TIME ZONE 'UTC'),
                      'YYYY-MM-DD HH24:MI:SS.US') AS created_at
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
       WHERE chat_id = $1
         AND CAST(timezone('America/Puerto_Rico', created_at AT TIME ZONE 'UTC') AS DATE)
             = CAST($2 AS DATE)
       RETURNING id`,
      [userId, fecha],
    );
    return (rows as { id: number }[]).length;
  }

  async getAllUserIds(): Promise<
    {
      chat_id: number;
      fechas: string[];
      ultima_actividad: string;
      inicio_conversacion: string;
    }[]
  > {
    const { rows } = await this.db.query(
      `SELECT hm.chat_id,
              (SELECT COALESCE(json_agg(d.fecha ORDER BY d.fecha), '[]'::json)
               FROM (
                 SELECT DISTINCT CAST(timezone('America/Puerto_Rico', hm2.created_at AT TIME ZONE 'UTC') AS DATE) AS fecha
                 FROM historial_mensajes hm2
                 WHERE hm2.chat_id = hm.chat_id
               ) d) AS fechas,
              to_char(MAX(timezone('America/Puerto_Rico', hm.created_at AT TIME ZONE 'UTC')),
                      'YYYY-MM-DD HH24:MI:SS.US') AS ultima_actividad,
              to_char(MIN(timezone('America/Puerto_Rico', hm.created_at AT TIME ZONE 'UTC')),
                      'YYYY-MM-DD HH24:MI:SS.US') AS inicio_conversacion
       FROM historial_mensajes hm
       GROUP BY hm.chat_id
       ORDER BY MAX(hm.created_at) DESC`,
    );
    return (
      rows as {
        chat_id: number;
        fechas: string[];
        ultima_actividad: string;
        inicio_conversacion: string;
      }[]
    ).map((r) => ({
      chat_id: r.chat_id,
      fechas: r.fechas,
      ultima_actividad: r.ultima_actividad,
      inicio_conversacion: r.inicio_conversacion,
    }));
  }
  async listPreguntasRespuestas(): Promise<
    {
      id: number;
      pregunta: string;
      respuesta: string;
      updated_at: string;
    }[]
  > {
    const { rows } = await this.db.query(
      `SELECT id, pregunta, respuesta,
              to_char(timezone('America/Puerto_Rico', updated_at AT TIME ZONE 'UTC'),
                      'YYYY-MM-DD HH24:MI:SS.US') AS updated_at
       FROM conocimiento_especifico ORDER BY id ASC`,
    );
    return (
      rows as Array<{
        id: number;
        pregunta: string;
        respuesta: string;
        updated_at: string | null;
      }>
    ).map((r) => ({
      id: Number(r.id),
      pregunta: String(r.pregunta),
      respuesta: String(r.respuesta),
      updated_at: r.updated_at ?? '',
    }));
  }

  async insertPreguntaRespuesta(
    pregunta: string,
    respuesta: string,
  ): Promise<{ success: boolean; id?: number }> {
    const { rows } = await this.db.query(
      `INSERT INTO conocimiento_especifico (pregunta, respuesta)
       VALUES ($1, $2)
       RETURNING id`,
      [pregunta, respuesta],
    );
    const row = rows[0] as { id?: number } | undefined;
    const id =
      row && typeof row.id !== 'undefined' ? Number(row.id) : undefined;
    return { success: true, id };
  }
  async isChatPaused(chatId: number): Promise<boolean> {
    const { rows } = await this.db.query(
      `SELECT 1
       FROM chats_pausados
       WHERE chat_id = $1 AND reanudado_en IS NULL
       LIMIT 1`,
      [chatId],
    );
    return (rows as unknown[]).length > 0;
  }

  async pauseChat(
    chatId: number,
  ): Promise<{ alreadyPaused: boolean; pausado_en: string }> {
    // Los timestamps de la BD son naive UTC; se formatean en SQL (hora local de
    // PR) porque el driver `pg` los interpretaría como hora local del proceso.
    const existing = await this.isChatPaused(chatId);
    if (existing) {
      const { rows } = await this.db.query(
        `SELECT to_char(timezone('America/Puerto_Rico', pausado_en AT TIME ZONE 'UTC'),
                       'YYYY-MM-DD HH24:MI:SS.US') AS pausado_en
         FROM chats_pausados
         WHERE chat_id = $1 AND reanudado_en IS NULL
         LIMIT 1`,
        [chatId],
      );
      const r = rows[0] as { pausado_en: string } | undefined;
      return {
        alreadyPaused: true,
        pausado_en: r?.pausado_en ?? '',
      };
    }

    await this.db.query(
      `INSERT INTO chats_pausados (chat_id)
       VALUES ($1)
       ON CONFLICT (chat_id) DO UPDATE
         SET pausado_en = now(), reanudado_en = NULL
         WHERE chats_pausados.reanudado_en IS NOT NULL`,
      [chatId],
    );
    const { rows } = await this.db.query(
      `SELECT to_char(timezone('America/Puerto_Rico', pausado_en AT TIME ZONE 'UTC'),
                     'YYYY-MM-DD HH24:MI:SS.US') AS pausado_en
       FROM chats_pausados WHERE chat_id = $1`,
      [chatId],
    );
    const r = rows[0] as { pausado_en: string } | undefined;
    return {
      alreadyPaused: false,
      pausado_en: r?.pausado_en ?? '',
    };
  }

  async resumeChat(
    chatId: number,
  ): Promise<{ wasPaused: boolean; reanudado_en: string }> {
    const { rows } = await this.db.query(
      `UPDATE chats_pausados
       SET reanudado_en = now()
       WHERE chat_id = $1 AND reanudado_en IS NULL
       RETURNING to_char(timezone('America/Puerto_Rico', reanudado_en AT TIME ZONE 'UTC'),
                         'YYYY-MM-DD HH24:MI:SS.US') AS reanudado_en`,
      [chatId],
    );
    const r = rows[0] as { reanudado_en: string } | undefined;
    if (!r) {
      return { wasPaused: false, reanudado_en: '' };
    }
    return {
      wasPaused: true,
      reanudado_en: r.reanudado_en,
    };
  }

  async getPauseStatus(chatId: number): Promise<{
    paused: boolean;
    pausado_en?: string;
    reanudado_en?: string;
  }> {
    const { rows } = await this.db.query(
      `SELECT to_char(timezone('America/Puerto_Rico', pausado_en AT TIME ZONE 'UTC'),
                     'YYYY-MM-DD HH24:MI:SS.US') AS pausado_en,
              to_char(timezone('America/Puerto_Rico', reanudado_en AT TIME ZONE 'UTC'),
                     'YYYY-MM-DD HH24:MI:SS.US') AS reanudado_en
       FROM chats_pausados
       WHERE chat_id = $1
       ORDER BY pausado_en DESC
       LIMIT 1`,
      [chatId],
    );
    const r = rows[0] as
      | {
          pausado_en: string;
          reanudado_en: string | null;
        }
      | undefined;
    if (!r) return { paused: false };
    return {
      paused: r.reanudado_en === null,
      pausado_en: r.pausado_en,
      reanudado_en: r.reanudado_en ?? undefined,
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
      // El contenido se envuelve en {"text":"..."} porque la columna es JSONB
      // y el panel espera ese shape.
      const content = `{"text":${JSON.stringify(message.trim())}}`;
      const { rows } = await this.db.query(
        `INSERT INTO historial_mensajes (chat_id, role, content)
         VALUES ($1, 'human', $2)
         RETURNING id`,
        [chatId, content],
      );
      const row = rows[0] as { id?: number } | undefined;
      return { success: true, id: row?.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'DB error';
      return { success: false, error: msg };
    }
  }
}
