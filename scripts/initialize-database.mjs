// Explicit bootstrap only. Never invoked by npm start or tests.
import { createInitialStore, STORE_SCHEMA } from '../server/store.js';
import { postgresConnectionOptions } from '../server/tls-config.js';
import { serializeStore } from '../server/runtime-secrets.js';
import { safeErrorMessage } from '../server/safe-errors.js';

if (!process.argv.includes('--initialize-empty')) {
  console.error('Requires --initialize-empty. Review backup, database and permissions first.');
  process.exitCode = 1;
} else {
  let pool, client;
  try {
    const schema = process.env.DB_SCHEMA || 'public';
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid schema.');
    const { default: pg } = await import('pg');
    pool = new pg.Pool(postgresConnectionOptions(process.env.DATABASE_URL));
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
    await client.query(STORE_SCHEMA);
    await client.query('LOCK TABLE kanba_store IN EXCLUSIVE MODE');
    const existing = await client.query('SELECT id FROM kanba_store WHERE id = 1');
    if (existing.rows.length) throw new Error('Database already initialized; no overwrite allowed.');
    await client.query('INSERT INTO kanba_store (id, doc) VALUES (1, $1::jsonb)', [serializeStore(createInitialStore())]);
    await client.query('COMMIT');
    console.log('Empty operational store initialized; no demo users or reservations.');
  } catch (error) {
    if (client) try { await client.query('ROLLBACK'); } catch { /* noop */ }
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
  } finally { client?.release(); await pool?.end(); }
}
