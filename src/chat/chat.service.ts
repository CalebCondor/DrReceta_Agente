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
    { id: number; pregunta: string; respuesta: string }[]
  > {
    const { rows } = await this.db.query(
      'SELECT id, pregunta, respuesta FROM conocimiento_especifico ORDER BY id ASC',
    );
    return (
      rows as Array<{ id: number; pregunta: string; respuesta: string }>
    ).map((r) => ({
      id: Number(r.id),
      pregunta: String(r.pregunta),
      respuesta: String(r.respuesta),
    }));
  }

  async insertPreguntaRespuesta(
    pregunta: string,
    respuesta: string,
  ): Promise<{ success: boolean; id?: number }> {
    const { rows } = await this.db.query(
      'INSERT INTO conocimiento_especifico (pregunta, respuesta) VALUES ($1, $2) RETURNING id',
      [pregunta, respuesta],
    );
    const row = rows[0] as { id?: number } | undefined;
    const id =
      row && typeof row.id !== 'undefined' ? Number(row.id) : undefined;
    return { success: true, id };
  }

  async updatePreguntaRespuesta(
    id: number,
    pregunta: string,
    respuesta: string,
  ): Promise<{ success: boolean }> {
    await this.db.query(
      'UPDATE conocimiento_especifico SET pregunta = $1, respuesta = $2 WHERE id = $3',
      [pregunta, respuesta, id],
    );
    return { success: true };
  }

  async deletePreguntaRespuesta(id: number): Promise<{ success: boolean }> {
    await this.db.query('DELETE FROM conocimiento_especifico WHERE id = $1', [
      id,
    ]);
    return { success: true };
  }
}
