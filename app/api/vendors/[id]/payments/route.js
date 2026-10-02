// GET  /api/vendors/:id/payments -> list payments for a vendor (admin)
// POST /api/vendors/:id/payments -> record a payment to a vendor (admin)
// Uses the single `purchase_payments` table so Vendor Ledger, Vendors list,
// Finance Payables, Balance Sheet, Cash Flow, and Credit & Dues all share
// one source of truth.
import { query, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { readJson, str, toNumber, validDate, fail, ok, round2, HttpError } from '@/lib/validate';
import { VENDOR_SELECT_SQL, formatVendorRow } from '../../route.js';

const METHODS = ['cash', 'bank', 'card'];
const MAX_AMOUNT = 999_999_999.99;

export async function GET(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const vendorId = Number((await params).id);
  if (!Number.isInteger(vendorId)) return fail('Invalid vendor id.', 404);

  const payments = await query(
    `SELECT pp.id, pp.purchase_id, pp.vendor_id, pp.amount, pp.method,
            pp.payment_date, pp.reference, pp.note, u.full_name AS created_by_name
       FROM purchase_payments pp
       LEFT JOIN users u ON u.id = pp.created_by
      WHERE pp.vendor_id = $1
      ORDER BY pp.payment_date DESC, pp.id DESC`,
    [vendorId]
  );
  return ok({ payments: payments.map((r) => ({ ...r, amount: Number(r.amount) })) });
}

export async function POST(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const vendorId = Number((await params).id);
  if (!Number.isInteger(vendorId)) return fail('Invalid vendor id.', 404);

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');

  const amount = toNumber(body.amount);
  const method = METHODS.includes(body.method) ? body.method : null;
  const reference = str(body.reference, { max: 80 }) ?? '';
  const note = str(body.note, { max: 200 }) ?? '';
  const purchaseId = body.purchaseId ? Number(body.purchaseId) : null;

  if (amount === null || amount <= 0) return fail('Enter an amount above zero.');
  if (amount > MAX_AMOUNT) return fail('Amount exceeds the maximum allowed value.');
  if (!method) return fail('Select the payment method (cash, bank or card).');
  if (body.paymentDate && !validDate(body.paymentDate)) return fail('Invalid payment date.');

  try {
    const settings = await getSettings();
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: settings.timezone });
    const paymentDate = validDate(body.paymentDate) || today;

    const payment = await withTransaction(async (client) => {
      const vRes = await client.query(
        `SELECT id, name,
                COALESCE(opening_balance, 0) AS opening_balance,
                COALESCE(opening_balance_type, 'payable') AS opening_balance_type
           FROM vendors WHERE id = $1 FOR UPDATE`,
        [vendorId]
      );
      const v = vRes.rows[0];
      if (!v) throw new HttpError('Vendor not found.', 404);

      const totalsRes = await client.query(
        `SELECT COALESCE((SELECT SUM(total) FROM purchases WHERE vendor_id = $1), 0) AS purchases,
                COALESCE((SELECT SUM(amount) FROM purchase_payments WHERE vendor_id = $1), 0) AS payments,
                COALESCE((SELECT SUM(amount) FROM vendor_claims WHERE vendor_id = $1 AND status = 'settled'), 0) AS claims`,
        [vendorId]
      );
      const t = totalsRes.rows[0];
      const ob = Number(v.opening_balance || 0);
      const signedOb = v.opening_balance_type === 'receivable' ? -ob : ob;
      const outstanding = round2(signedOb + Number(t.purchases) - Number(t.payments) - Number(t.claims));
      const payable = round2(Math.max(0, outstanding));

      if (amount > payable + 0.005) {
        throw new HttpError(
          `Payment exceeds the vendor's payable balance (${payable.toFixed(2)}).`,
          400
        );
      }

      let linkedPurchaseId = null;
      if (purchaseId) {
        const prRes = await client.query(
          'SELECT id, total FROM purchases WHERE id = $1 AND vendor_id = $2 FOR UPDATE',
          [purchaseId, vendorId]
        );
        if (!prRes.rows[0]) throw new HttpError('Selected purchase not found for this vendor.', 404);
        linkedPurchaseId = purchaseId;
      } else {
        // If there is a single open purchase that can absorb this payment, link it;
        // otherwise record as a vendor-level payment (purchase_id = NULL).
        const openPr = await client.query(
          `SELECT pr.id,
                  pr.total - COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp WHERE pp.purchase_id = pr.id), 0) AS rem
             FROM purchases pr
            WHERE pr.vendor_id = $1
            ORDER BY pr.purchase_date ASC, pr.id ASC`,
          [vendorId]
        );
        const match = openPr.rows.find((r) => Number(r.rem) >= amount - 0.005);
        if (match) linkedPurchaseId = match.id;
      }

      const ins = await client.query(
        `INSERT INTO purchase_payments (purchase_id, vendor_id, amount, method, payment_date, reference, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [linkedPurchaseId, vendorId, round2(amount), method, paymentDate, reference, note, auth.user.id]
      );
      return ins.rows[0];
    });

    const updated = await query(`${VENDOR_SELECT_SQL} WHERE v.id = $1`, [vendorId]);
    return ok(
      {
        payment: { ...payment, amount: Number(payment.amount) },
        vendor: formatVendorRow(updated[0]),
      },
      201
    );
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    console.error('[vendors] payment failed:', err);
    return fail('Unable to record vendor payment. Please try again.', 500);
  }
}
