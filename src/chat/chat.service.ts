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
      categoria_id: number | null;
      categoria: string;
      updated_at: string;
    }[]
  > {
    const { rows } = await this.db.query(
      `SELECT ke.id, ke.pregunta, ke.respuesta, ke.updated_at,
              c.id AS categoria_id, c.nombre AS categoria_nombre
       FROM conocimiento_especifico ke
       LEFT JOIN categorias_conocimiento c ON c.id = ke.categoria_id
       ORDER BY ke.id ASC`,
    );
    return (
      rows as Array<{
        id: number;
        pregunta: string;
        respuesta: string;
        updated_at: Date;
        categoria_id: number | null;
        categoria_nombre: string | null;
      }>
    ).map((r) => ({
      id: Number(r.id),
      pregunta: String(r.pregunta),
      respuesta: String(r.respuesta),
      categoria_id: r.categoria_id !== null ? Number(r.categoria_id) : null,
      categoria: r.categoria_nombre ? String(r.categoria_nombre) : 'general',
      updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : '',
    }));
  }

  async insertPreguntaRespuesta(
    pregunta: string,
    respuesta: string,
    categoriaId?: number | null,
  ): Promise<{ success: boolean; id?: number; categoria_id?: number | null }> {
    const { rows } = await this.db.query(
      'INSERT INTO conocimiento_especifico (pregunta, respuesta, categoria_id) VALUES ($1, $2, $3) RETURNING id, categoria_id',
      [pregunta, respuesta, categoriaId ?? null],
    );
    const row = rows[0] as
      | { id?: number; categoria_id?: number | null }
      | undefined;
    const id =
      row && typeof row.id !== 'undefined' ? Number(row.id) : undefined;
    return {
      success: true,
      id,
      categoria_id:
        row && row.categoria_id !== null && row.categoria_id !== undefined
          ? Number(row.categoria_id)
          : null,
    };
  }

  async listCategorias(): Promise<
    { id: number; nombre: string; descripcion: string | null }[]
  > {
    const { rows } = await this.db.query(
      'SELECT id, nombre, descripcion FROM categorias_conocimiento ORDER BY nombre ASC',
    );
    return (
      rows as Array<{
        id: number;
        nombre: string;
        descripcion: string | null;
      }>
    ).map((r) => ({
      id: Number(r.id),
      nombre: String(r.nombre),
      descripcion: r.descripcion ? String(r.descripcion) : null,
    }));
  }

  async getCategoriaByNombre(
    nombre: string,
  ): Promise<{ id: number; nombre: string } | null> {
    const { rows } = await this.db.query(
      'SELECT id, nombre FROM categorias_conocimiento WHERE LOWER(nombre) = LOWER($1) LIMIT 1',
      [nombre],
    );
    const r = rows[0] as { id: number; nombre: string } | undefined;
    return r ? { id: Number(r.id), nombre: String(r.nombre) } : null;
  }

  async upsertCategoriaByNombre(
    nombre: string,
    descripcion?: string | null,
  ): Promise<{ id: number; nombre: string; descripcion: string | null }> {
    const { rows } = await this.db.query(
      `INSERT INTO categorias_conocimiento (nombre, descripcion)
       VALUES ($1, $2)
       ON CONFLICT (nombre) DO UPDATE SET descripcion = COALESCE(EXCLUDED.descripcion, categorias_conocimiento.descripcion)
       RETURNING id, nombre, descripcion`,
      [nombre, descripcion ?? null],
    );
    const r = rows[0] as {
      id: number;
      nombre: string;
      descripcion: string | null;
    };
    return {
      id: Number(r.id),
      nombre: String(r.nombre),
      descripcion: r.descripcion ? String(r.descripcion) : null,
    };
  }

  async createCategoria(
    nombre: string,
    descripcion?: string,
  ): Promise<{
    success: boolean;
    id?: number;
    nombre?: string;
    error?: string;
  }> {
    try {
      const { rows } = await this.db.query(
        'INSERT INTO categorias_conocimiento (nombre, descripcion) VALUES ($1, $2) RETURNING id, nombre',
        [nombre, descripcion ?? null],
      );
      const r = rows[0] as { id: number; nombre: string } | undefined;
      return { success: true, id: Number(r?.id), nombre: r?.nombre };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'DB error';
      return { success: false, error: msg };
    }
  }

  async deleteCategoria(
    id: number,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { rowCount } = await this.db.query(
        'DELETE FROM categorias_conocimiento WHERE id = $1',
        [id],
      );
      if (!rowCount) {
        return { success: false, error: 'Categoría no encontrada.' };
      }
      return { success: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'DB error';
      return { success: false, error: msg };
    }
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
