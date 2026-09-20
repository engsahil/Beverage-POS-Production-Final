// GET  /api/users/:id/price-limits -> cashier's minimum prices (admin)
// PUT  /api/users/:id/price-limits -> set/clear them (admin)
//
// Admin-only configuration of the minimum selling price a CASHIER may
// reach, per pricing mode (retail / wholesale / special).
//   - null  = no limit for that mode
//   - number (>= 0) = the cashier may not sell that mode below it
// Admins are never limited (the sales endpoint skips the check for them).
// Cashiers have no access to this route at all, so nobody can raise or
// lower their own limits; enforcement happens server-side in /api/sales.
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { readJson, toNumber, fail, ok, round2 } from '@/lib/validate';

const FIELDS = [
  ['retailMin', 'retail_min'],
  ['wholesaleMin', 'wholesale_min'],
  ['specialMin', 'special_min'],
];

const MAX_LIMIT = 999999999;

/** null = clear; otherwise a finite number >= 0 (or null = invalid). */
function parseLimit(value) {
  if (value === undefined) return { absent: true, value: null };
  if (value === null || value === '') return { absent: false, value: null };
  const n = toNumber(value);
  if (n === null || n < 0 || n > MAX_LIMIT) return { absent: false, value: 'invalid' };
  return { absent: false, value: round2(n) };
}

export async function GET(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const userId = Number((await params).id);
  if (!Number.isInteger(userId)) return fail('Invalid user id.', 404);

  const rows = await query('SELECT id FROM users WHERE id = $1', [userId]);
  if (!rows.length) return fail('User not found.', 404);

  const r = (
    await query(
      'SELECT retail_min, wholesale_min, special_min FROM cashier_price_limits WHERE user_id = $1',
      [userId]
    )
  )[0];
  return ok({
    retailMin: r && r.retail_min !== null ? Number(r.retail_min) : null,
    wholesaleMin: r && r.wholesale_min !== null ? Number(r.wholesale_min) : null,
    specialMin: r && r.special_min !== null ? Number(r.special_min) : null,
  });
}

export async function PUT(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const userId = Number((await params).id);
  if (!Number.isInteger(userId)) return fail('Invalid user id.', 404);

  const rows = await query("SELECT id, role FROM users WHERE id = $1", [userId]);
  if (!rows.length) return fail('User not found.', 404);
  if (rows[0].role !== 'cashier') return fail('Price limits apply to cashiers only.');

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');

  const values = [];
  for (const [key] of FIELDS) {
    const parsed = parseLimit(body[key]);
    if (!parsed.absent && parsed.value === 'invalid') {
      return fail(`${key} must be a number of 0 or more (leave blank for no limit).`);
    }
    values.push(parsed.absent ? 'KEEP' : parsed.value);
  }
  // No field sent = keep everything (nothing to do).
  if (values.every((v) => v === 'KEEP')) return ok(null);

  const cur = (
    await query(
      'SELECT retail_min, wholesale_min, special_min FROM cashier_price_limits WHERE user_id = $1',
      [userId]
    )
  )[0];
  const final = FIELDS.map(([key, col], i) => (values[i] === 'KEEP' ? cur?.[col] ?? null : values[i]));

  await query(
    `INSERT INTO cashier_price_limits (user_id, retail_min, wholesale_min, special_min, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id) DO UPDATE SET
       retail_min = EXCLUDED.retail_min,
       wholesale_min = EXCLUDED.wholesale_min,
       special_min = EXCLUDED.special_min,
       updated_at = now()`,
    [userId, ...final]
  );

  return ok({
    retailMin: final[0] === null ? null : Number(final[0]),
    wholesaleMin: final[1] === null ? null : Number(final[1]),
    specialMin: final[2] === null ? null : Number(final[2]),
  });
}
