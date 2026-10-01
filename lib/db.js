// Small PostgreSQL helper using node-postgres (pg).
// The pool is kept on globalThis so Next.js hot reloads do not
// create a new pool on every change during development.
//
// Production notes (this is what makes a deployed instance behave like a
// local one):
//   * keepAlive keeps the TCP sockets alive across the idle gaps between
//     requests, so a serverless/PaaS load balancer or NAT does not silently
//     drop a connection that the pool still believes is usable — the next
//     query would otherwise pay a full reconnect (several round trips).
//   * connectionTimeoutMillis turns "the database is unreachable" into a fast,
//     clear failure instead of a hung request.
//   * the pool is shared by every request in the instance; routes issue their
//     independent queries together (Promise.all) rather than serially, so a
//     request costs one round-trip window instead of one per statement.
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

/** Run a parameterized query and return rows. */
export async function query(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

/**
 * Run fn(client) inside a database transaction.
 * Commits on success, rolls back on any error.
 */
export async function withTransaction(fn) {
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
