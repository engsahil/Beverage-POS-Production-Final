// GET  /api/purchases/:id/payments -> list payments for one purchase (admin)
// POST /api/purchases/:id/payments -> record a payment against the invoice.
//
// Partial payments: any number of payments per invoice. Overpayments are
// blocked (the amount may not exceed the remaining balance) — there is no
// vendor advance workflow in this app. Amounts are NUMERIC end to end.
import { query, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { readJson, str, toNumber, validDate, fail, ok, round2, HttpError } from '@/lib/validate';
import { purchaseStatus } from '../../route.js';

const METHODS = ['cash', 'bank', 'card'];

export async function GET(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const purchaseId = Number((await params).id);
  if (!Number.isInteger(purchaseId)) return fail('Invalid purchase id.', 404);

  const payments = await query(
    `SELECT pp.id, pp.amount, pp.method, pp.payment_date, pp.reference, pp.note,
            u.full_name AS created_by_name
       FROM purchase_payments pp
       LEFT JOIN users u ON u.id = pp.created_by
      WHERE pp.purchase_id = $1
      ORDER BY pp.id`,
    [purchaseId]
  );
  return ok({ payments: payments.map((r) => ({ ...r, amount: Number(r.amount) })) });
}

export async function POST(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const purchaseId = Number((await params).id);
  if (!Number.isInteger(purchaseId)) return fail('Invalid purchase id.', 404);

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');

  const amount = toNumber(body.amount);
  const method = METHODS.includes(body.method) ? body.method : null;
  const reference = str(body.reference, { max: 80 }) ?? '';
  const note = str(body.note, { max: 200 }) ?? '';
  if (amount === null || amount <= 0) return fail('Enter an amount above zero.');
  if (!method) return fail('Select the payment method (cash, bank or card).');

  try {
    const settings = await getSettings();
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: settings.timezone });
    // Default date = business "today" in the store timezone (never raw UTC).
    const paymentDate = validDate(body.paymentDate) || today;
    const result = await withTransaction(async (client) => {
      const pr = await client.query(
        'SELECT id, vendor_id, purchase_date, due_date, total FROM purchases WHERE id = $1 FOR UPDATE',
        [purchaseId]
      );
      const purchase = pr.rows[0];
      if (!purchase) throw new HttpError('Purchase not found.', 404);

      const sum = await client.query('SELECT COALESCE(SUM(amount), 0) AS s FROM purchase_payments WHERE purchase_id = $1', [
        purchaseId,
      ]);
      const paid = Number(sum.rows[0].s);
      const remaining = round2(Number(purchase.total) - paid);
      if (amount > remaining + 0.005) {
        throw new HttpError(`Payment exceeds the remaining balance (${remaining.toFixed(2)}).`, 400);
      }

      const ins = await client.query(
        `INSERT INTO purchase_payments (purchase_id, vendor_id, amount, method, payment_date, reference, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [purchaseId, purchase.vendor_id, round2(amount), method, paymentDate, reference, note, auth.user.id]
      );
      const newPaid = round2(paid + amount);
      return { payment: ins.rows[0], newPaid, remaining: round2(remaining - amount) };
    });

    const rows = await query(
      'SELECT id, vendor_id, purchase_date, due_date, total FROM purchases WHERE id = $1',
      [purchaseId]
    );
    const purchase = { ...rows[0], paid: result.newPaid };
    return ok({
      payment: { ...result.payment, amount: Number(result.payment.amount) },
      purchase: purchaseStatus(purchase, today),
      remaining: result.remaining,
    }, 201);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    console.error('[purchases] payment failed:', err);
    return fail('Unable to record the payment. Please try again.', 500);
  }
}
