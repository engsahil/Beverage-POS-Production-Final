// GET /api/purchases/:id -> purchase detail with items + payments (admin)
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { fail, ok, round2 } from '@/lib/validate';
import { purchaseStatus } from '../route.js';

export async function GET(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;
  const purchaseId = Number(id);
  if (!Number.isInteger(purchaseId)) return fail('Invalid purchase id.', 404);

  const settings = await getSettings();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: settings.timezone });

  const rows = await query(
    `SELECT pr.id, pr.vendor_id, pr.purchase_date, pr.due_date, pr.total, pr.notes, pr.created_at,
            (pr.attachment_data IS NOT NULL) AS has_attachment,
            pr.attachment_name,
            COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp WHERE pp.purchase_id = pr.id), 0) AS paid,
            v.name AS vendor_name, u.full_name AS created_by_name
       FROM purchases pr
       JOIN vendors v ON v.id = pr.vendor_id
       LEFT JOIN users u ON u.id = pr.created_by
      WHERE pr.id = $1`,
    [purchaseId]
  );
  const purchase = rows[0];
  if (!purchase) return fail('Purchase not found.', 404);

  const items = await query(
    `SELECT pi.qty, pi.cost, pi.batch_no, pi.expiry_date,
            p.name AS product_name,
            COALESCE(vv.name, '') AS variant_name
       FROM purchase_items pi
       JOIN products p ON p.id = pi.product_id
       LEFT JOIN product_variants vv ON vv.id = pi.variant_id
      WHERE pi.purchase_id = $1
      ORDER BY pi.id`,
    [purchaseId]
  );

  const payments = await query(
    `SELECT pp.id, pp.amount, pp.method, pp.payment_date, pp.reference, pp.note,
            u.full_name AS created_by_name
       FROM purchase_payments pp
       LEFT JOIN users u ON u.id = pp.created_by
      WHERE pp.purchase_id = $1
      ORDER BY pp.id`,
    [purchaseId]
  );

  const paid = Number(purchase.paid);
  return ok({
    purchase: purchaseStatus(purchase, today),
    items: items.map((r) => ({ ...r, qty: Number(r.qty), cost: Number(r.cost) })),
    payments: payments.map((r) => ({ ...r, amount: Number(r.amount) })),
    remaining: round2(Number(purchase.total) - paid),
  });
}
