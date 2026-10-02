// Small PostgreSQL helper using node-postgres (pg).
// The pool is kept on globalThis so Next.js hot reloads do not
// create a new pool on every change during development.
import { Pool } from 'pg';

const globalForPool = globalThis;
export const pool =
  globalForPool.__bevPosPool ||
  (globalForPool.__bevPosPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    connectionTimeoutMillis: 10_000,
  }));

// Ensure additive schema columns exist even if a deployment starts before
// `npm run db:migrate` was manually executed. Runs once per server process.
const RUNTIME_DDL = `
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS opening_balance_type TEXT NOT NULL DEFAULT 'payable' CHECK (opening_balance_type IN ('payable', 'receivable'));
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS opening_balance_note TEXT NOT NULL DEFAULT '';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS opening_balance_date DATE;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS opening_balance_updated_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS opening_balance_updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE purchase_payments ALTER COLUMN purchase_id DROP NOT NULL;
`;

function ensureRuntimeSchema() {
  if (!globalForPool.__bevPosSchemaReady) {
    globalForPool.__bevPosSchemaReady = pool.query(RUNTIME_DDL).catch((err) => {
      // If vendors table doesn't exist yet (e.g. before initial migration), allow retry later.
      globalForPool.__bevPosSchemaReady = null;
      if (err?.code !== '42P01') {
        console.error('[db] runtime schema check warning:', err.message);
      }
    });
  }
  return globalForPool.__bevPosSchemaReady;
}

/** Run a parameterized query and return rows. */
export async function query(text, params) {
  await ensureRuntimeSchema();
  const { rows } = await pool.query(text, params);
  return rows;
}

/**
 * Run fn(client) inside a database transaction.
 * Commits on success, rolls back on any error.
 */
export async function withTransaction(fn) {
  await ensureRuntimeSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
