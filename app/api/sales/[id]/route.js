// GET /api/sales/:id -> sale detail with items
// Cashiers may only open their own sales; others require the reprint permission.
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { hasPermission } from '@/lib/permissions';
import { fail, ok } from '@/lib/validate';

export async function GET(req, { params }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { id } = await params;
  const saleId = Number(id);
  if (!Number.isInteger(saleId)) return fail('Invalid sale id.', 404);

  const rows = await query(
    `SELECT s.id, s.sale_no, s.cashier_id, s.created_at, s.subtotal, s.discount, s.total,
            s.payment_method, s.paid, s.change_due, s.status, s.pricing_mode,
            s.customer_name, s.customer_phone, s.table_no, s.notes,
            COALESCE(c.name, NULLIF(s.customer_name, '')) AS customer_name,
            u.full_name AS cashier_name
       FROM sales s
       JOIN users u ON u.id = s.cashier_id
       LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.id = $1`,
    [saleId]
  );
  const sale = rows[0];
  if (!sale) return fail('Sale not found.', 404);
  if (sale.cashier_id !== auth.user.id && !hasPermission(auth.user, 'reprint')) {
    return fail('Sale not found.', 404);
  }

  const items = await query(
    `SELECT name, qty, unit_price, COALESCE(variant, '') AS variant, COALESCE(pricing_mode, 'retail') AS pricing_mode
       FROM sale_items
      WHERE sale_id = $1
      ORDER BY id`,
    [saleId]
  );

  const settings = await getSettings();
  return ok({ sale, items, settings });
}
