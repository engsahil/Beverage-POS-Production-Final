// GET  /api/shifts/:id         -> shift detail + summary (admin or own shift)
// POST /api/shifts/:id         -> close shift { closingCash, note? } (admin or own shift)
//
// Closing is atomic: the shift is locked, expected cash is computed from
// the sales recorded during the shift, and the result is stored.
import { query, withTransaction } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fail, ok, toNumber, str, round2, readJson, HttpError } from '@/lib/validate';

async function fetchShift(shiftId) {
  const rows = await query(
    `SELECT sh.*, u.full_name AS cashier_name
       FROM shifts sh JOIN users u ON u.id = sh.cashier_id
      WHERE sh.id = $1`,
    [shiftId]
  );
  return rows[0] || null;
}

function canAccess(user, shift) {
  return user.role === 'admin' || shift.cashier_id === user.id;
}

async function buildSummary(shift, closedAt) {
  const sales = await query(
    `SELECT COUNT(*)::int AS count,
            COALESCE(SUM(total), 0) AS total,
            COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total END), 0) AS cash,
            COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total END), 0) AS card,
            COALESCE(SUM(CASE WHEN payment_method = 'other' THEN total END), 0) AS other,
            COUNT(*) FILTER (WHERE payment_method = 'cash')::int AS cash_count
       FROM sales
      WHERE cashier_id = $1 AND created_at >= $2 AND created_at <= $3`,
    [shift.cashier_id, shift.opened_at, closedAt]
  );
  const expenses = await query(
    `SELECT id, category, amount, expense_date, note, created_at
       FROM expenses
      WHERE created_at >= $1 AND created_at <= $2
      ORDER BY created_at`,
    [shift.opened_at, closedAt]
  );
  return { sales: sales[0], expenses };
}

export async function GET(req, { params }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { id } = await params;
  const shiftId = Number(id);
  if (!Number.isInteger(shiftId)) return fail('Invalid shift id.', 404);

  const shift = await fetchShift(shiftId);
  if (!shift) return fail('Shift not found.', 404);
  if (!canAccess(auth.user, shift)) return fail('Shift not found.', 404);

  const summary = await buildSummary(shift, shift.closed_at || new Date().toISOString());
  return ok({ shift, summary });
}

export async function POST(req, { params }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { id } = await params;
  const shiftId = Number(id);
  if (!Number.isInteger(shiftId)) return fail('Invalid shift id.', 404);

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');
  const closingCash = toNumber(body.closingCash);
  if (closingCash === null || closingCash < 0) return fail('Enter the counted cash amount.');
  const note = str(body.note, { max: 200 }) ?? '';

  try {
    const result = await withTransaction(async (client) => {
      const lockRes = await client.query('SELECT * FROM shifts WHERE id = $1 FOR UPDATE', [shiftId]);
      const shift = lockRes.rows[0];
      if (!shift) throw new HttpError('Shift not found.', 404);
      if (!canAccess(auth.user, shift)) throw new HttpError('You cannot close this shift.', 403);
      if (shift.status !== 'open') throw new HttpError('This shift is already closed.', 409);

      const closedAt = new Date();
      const cashRes = await client.query(
        `SELECT COALESCE(SUM(total), 0) AS cash, COUNT(*)::int AS count
           FROM sales
          WHERE cashier_id = $1 AND payment_method = 'cash'
            AND created_at >= $2 AND created_at <= $3`,
        [shift.cashier_id, shift.opened_at, closedAt.toISOString()]
      );
      const cashSales = Number(cashRes.rows[0].cash);
      const expectedCash = round2(Number(shift.opening_cash) + cashSales);
      const diff = round2(closingCash - expectedCash);

      await client.query(
        `UPDATE shifts
            SET status = 'closed', closed_at = $2, closing_cash = $3,
                expected_cash = $4, difference = $5,
                note = CASE WHEN $6 = '' THEN note ELSE $6 END
          WHERE id = $1`,
        [shiftId, closedAt, closingCash, expectedCash, diff, note]
      );
      return { closedAt: closedAt.toISOString(), cashSales, expectedCash, diff };
    });

    const shift = await fetchShift(shiftId);
    const summary = await buildSummary(shift, result.closedAt);
    return ok({
      shift,
      summary,
      closing: {
        expectedCash: result.expectedCash,
        countedCash: closingCash,
        difference: result.diff,
        closedAt: result.closedAt,
      },
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    console.error('[shifts] close failed:', err);
    return fail('Unable to close the shift. Please try again.', 500);
  }
}
