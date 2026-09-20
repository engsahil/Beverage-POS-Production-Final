// GET  /api/shifts -> list (admin: all; others: own)
// POST /api/shifts -> open a shift { openingCash, note? }
// A cashier can have at most one open shift. POS works with or without
// an open shift — shifts are for cash reconciliation, never a gate.
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { readJson, toNumber, str, fail, ok, round2 } from '@/lib/validate';

export async function GET(req) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const isAdmin = auth.user.role === 'admin';
  const where = isAdmin ? '' : 'WHERE sh.cashier_id = $1';
  const params = isAdmin ? [] : [auth.user.id];
  const rows = await query(
    `SELECT sh.id, sh.cashier_id, sh.opened_at, sh.opening_cash, sh.closed_at,
            sh.closing_cash, sh.expected_cash, sh.difference, sh.status, sh.note,
            u.full_name AS cashier_name
       FROM shifts sh
       JOIN users u ON u.id = sh.cashier_id
       ${where}
      ORDER BY sh.id DESC
      LIMIT 50`,
    params
  );
  return ok({ shifts: rows });
}

export async function POST(req) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');
  const openingCash = toNumber(body.openingCash);
  if (openingCash === null || openingCash < 0) return fail('Enter the opening cash amount.');
  const note = str(body.note, { max: 200 }) ?? '';

  const open = await query(
    "SELECT id FROM shifts WHERE cashier_id = $1 AND status = 'open'",
    [auth.user.id]
  );
  if (open.length > 0) return fail('You already have an open shift. Close it first.', 409);

  const rows = await query(
    'INSERT INTO shifts (cashier_id, opening_cash, note) VALUES ($1, $2, $3) RETURNING id',
    [auth.user.id, round2(openingCash), note]
  );
  return ok({ id: rows[0].id }, 201);
}
