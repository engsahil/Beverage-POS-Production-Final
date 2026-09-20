// Seeds the two initial system accounts ONLY.
// It never touches any other data and is safe to re-run
// (existing users are left exactly as they are).
import pg from 'pg';
import { hashPassword } from '../lib/password.js';
import { loadEnv } from './env.mjs';

loadEnv();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function ensureUser(username, password, fullName, role) {
  const seen = await db.query('SELECT id FROM users WHERE username = $1', [username]);
  if (seen.rows.length > 0) {
    console.log(`= user '${username}': already exists, skipped`);
    return;
  }
  await db.query(
    'INSERT INTO users (username, full_name, password_hash, role) VALUES ($1, $2, $3, $4)',
    [username, fullName, hashPassword(password), role]
  );
  console.log(`= created ${role} user '${username}'`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.');
    process.exit(1);
  }
  await db.connect();
  try {
    const tables = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'users'`
    );
    if (tables.rows.length === 0) {
      console.error("Table 'users' does not exist. Run 'npm run db:migrate' first.");
      process.exit(1);
    }
    await ensureUser('admin', 'Admin123', 'Administrator', 'admin');
    await ensureUser('cashier', 'Cashier123', 'Cashier', 'cashier');
    console.log('Seed complete.');
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
