import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class DbService implements OnModuleInit {
  private readonly logger = new Logger(DbService.name);
  private pool!: Pool;

  onModuleInit() {
    this.pool = new Pool({
      host: process.env.DB_HOST || '187.77.15.77',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'tulicencia_agenteia',
      user: process.env.DB_USER || 'agente',
      password: process.env.DB_PASSWORD || 'SmartHiring2025@',
    });
    this.initTables().catch((e) => this.logger.error('DB init failed', e));
  }

  query(text: string, params?: any[]) {
    return this.pool.query(text, params);
  }

  private async initTables() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS conocimiento_especifico (
        id SERIAL PRIMARY KEY, pregunta TEXT NOT NULL, respuesta TEXT NOT NULL,
        fuente TEXT DEFAULT 'aprendizaje_ia', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS memoria_largo_plazo (
        id SERIAL PRIMARY KEY, chat_id BIGINT NOT NULL, clave TEXT NOT NULL,
        valor TEXT NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memoria_usuario ON memoria_largo_plazo (chat_id, clave);
      CREATE TABLE IF NOT EXISTS historial_mensajes (
        id SERIAL PRIMARY KEY, chat_id BIGINT NOT NULL, role TEXT NOT NULL,
        content JSONB NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_historial_chat ON historial_mensajes (chat_id, created_at);
      CREATE TABLE IF NOT EXISTS derivaciones_humano (
        id SERIAL PRIMARY KEY,
        chat_id BIGINT NOT NULL,
        motivo TEXT NOT NULL,
        mensaje_usuario TEXT,
        respuesta_ia TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_derivaciones_chat ON derivaciones_humano (chat_id, created_at);
      CREATE TABLE IF NOT EXISTS chats_pausados (
        chat_id BIGINT PRIMARY KEY,
        pausado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reanudado_en TIMESTAMP NULL
      );
    `);
    this.logger.log('Database initialized successfully.');
  }
}
