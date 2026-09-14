/**
 * Postgres connection + migrations. `DATABASE_URL` selects this backend.
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

// numeric / int8 arrive as strings by default — the app wants numbers.
pg.types.setTypeParser(1700, Number);
pg.types.setTypeParser(20, Number);

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

export function createDb(url) {
  const ssl = /sslmode=require/.test(url) || /\.(supabase\.co|neon\.tech|render\.com)/.test(url);
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.COHIVE_PG_POOL) || 8,
    ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  pool.on('error', (e) => console.warn('[cohive-db] idle client error:', e?.message || e));

  const query = (text, params) => pool.query(text, params);

  /** Run `fn(client)` inside BEGIN/COMMIT; rolls back and rethrows on error. */
  async function tx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async function migrate() {
    await query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    await tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(7264410)'); // one migrator at a time
      const { rows } = await c.query('SELECT name FROM schema_migrations');
      const done = new Set(rows.map((r) => r.name));
      for (const f of files) {
        if (done.has(f)) continue;
        const sql = await readFile(MIGRATIONS_DIR + f, 'utf8');
        await c.query(sql);
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      }
    });
  }

  return { pool, query, tx, migrate, close: () => pool.end() };
}
