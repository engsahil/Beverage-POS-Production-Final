// DELETE /api/purchases/:id/payments/:paymentId -> remove a recorded payment (admin)
// Removing a payment re-opens the corresponding amount on the invoice;
// balances are recomputed from the remaining payments (nothing is stored
// on the purchase row, so there is nothing to go out of sync).
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { fail, ok } from '@/lib/validate';
import { purchaseStatus } from '../../../route.js';

export async function DELETE(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id, paymentId } = await params;
  const purchaseId = Number(id);
  const payment = Number(paymentId);
  if (!Number.isInteger(purchaseId) || !Number.isInteger(payment)) return fail('Invalid payment id.', 404);

  const res = await query(
    'DELETE FROM purchase_payments WHERE id = $1 AND purchase_id = $2 RETURNING id',
    [payment, purchaseId]
  );
  if (!res[0]) return fail('Payment not found.', 404);

  const settings = await getSettings();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: settings.timezone });

  const rows = await query(
    'SELECT id, vendor_id, purchase_date, due_date, total FROM purchases WHERE id = $1',
    [purchaseId]
  );
  const purchase = { ...rows[0], paid: 0 };
  const sum = await query('SELECT COALESCE(SUM(amount), 0) AS s FROM purchase_payments WHERE purchase_id = $1', [
    purchaseId,
  ]);
  purchase.paid = Number(sum[0].s);
  return ok({ purchase: purchaseStatus(purchase, today) });
}
