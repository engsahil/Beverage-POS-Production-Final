// Checkout round-trip + latency benchmark.
//
// Builds a real multi-line sale (mixed sizes + plain products) against a LIVE
// server and measures: wall time, and the number of SQL statements the
// single POST /api/sales request executes (read from pg_stat_statements,
// which is the honest way to count round trips to the database).
//
// Usage:
//   DATABASE_URL=postgres://... BASE_URL=http://127.0.0.1:3001 \
//     node scripts/e2e/checkout-perf.mjs
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
const RUNS = Number(process.env.RUNS || 7);
const LABEL = process.env.PERF_LABEL || '';

const login = await fetch(BASE + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'Admin123' }),
});
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const H = { Cookie: cookie, 'Content-Type': 'application/json' };

const { products } = (await (await fetch(BASE + '/api/products', { headers: H })).json()).data;
// The API refuses expired stock, so the basket must avoid it (that check is
// correct behaviour, not something the benchmark should work around).
const notExpired = (d) => !d || String(d).slice(0, 10) > new Date().toISOString().slice(0, 10);
const sellable = (p) => p.active && Number(p.stock) > 50 && notExpired(p.expiry_date);
const sellableVariant = (v) => v.active && Number(v.stock) > 50 && notExpired(v.expiry_date);
// A realistic basket: two plain products and two sizes of a sized product.
const plain = products.filter((p) => sellable(p) && !(p.variants || []).length).slice(0, 2);
const sized = products.find((p) => sellable(p) && (p.variants || []).filter(sellableVariant).length >= 2);
if (plain.length < 2 || !sized) {
  console.error('benchmark needs 2 plain products and 1 sized product with 2 in-stock sizes');
  process.exit(1);
}
const sizes = (sized.variants || []).filter(sellableVariant).slice(0, 2);
const items = [
  { productId: plain[0].id, qty: 2 },
  { productId: plain[1].id, qty: 1 },
  { productId: sized.id, variantId: sizes[0].id, qty: 1 },
  { productId: sized.id, variantId: sizes[1].id, qty: 3 },
];

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

async function once() {
  await db.query('SELECT pg_stat_statements_reset()');
  const t0 = performance.now();
  const res = await fetch(BASE + '/api/sales', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ items, discount: 0, paymentMethod: 'cash', paid: 100000 }),
  });
  const ms = performance.now() - t0;
  const body = await res.json();
  const { rows } = await db.query('SELECT COALESCE(SUM(calls),0)::int AS n FROM pg_stat_statements');
  if (res.status !== 201) throw new Error(`sale failed: ${res.status} ${JSON.stringify(body)}`);
  // the reset itself is not part of the request
  return { ms, sql: rows[0].n - 1, id: body.data?.id };
}

await once(); // warm up (pool, prepared plans, JIT)
const runs = [];
for (let i = 0; i < RUNS; i++) runs.push(await once());
const p50 = [...runs].sort((a, b) => a.ms - b.ms)[Math.floor(runs.length / 2)].ms;
const mean = runs.reduce((s, r) => s + r.ms, 0) / runs.length;
const sql = runs[0].sql;

console.log(`\nCHECKOUT ${LABEL} — ${items.length} lines (2 plain + 2 sizes of one product)`);
console.log(`  statements per checkout : ${sql}`);
console.log(`  wall p50                : ${p50.toFixed(1)} ms   (mean ${mean.toFixed(1)} ms over ${RUNS} runs)`);
console.log(`  spread                  : ${Math.min(...runs.map((r) => r.ms)).toFixed(1)} – ${Math.max(...runs.map((r) => r.ms)).toFixed(1)} ms`);
await db.end();
