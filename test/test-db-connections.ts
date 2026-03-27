import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || '187.77.15.77',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'AGENTEIA',
  user: process.env.DB_USER || 'agente',
  password: process.env.DB_PASSWORD || 'SmartHiring2025@',
  max: 1000, // hasta 1000 conexiones simultáneas
});

async function testConnections() {
  const promises: Promise<{ ok: boolean; error?: string }>[] = [];
  for (let i = 0; i < 1000; i++) {
    promises.push(
      pool.query('SELECT 1 as result').then(
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
    console.log(`Errores:`, fail.slice(0, 5)); // muestra solo los primeros 5 errores
  }
  await pool.end();
}

testConnections();
