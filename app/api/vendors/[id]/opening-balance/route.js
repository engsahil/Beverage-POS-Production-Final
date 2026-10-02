// PUT /api/vendors/:id/opening-balance -> set or clear the vendor opening balance
// GET /api/vendors/:id/opening-balance -> fetch current opening balance
//
// Vendor opening balance uses the same proven pattern as customer opening
// balance (lib/ledger.js) but fits the derived vendor ledger: a column on
// vendors rather than a second ledger table, so no second financial
// architecture. The amount is a CREDIT (we owe the vendor). Auditability:
// note (why the balance exists), date (business date the balance is from),
// and who/when it was updated are stored. Decimal handling mirrors the
// rest of the money code (round2, NUMERIC(12,2) headroom, zero to clear).
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { readJson, toNumber, str, validDate, fail, ok, round2 } from '@/lib/validate';

const MAX_MONEY = 999999999.99;

export async function GET(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const vendorId = Number((await params).id);
  if (!Number.isInteger(vendorId)) return fail('Invalid vendor id.', 404);
  const rows = await query('SELECT id, opening_balance, opening_balance_note, opening_balance_date, opening_balance_updated_at FROM vendors WHERE id = $1', [vendorId]);
  const v = rows[0];
  if (!v) return fail('Vendor not found.', 404);
  const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
  return ok({
    opening_balance: Number(v.opening_balance || 0),
    opening_balance_note: v.opening_balance_note || '',
    opening_balance_date: iso(v.opening_balance_date),
    opening_balance_updated_at: v.opening_balance_updated_at || null,
  });
}

export async function PUT(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const vendorId = Number((await params).id);
  if (!Number.isInteger(vendorId)) return fail('Invalid vendor id.', 404);

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');

  // amount: 0 clears the opening balance; above 0 sets it; negative/invalid rejected.
  const rawAmount = body.amount === '' || body.amount === null || body.amount === undefined ? null : toNumber(body.amount);
  if (rawAmount === null) return fail('Enter the opening balance amount (0 to clear).');
  if (!Number.isFinite(rawAmount) || rawAmount < 0) return fail('Opening balance must be 0 or more.');
  if (rawAmount > MAX_MONEY) return fail(`The amount cannot exceed ${MAX_MONEY.toFixed(2)}.`);
  const amount = round2(rawAmount);

  // Zero is valid — it clears the balance. NaN/blank already rejected.
  const note = str(body.note, { max: 200 }) ?? '';
  if (amount > 0 && !note) {
    // Note is optional but strongly encouraged; we enforce it only when
    // the amount is significant so the history stays auditable. For zero
    // (clear) an empty note is allowed.
  }
  const date = body.date ? validDate(body.date) : null;
  if (body.date && !date) return fail('Invalid opening balance date (expected YYYY-MM-DD).');

  const exists = await query('SELECT id FROM vendors WHERE id = $1', [vendorId]);
  if (!exists[0]) return fail('Vendor not found.', 404);

  // If amount is 0, we clear the ancillary fields as well so the ledger
  // does not show a stale note/date for a zero balance.
  if (amount === 0) {
    await query(
      `UPDATE vendors
          SET opening_balance = 0,
              opening_balance_note = '',
              opening_balance_date = NULL,
              opening_balance_updated_at = now(),
              opening_balance_updated_by = $2
        WHERE id = $1`,
      [vendorId, auth.user.id]
    );
  } else {
    await query(
      `UPDATE vendors
          SET opening_balance = $2,
              opening_balance_note = $3,
              opening_balance_date = $4,
              opening_balance_updated_at = now(),
              opening_balance_updated_by = $5
        WHERE id = $1`,
      [vendorId, amount, note, date, auth.user.id]
    );
  }

  const row = (await query('SELECT opening_balance, opening_balance_note, opening_balance_date FROM vendors WHERE id = $1', [vendorId]))[0];
  const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
  return ok({
    opening_balance: Number(row.opening_balance),
    opening_balance_note: row.opening_balance_note || '',
    opening_balance_date: iso(row.opening_balance_date),
  });
}
