import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import * as sql from 'mssql';

/**
 * Resultado neutro de `query()` cuando la BD no está disponible o falla.
 * Mantiene la forma `{ rows: [...] }` para que todos los call-sites que
 * hacen `const { rows } = await db.query(...)` sigan funcionando sin
 * cambios. Cuando la BD está caída, todas las queries devuelven esto.
 */
const EMPTY_RESULT = Object.freeze({ rows: [] as unknown[] });

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  private pool!: sql.ConnectionPool | null;
  private connected = false;
  /**
   * Se setea en `true` la primera vez que falla una query por un error de
   * conexión. Sirve para no inundar los logs con el mismo error cada 30s
   * (caso típico: AutoResumeService).
   */
  private warnedUnavailable = false;

  onModuleInit() {
    // Si no hay configuración de BD en absoluto, salimos silenciosamente:
    // el agente sigue funcionando con memoria en RAM (`conversations` en
    // `state.ts`) y las tools de datos (IaPreguntas) que NO dependen de BD.
    if (!this.hasConfig()) {
      this.logger.warn(
        'DB no configurada (sin DB_CONNECTION_STRING ni DB_SERVER). ' +
          'Funcionando sin persistencia: historial, memoria a largo plazo, ' +
          'pausa de chats y auto-resume deshabilitados.',
      );
      this.pool = null;
      return;
    }

    const poolConfig = this.buildConfig();
    const pool = new sql.ConnectionPool(poolConfig);
    this.pool = pool;

    pool
      .connect()
      .then(() => {
        this.connected = true;
        const server = (poolConfig as sql.config).server ?? 'connectionString';
        const database = (poolConfig as sql.config).database ?? '?';
        this.logger.log(`Conectado a SQL Server: ${server}/${database}`);
        return this.initTables();
      })
      .catch((e) => {
        // La BD no está accesible (típico: servidor apagado o inaccesible
        // por red). Logueamos UNA VEZ como warning (no error) y dejamos
        // que el sistema siga funcionando: la app no muere, las tools de
        // datos (HTTP) siguen operando, la memoria en RAM del agente
        // sigue viva.
        this.connected = false;
        this.logger.warn(
          `DB no disponible (${e?.message ?? e}). El agente funcionará sin ` +
            `persistencia: sin historial guardado, sin memoria a largo ` +
            `plazo, sin pausa de chats. Las tools HTTP siguen activas.`,
        );
      });

    pool.on('error', (err) => {
      // Errores del pool en runtime. Mantenemos `connected` sincronizado
      // y logueamos como warning para no spammear.
      this.connected = false;
      if (!this.warnedUnavailable) {
        this.logger.warn(`DB pool error: ${err?.message ?? err}`);
        this.warnedUnavailable = true;
      }
    });
  }

  /** Devuelve `true` si hay AL MENOS una variable de BD configurada. */
  private hasConfig(): boolean {
    return Boolean(
      process.env.DB_CONNECTION_STRING?.trim() ||
        process.env.DB_SERVER?.trim() ||
        process.env.DB_NAME?.trim(),
    );
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

  /**
   * `true` si el pool está conectado a SQL Server. Los servicios que
   * llaman a `query()` pueden chequear esto antes de hacer operaciones
   * costosas, pero `query()` ya devuelve `{rows: []}` si NO está
   * conectado (tolerancia silenciosa).
   */
  isAvailable(): boolean {
    return this.connected && this.pool !== null;
  }

  private buildConfig(): sql.config {
    const connectionString = process.env.DB_CONNECTION_STRING?.trim();
    if (connectionString) {
      // mssql v12 ya NO acepta `connectionString` como string dentro de
      // la config — devuelve "config.server is required". Hay que
      // parsearlo a un objeto config con `ConnectionPool.parseConnectionString`.
      const parsed = sql.ConnectionPool.parseConnectionString(
        connectionString,
      ) as unknown as Partial<sql.config>;
      return {
        ...parsed,
        pool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000,
        },
      } as sql.config;
    }
    return {
      user: process.env.DB_USER || 'sa',
      password: process.env.DB_PASSWORD || 'sa',
      server: process.env.DB_SERVER || '192.168.100.133',
      database: process.env.DB_NAME || 'MEDICA4',
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
      options: {
        encrypt: (process.env.DB_ENCRYPT || 'true').toLowerCase() === 'true',
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
   *
   * TOLERANCIA A FALLOS: si la BD no está disponible (sin pool, sin
   * conexión, o la query explota por un error de conexión), devuelve
   * `{ rows: [] }` en lugar de lanzar. Esto permite que el resto del
   * sistema (Agente, ChatController, AutoResumeService) sigan
   * funcionando aunque la BD esté caída.
   *
   * La única excepción es `UPDATE ... OUTPUT` o `INSERT ... OUTPUT` que
   * los call-sites pueden esperar que devuelva filas para leer IDs. En
   * esos casos el resultado neutro es OK porque las features que
   * dependen de BD están deshabilitadas cuando esto pasa.
   */
  async query(text: string, params?: any[]): Promise<{ rows: any[] }> {
    if (!this.connected || !this.pool) {
      // Sin BD: resultado vacío. NO lanzamos error.
      return EMPTY_RESULT;
    }
    try {
      const translated = text.replace(/\$\d+/g, (m) => `@p${m.slice(1)}`);
      const request = this.pool.request();
      if (params) {
        params.forEach((value, i) => {
          // mssql detecta el tipo; pero para algunos tipos (BigInt, Buffer) conviene
          // declararlo. Para mantenerlo simple, dejamos que infiera.
          request.input(`p${i + 1}`, value);
        });
      }
      const result = (await request.query(translated)) as sql.IResult<any>;
      return { rows: result.recordset ?? [] };
    } catch (e) {
      // Si la conexión se cayó a mitad de una query (típico: timeout,
      // red inestable), marcamos como desconectado y devolvemos vacío.
      const msg = (e as Error)?.message ?? String(e);
      // Errores típicos de desconexión: "Connection is closed",
      // "socket hang up", "Failed to connect", "ECONNREFUSED",
      // "ETIMEDOUT", "Connection lost".
      const isConnectionError =
        /connection|connect|socket|econn|etimedout|reset|closed/i.test(msg);
      if (isConnectionError) {
        this.connected = false;
        if (!this.warnedUnavailable) {
          this.logger.warn(
            `DB query falló por pérdida de conexión: ${msg}. ` +
              `Continuando sin persistencia.`,
          );
          this.warnedUnavailable = true;
        }
      } else {
        // Error lógico de la query (constraint, sintaxis, etc.) — sí
        // propagamos al call-site que tenga su propio try/catch para
        // decidir qué hacer. Si nadie lo captura, NestJS lo loguea.
        this.logger.error(`DB query error: ${msg}`);
        throw e;
      }
      return EMPTY_RESULT;
    }
  }

  private async initTables() {
    if (!this.pool) return;
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
    // `clave` debe ser NVARCHAR(MAX) (las queries concatenan prefijos largos
    // tipo "preferencia_hospital_xyz"); no se puede indexar directamente,
    // por eso se proyecta a NVARCHAR(450) en una columna computada PERSISTED
    // (`clave_indice`) sobre la que sí se crea el índice único.
    await req.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'memoria_largo_plazo')
      CREATE TABLE memoria_largo_plazo (
        id INT IDENTITY(1,1) PRIMARY KEY,
        chat_id BIGINT NOT NULL,
        clave NVARCHAR(MAX) NOT NULL,
        valor NVARCHAR(MAX) NOT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        clave_indice AS (CONVERT(NVARCHAR(450), clave)) PERSISTED
      );
    `);
    await req.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_memoria_usuario')
      CREATE UNIQUE INDEX idx_memoria_usuario
        ON memoria_largo_plazo (chat_id, clave_indice);
    `);

    // ─── historial_mensajes ────────────────────────────────────────────────
    // `role` está delimitado con corchetes en el esquema real porque `ROLE`
    // es palabra reservada en T-SQL (funciones ROLE_ID, ROLE_NAME, etc).
    // La tabla además exige CHECK (isjson(content)) — el código siempre
    // inserta con JSON.stringify(), así que se cumple naturalmente.
    await req.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'historial_mensajes')
      CREATE TABLE historial_mensajes (
        id INT IDENTITY(1,1) PRIMARY KEY,
        chat_id BIGINT NOT NULL,
        [role] NVARCHAR(50) NOT NULL,
        content NVARCHAR(MAX) NOT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT CK_historial_mensajes_content_json CHECK (ISJSON(content) = 1)
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
