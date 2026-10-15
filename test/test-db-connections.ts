import 'dotenv/config';
import * as sql from 'mssql';

/**
 * Test de carga de conexiones a SQL Server.
 * Lee la configuración desde las mismas variables de entorno que DbService.
 */
async function main() {
  const config: sql.config = process.env.DB_CONNECTION_STRING
    ? ({ connectionString: process.env.DB_CONNECTION_STRING } as sql.config)
    : {
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
      };

  const pool = new sql.ConnectionPool(config);
  await pool.connect();
  console.log('Pool conectado. Probando 1000 queries...');

  const promises: Promise<{ ok: boolean; error?: string }>[] = [];
  for (let i = 0; i < 1000; i++) {
    promises.push(
      pool
        .request()
        .query('SELECT 1 AS result')
        .then(
          () => ({ ok: true }),
          (err) => ({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        ),
    );
  }
  const results = await Promise.all(promises);
  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok);
  console.log(`Conexiones exitosas: ${ok}`);
  if (fail.length) {
    console.log(`Errores:`, fail.slice(0, 5));
  }
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});