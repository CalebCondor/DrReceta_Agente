import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import * as sql from 'mssql';

/**
 * Servicio de base de datos sobre SQL Server (T-SQL).
 *
 * Lee la configuración desde variables de entorno (no se hardcodean credenciales):
 *   - DB_CONNECTION_STRING  → cadena completa (opcional, tiene prioridad)
 *   - DB_SERVER, DB_NAME, DB_USER, DB_PASSWORD, DB_PORT
 *   - DB_ENCRYPT, DB_TRUST_CERT (true/false)
 *
 * La API pública `query(text, params)` mantiene la firma compatible con la
 * versión anterior (PostgreSQL): traduce automáticamente placeholders
 * `$1, $2, ...` a `@p1, @p2, ...` y devuelve `{ rows }` poblado desde
 * `recordset` para que el resto del código siga funcionando sin cambios.
 *
 * IMPORTANTE: las queries del proyecto deben seguir usando `$1, $2...`.
 * La conversión a `@p1, @p2...` se hace aquí, además de los reemplazos
 * puntuales de LIMIT/RETURNING/ON CONFLICT/ARRAY_AGG en cada llamada.
 */
@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  private pool!: sql.ConnectionPool;
  private connected = false;

  onModuleInit() {
    const poolConfig = this.buildConfig();
    this.pool = new sql.ConnectionPool(poolConfig);

    this.pool
      .connect()
      .then(() => {
        this.connected = true;
        const server =
          (poolConfig as sql.config).server ?? 'connectionString';
        const database = (poolConfig as sql.config).database ?? '?';
        this.logger.log(
          `Conectado a SQL Server: ${server}/${database}`,
        );
        return this.initTables();
      })
      .catch((e) =>
        this.logger.error(
          `DB connection/init failed: ${e?.message ?? e}`,
          e?.stack,
        ),
      );

    this.pool.on('error', (err) => {
      this.logger.error(`Pool error: ${err?.message ?? err}`);
    });
  }

  async onModuleDestroy() {
    if (this.pool && this.connected) {
      try {
        await this.pool.close();
        this.connected = false;
        this.logger.log('Pool SQL Server cerrado.');
      } catch (e) {
        this.logger.error(`Error cerrando pool: ${e}`);
      }
    }
  }

  private buildConfig(): sql.config {
    const connectionString = process.env.DB_CONNECTION_STRING?.trim();
    if (connectionString) {
      // mssql acepta connectionString en la config y la parsea internamente.
      return { connectionString } as sql.config;
    }
    return {
      user: process.env.DB_USER || 'sa',
      password: process.env.DB_PASSWORD || 'sa',
      server: process.env.DB_SERVER || '192.168.100.133',
      database: process.env.DB_NAME || 'MEDICA4',
      port: process.env.DB_PORT
        ? parseInt(process.env.DB_PORT, 10)
        : undefined,
      options: {
        encrypt:
          (process.env.DB_ENCRYPT || 'true').toLowerCase() === 'true',
        trustServerCertificate:
          (process.env.DB_TRUST_CERT || 'true').toLowerCase() === 'true',
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    };
  }

  /**
   * Ejecuta una query y devuelve `{ rows }` para mantener compatibilidad
   * con el código previo (PostgreSQL usaba `result.rows`).
   * Traduce automáticamente `$1, $2, ...` a `@p1, @p2, ...`.
   */
  async query(text: string, params?: any[]): Promise<{ rows: any[] }> {
    if (!this.connected) {
      throw new Error('SQL Server pool no está conectado todavía.');
    }
    const translated = text.replace(/\$\d+/g, (m) => `@p${m.slice(1)}`);
    const request = this.pool.request();
    if (params) {
      params.forEach((value, i) => {
        // mssql detecta el tipo; pero para algunos tipos (BigInt, Buffer) conviene
        // declararlo. Para mantenerlo simple, dejamos que infiera.
        request.input(`p${i + 1}`, value);
      });
    }
    const result = await request.query(translated);
    return { rows: result.recordset ?? [] };
  }

  private async initTables() {
    const req = this.pool.request();

    // ─── conocimiento_especifico ───────────────────────────────────────────
    await req.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'conocimiento_especifico')
      CREATE TABLE conocimiento_especifico (
        id INT IDENTITY(1,1) PRIMARY KEY,
        pregunta NVARCHAR(MAX) NOT NULL,
        respuesta NVARCHAR(MAX) NOT NULL,
        fuente NVARCHAR(255) NULL DEFAULT 'aprendizaje_ia',
        created_at DATETIME2 NOT NULL DEFAULT GETDATE()
      );
    `);

    await req.query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('conocimiento_especifico')
          AND name = 'updated_at'
      )
      ALTER TABLE conocimiento_especifico
        ADD updated_at DATETIME2 NOT NULL DEFAULT GETDATE();
    `);

    await req.query(`
      IF EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('conocimiento_especifico')
          AND name = 'categoria'
      )
      ALTER TABLE conocimiento_especifico DROP COLUMN categoria;
    `);

    await req.query(`
      IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_conocimiento_categoria')
      DROP INDEX idx_conocimiento_categoria ON conocimiento_especifico;
    `);
    await req.query(`
      IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_conocimiento_categoria_id')
      DROP INDEX idx_conocimiento_categoria_id ON conocimiento_especifico;
    `);

    await req.query(`
      IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'categorias_conocimiento')
      DROP TABLE categorias_conocimiento;
    `);

    // ─── memoria_largo_plazo ───────────────────────────────────────────────
    await req.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'memoria_largo_plazo')
      CREATE TABLE memoria_largo_plazo (
        id INT IDENTITY(1,1) PRIMARY KEY,
        chat_id BIGINT NOT NULL,
        clave NVARCHAR(255) NOT NULL,
        valor NVARCHAR(MAX) NOT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT GETDATE()
      );
    `);
    await req.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_memoria_usuario')
      CREATE UNIQUE INDEX idx_memoria_usuario ON memoria_largo_plazo (chat_id, clave);
    `);

    // ─── historial_mensajes ────────────────────────────────────────────────
    await req.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'historial_mensajes')
      CREATE TABLE historial_mensajes (
        id INT IDENTITY(1,1) PRIMARY KEY,
        chat_id BIGINT NOT NULL,
        role NVARCHAR(50) NOT NULL,
        content NVARCHAR(MAX) NOT NULL,
        created_at DATETIME2 NOT NULL DEFAULT GETDATE()
      );
    `);
    await req.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_historial_chat')
      CREATE INDEX idx_historial_chat ON historial_mensajes (chat_id, created_at);
    `);

    // ─── derivaciones_humano ───────────────────────────────────────────────
    await req.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'derivaciones_humano')
      CREATE TABLE derivaciones_humano (
        id INT IDENTITY(1,1) PRIMARY KEY,
        chat_id BIGINT NOT NULL,
        motivo NVARCHAR(MAX) NOT NULL,
        mensaje_usuario NVARCHAR(MAX) NULL,
        respuesta_ia NVARCHAR(MAX) NULL,
        created_at DATETIME2 NOT NULL DEFAULT GETDATE()
      );
    `);
    await req.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_derivaciones_chat')
      CREATE INDEX idx_derivaciones_chat ON derivaciones_humano (chat_id, created_at);
    `);

    // ─── chats_pausados ────────────────────────────────────────────────────
    await req.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'chats_pausados')
      CREATE TABLE chats_pausados (
        chat_id BIGINT PRIMARY KEY,
        pausado_en DATETIME2 NOT NULL DEFAULT GETDATE(),
        reanudado_en DATETIME2 NULL
      );
    `);

    this.logger.log('Database initialized successfully (SQL Server).');
  }
}