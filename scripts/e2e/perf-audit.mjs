// Performance audit harness (API + database round trips).
//
// For every hot endpoint this measures:
//   * wall-clock latency (p50 / p95 / mean over N sequential calls)
//   * the exact number of SQL statements the endpoint executes, and their
//     total in-database time, read from pg_stat_statements
//
// The statement count matters because it is what multiplies a deployment's
// network latency: on localhost a round trip to PostgreSQL costs ~0.1 ms, so
// 12 sequential statements are invisible; against a managed database a few
// milliseconds away the same 12 round trips dominate the response time.
//
// Usage:
//   BASE_URL=http://127.0.0.1:3001 node scripts/e2e/perf-audit.mjs
// Env:
//   DATABASE_URL  (required for the pg_stat_statements round-trip counts)
//   PERF_RUNS     calls per endpoint (default 12)
//   PERF_WARMUP   discarded warm-up calls (default 2)
//   PERF_LABEL    optional label printed with the results
import pg from 'pg';
import { loadEnv } from '../env.mjs';

loadEnv();

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
const RUNS = Number(process.env.PERF_RUNS || 12);
const WARMUP = Number(process.env.PERF_WARMUP || 2);
const LABEL = process.env.PERF_LABEL || '';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });

function jar() {
  return { cookies: [] };
}
async function call(j, path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (j.cookies.length) headers.Cookie = j.cookies.map((c) => c.split(';')[0]).join('; ');
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
    const pair = c.split(';')[0];
    const name = pair.split('=')[0];
    j.cookies = j.cookies.filter((x) => !x.startsWith(name + '='));
    const value = pair.split('=').slice(1).join('=');
    if (value !== '' && value !== 'deleted') j.cookies.push(pair);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not json */
  }
  return { status: res.status, data };
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

// Endpoints exercised. `sale` is a write and is measured separately below.
const READ_ENDPOINTS = [
  '/api/dashboard',
  '/api/products',
  '/api/categories',
  '/api/customers',
  '/api/sales',
  '/api/daily',
  '/api/shifts',
  '/api/finance/accounts',
  '/api/finance/balance-sheet',
  '/api/finance/receivables',
  '/api/reports/inventory',
  '/api/reports/daily',
];

async function main() {
  await db.connect();
  const admin = jar();
  const login = await call(admin, '/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'Admin123' },
  });
  if (login.status !== 200) {
    console.error(`login failed (${login.status}) — cannot benchmark`);
    process.exit(1);
  }
  // Warm the session row and the app's own per-request cache.
  await call(admin, '/api/account');

  const rows = [];
  for (const path of READ_ENDPOINTS) {
    for (let i = 0; i < WARMUP; i++) await call(admin, path);

    await db.query('SELECT pg_stat_statements_reset()');
    const times = [];
    let bytes = 0;
    for (let i = 0; i < RUNS; i++) {
      const t0 = process.hrtime.bigint();
      const res = await fetch(BASE + path, {
        headers: { Cookie: admin.cookies.map((c) => c.split(';')[0]).join('; ') },
        cache: 'no-store',
      });
      const text = await res.text();
      const t1 = process.hrtime.bigint();
      bytes += text.length;
      times.push(Number(t1 - t0) / 1e6);
    }
    const stats = await db.query(
      `SELECT COALESCE(SUM(calls), 0)::bigint AS calls,
              COALESCE(SUM(total_exec_time), 0) AS exec_ms
         FROM pg_stat_statements
        WHERE query NOT ILIKE '%pg_stat_statements%'`
    );
    const sorted = [...times].sort((a, b) => a - b);
    rows.push({
      endpoint: path,
      p50: +pct(sorted, 50).toFixed(1),
      p95: +pct(sorted, 95).toFixed(1),
      mean: +(times.reduce((s, t) => s + t, 0) / times.length).toFixed(1),
      sql_per_req: +(Number(stats.rows[0].calls) / RUNS).toFixed(1),
      sql_ms: +(Number(stats.rows[0].exec_ms) / RUNS).toFixed(2),
      kb: +(bytes / RUNS / 1024).toFixed(1),
    });
  }

  console.log(`\nPERF AUDIT ${LABEL} → ${BASE}  (${RUNS} calls/endpoint)\n`);
  console.table(rows);

  // Cost model: what the same endpoints cost when the database sits N ms away
  // (serverless function -> managed PostgreSQL). Sequential statements each
  // pay the round trip; statements issued in parallel pay it once.
  const rtts = [0, 5, 20];
  console.log('\nProjected added latency per request = sql_per_req × DB round trip\n');
  for (const rtt of rtts) {
    const line = rows
      .map((r) => `${r.endpoint.replace('/api/', '')} +${(r.sql_per_req * rtt).toFixed(0)}ms`)
      .join('  ');
    console.log(`  rtt=${rtt}ms: ${line}`);
  }

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
