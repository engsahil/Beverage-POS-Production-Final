// GET /api/reports/:type?from=&to= (admin, or cashier with the reports permission)
// Lightweight report endpoints returning { columns, rows }.
// The UI renders them and exports CSV from the same data.
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { getSettings } from '@/lib/settings';
import { validDate, fail, ok } from '@/lib/validate';

export async function GET(req, { params }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  if (!hasPermission(auth.user, 'reports')) {
    return fail('You do not have permission to view reports.', 403);
  }
  const { type } = await params;
  const settings = await getSettings();
  const tz = settings.timezone;

  const sp = req.nextUrl.searchParams;
  const from = validDate(sp.get('from'));
  const to = validDate(sp.get('to'));
  if (sp.get('from') && !from) return fail('Invalid "from" date.');
  if (sp.get('to') && !to) return fail('Invalid "to" date.');

  // Default range: last 30 business days in the STORE timezone (not UTC),
  // consistent with every other date the app reports by.
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const d0 = new Date(todayStr + 'T00:00:00Z');
  d0.setUTCDate(d0.getUTCDate() - 29);
  const defaultTo = todayStr;
  const defaultFrom = d0.toISOString().slice(0, 10);

  if (type === 'inventory') {
    const rows = await query(
      `SELECT p.name AS product,
              COALESCE(c.name, '—') AS category,
              p.stock, p.min_stock, p.cost,
              (p.stock * p.cost) AS value
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.name`
    );
    return ok({
      columns: [
        { key: 'product', label: 'Product' },
        { key: 'category', label: 'Category' },
        { key: 'stock', label: 'Stock' },
        { key: 'min_stock', label: 'Min Stock' },
        { key: 'cost', label: 'Unit Cost' },
        { key: 'value', label: 'Stock Value' },
      ],
      rows: rows.map((r) => ({ ...r, stock: Number(r.stock), min_stock: Number(r.min_stock), cost: Number(r.cost), value: Number(r.value) })),
    });
  }

  // Date-range reports below.
  const f = from || defaultFrom;
  const t = to || defaultTo;
  const dateWhere = `(s.created_at AT TIME ZONE $1)::date >= $2 AND (s.created_at AT TIME ZONE $1)::date <= $3`;
  const baseParams = [tz, f, t];

  if (type === 'daily' || type === 'range') {
    const rows = await query(
      `SELECT (s.created_at AT TIME ZONE $1)::date AS d,
              COUNT(*)::int AS orders,
              COALESCE(SUM(s.total), 0) AS sales,
              COALESCE(SUM(CASE WHEN s.payment_method = 'cash' THEN s.total END), 0) AS cash,
              COALESCE(SUM(CASE WHEN s.payment_method = 'card' THEN s.total END), 0) AS card,
              COALESCE(SUM(CASE WHEN s.payment_method = 'other' THEN s.total END), 0) AS other,
              COALESCE(SUM(s.discount), 0) AS discount
       FROM sales s
      WHERE ${dateWhere}
      GROUP BY 1
      ORDER BY 1 DESC`,
      baseParams
    );
    return ok({
      range: { from: f, to: t },
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'orders', label: 'Orders' },
        { key: 'sales', label: 'Sales' },
        { key: 'cash', label: 'Cash' },
        { key: 'card', label: 'Card' },
        { key: 'other', label: 'Other' },
        { key: 'discount', label: 'Discounts' },
      ],
      rows: rows.map((r) => ({
        date: r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10),
        orders: r.orders,
        sales: Number(r.sales),
        cash: Number(r.cash),
        card: Number(r.card),
        other: Number(r.other),
        discount: Number(r.discount),
      })),
    });
  }

  if (type === 'cashiers') {
    const rows = await query(
      `SELECT u.full_name AS cashier,
              COUNT(*)::int AS orders,
              COALESCE(SUM(s.total), 0) AS sales,
              COALESCE(SUM(s.discount), 0) AS discount
       FROM sales s
       JOIN users u ON u.id = s.cashier_id
      WHERE ${dateWhere}
      GROUP BY u.full_name, u.id
      ORDER BY sales DESC`,
      baseParams
    );
    return ok({
      range: { from: f, to: t },
      columns: [
        { key: 'cashier', label: 'Cashier' },
        { key: 'orders', label: 'Orders' },
        { key: 'sales', label: 'Sales' },
        { key: 'discount', label: 'Discounts' },
      ],
      rows: rows.map((r) => ({ ...r, sales: Number(r.sales), discount: Number(r.discount) })),
    });
  }

  if (type === 'products') {
    const rows = await query(
      `SELECT p.name AS product,
              COALESCE(SUM(si.qty), 0) AS qty_sold,
              COALESCE(SUM(si.qty * si.unit_price), 0) AS revenue
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
      WHERE ${dateWhere}
      GROUP BY p.name, p.id
      ORDER BY qty_sold DESC, revenue DESC`,
      baseParams
    );
    return ok({
      range: { from: f, to: t },
      columns: [
        { key: 'product', label: 'Product' },
        { key: 'qty_sold', label: 'Qty Sold' },
        { key: 'revenue', label: 'Revenue' },
      ],
      rows: rows.map((r) => ({ ...r, qty_sold: Number(r.qty_sold), revenue: Number(r.revenue) })),
    });
  }

  if (type === 'purchases') {
    const rows = await query(
      `SELECT v.name AS vendor,
              pr.purchase_date AS d,
              COUNT(*)::int AS purchases,
              COALESCE(SUM(pr.total), 0) AS total
       FROM purchases pr
       JOIN vendors v ON v.id = pr.vendor_id
      WHERE pr.purchase_date >= $1 AND pr.purchase_date <= $2
      GROUP BY v.name, pr.purchase_date
      ORDER BY pr.purchase_date DESC, v.name`,
      [f, t]
    );
    return ok({
      range: { from: f, to: t },
      columns: [
        { key: 'vendor', label: 'Vendor' },
        { key: 'date', label: 'Date' },
        { key: 'purchases', label: 'Purchases' },
        { key: 'total', label: 'Total' },
      ],
      rows: rows.map((r) => ({
        vendor: r.vendor,
        date: r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10),
        purchases: r.purchases,
        total: Number(r.total),
      })),
    });
  }

  return fail('Unknown report type.', 400);
}
