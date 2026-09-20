// Database migration runner.
//
// Migrations are ADDITIVE ONLY. Each migration file is applied once
// (tracked in schema_migrations) and is written so that re-running it
// can never drop or destroy data. NEVER run destructive commands
// (prisma migrate reset, DROP DATABASE, DROP TABLE) against this app.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadEnv } from './env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv();

// Append new migration files here. Do not edit applied ones.
const MIGRATIONS = [
  { name: '001_init', file: 'db/schema.sql' },
  { name: '002_features', file: 'db/schema-002.sql' },
  { name: '003_dual_receipt_variants', file: 'db/schema-003.sql' },
  { name: '004_full_variants', file: 'db/schema-004.sql' },
  { name: '005_vendor_payments_finance', file: 'db/schema-005.sql' },
  { name: '006_pricing_modes_cashier_limits', file: 'db/schema-006.sql' },
  { name: '007_per_line_pricing_modes', file: 'db/schema-007.sql' },
  { name: '008_product_variant_min_prices', file: 'db/schema-008.sql' },
];

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.');
    process.exit(1);
  }
  await db.connect();
  try {
    await db.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );
    for (const m of MIGRATIONS) {
      const seen = await db.query('SELECT 1 FROM schema_migrations WHERE name = $1', [m.name]);
      if (seen.rows.length > 0) {
        console.log(`= ${m.name}: already applied, skipped`);
        continue;
      }
      const sql = readFileSync(path.join(__dirname, '..', m.file), 'utf8');
      console.log(`Applying ${m.name} ...`);
      await db.query('BEGIN');
      try {
        await db.query(sql); // multi-statement, no parameters
        await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [m.name]);
        await db.query('COMMIT');
        console.log(`= ${m.name}: applied`);
      } catch (err) {
        await db.query('ROLLBACK');
        throw err;
      }
    }
    console.log('Database is up to date.');
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
