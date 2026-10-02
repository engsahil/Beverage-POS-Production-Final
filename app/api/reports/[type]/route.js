// GET /api/reports/:type?from=&to= (admin, or cashier with the reports permission)
// Lightweight report endpoints returning { columns, rows, summary?, dailyBreakdown? }.
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { getSettings } from '@/lib/settings';
import { validDate, fail, ok, okGzip, round2 } from '@/lib/validate';
import { variantAggregate, stockValueExpr, unitCostExpr } from '@/lib/inventory';
import { dayGte, dayLte } from '@/lib/date-range';

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

function shiftDays(dateStr, deltaDays) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function summarizeSalesRows(rows) {
  let totalSales = 0;
  let totalOrders = 0;
  let cash = 0;
  let card = 0;
  let other = 0;
  let discount = 0;
  for (const r of rows) {
    totalSales = round2(totalSales + Number(r.sales || 0));
    totalOrders += Number(r.orders || 0);
    cash = round2(cash + Number(r.cash || 0));
    card = round2(card + Number(r.card || 0));
    other = round2(other + Number(r.other || 0));
    discount = round2(discount + Number(r.discount || 0));
  }
  return {
    total_sales: totalSales,
    total_orders: totalOrders,
    cash,
    card,
    other,
    discount,
    avg_order: totalOrders > 0 ? round2(totalSales / totalOrders) : 0,
  };
}

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

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const defaultLookback = type === 'monthly' ? -364 : type === 'weekly' ? -83 : -29;
  const defaultTo = todayStr;
  const defaultFrom = shiftDays(todayStr, defaultLookback);

  if (type === 'inventory') {
    const rows = await query(
      `SELECT p.name AS product,
              COALESCE(c.name, '—') AS category,
              p.stock, p.min_stock,
              v.variant_count AS sizes,
              ${unitCostExpr('p', 'v')} AS cost,
              ${stockValueExpr('p', 'v')} AS value
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ${variantAggregate('p', 'v')}
      ORDER BY p.name`
    );
    return okGzip(
      {
        columns: [
          { key: 'product', label: 'Product' },
          { key: 'category', label: 'Category' },
          { key: 'stock', label: 'Stock' },
          { key: 'min_stock', label: 'Min Stock' },
          { key: 'sizes', label: 'Sizes' },
          { key: 'cost', label: 'Unit Cost' },
          { key: 'value', label: 'Stock Value' },
        ],
        rows: rows.map((r) => ({
          ...r,
          stock: Number(r.stock),
          min_stock: Number(r.min_stock),
          sizes: Number(r.sizes),
          cost: Number(r.cost),
          value: Number(r.value),
        })),
      },
      req
    );
  }

  const f = from || defaultFrom;
  const t = to || defaultTo;
  const dateWhere = `${dayGte('s.created_at', '$1', '$2')} AND ${dayLte('s.created_at', '$1', '$3')}`;
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
    const mapped = rows.map((r) => {
      const sales = round2(Number(r.sales));
      const orders = Number(r.orders);
      return {
        date: iso(r.d),
        orders,
        sales,
        cash: round2(Number(r.cash)),
        card: round2(Number(r.card)),
        other: round2(Number(r.other)),
        discount: round2(Number(r.discount)),
        avg_order: orders > 0 ? round2(sales / orders) : 0,
      };
    });
    return okGzip(
      {
        range: { from: f, to: t },
        summary: summarizeSalesRows(mapped),
        dailyBreakdown: mapped,
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'orders', label: 'Orders' },
          { key: 'sales', label: 'Sales' },
          { key: 'cash', label: 'Cash' },
          { key: 'card', label: 'Card' },
          { key: 'other', label: 'Other' },
          { key: 'discount', label: 'Discounts' },
          { key: 'avg_order', label: 'Avg Order' },
        ],
        rows: mapped,
      },
      req
    );
  }

  if (type === 'weekly') {
    const [weekRows, dayRows] = await Promise.all([
      query(
        `SELECT date_trunc('week', s.created_at AT TIME ZONE $1)::date AS week_start,
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
      ),
      query(
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
      ),
    ]);

    const mappedWeeks = weekRows.map((r) => {
      const ws = iso(r.week_start);
      const we = shiftDays(ws, 6);
      const sales = round2(Number(r.sales));
      const orders = Number(r.orders);
      return {
        week_start: ws,
        week_end: we,
        period: `${ws} to ${we}`,
        orders,
        sales,
        cash: round2(Number(r.cash)),
        card: round2(Number(r.card)),
        other: round2(Number(r.other)),
        discount: round2(Number(r.discount)),
        avg_order: orders > 0 ? round2(sales / orders) : 0,
      };
    });

    const mappedDays = dayRows.map((r) => {
      const sales = round2(Number(r.sales));
      const orders = Number(r.orders);
      return {
        date: iso(r.d),
        orders,
        sales,
        cash: round2(Number(r.cash)),
        card: round2(Number(r.card)),
        other: round2(Number(r.other)),
        discount: round2(Number(r.discount)),
        avg_order: orders > 0 ? round2(sales / orders) : 0,
      };
    });

    return okGzip(
      {
        range: { from: f, to: t },
        summary: summarizeSalesRows(mappedWeeks),
        dailyBreakdown: mappedDays,
        columns: [
          { key: 'period', label: 'Week' },
          { key: 'orders', label: 'Orders' },
          { key: 'sales', label: 'Sales' },
          { key: 'cash', label: 'Cash' },
          { key: 'card', label: 'Card' },
          { key: 'other', label: 'Other' },
          { key: 'discount', label: 'Discounts' },
          { key: 'avg_order', label: 'Avg Order' },
        ],
        rows: mappedWeeks,
      },
      req
    );
  }

  if (type === 'monthly') {
    const [monthRows, dayRows] = await Promise.all([
      query(
        `SELECT to_char(date_trunc('month', s.created_at AT TIME ZONE $1), 'YYYY-MM') AS month,
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
      ),
      query(
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
      ),
    ]);

    const mappedMonths = monthRows.map((r) => {
      const sales = round2(Number(r.sales));
      const orders = Number(r.orders);
      return {
        month: r.month,
        orders,
        sales,
        cash: round2(Number(r.cash)),
        card: round2(Number(r.card)),
        other: round2(Number(r.other)),
        discount: round2(Number(r.discount)),
        avg_order: orders > 0 ? round2(sales / orders) : 0,
      };
    });

    const mappedDays = dayRows.map((r) => {
      const sales = round2(Number(r.sales));
      const orders = Number(r.orders);
      return {
        date: iso(r.d),
        orders,
        sales,
        cash: round2(Number(r.cash)),
        card: round2(Number(r.card)),
        other: round2(Number(r.other)),
        discount: round2(Number(r.discount)),
        avg_order: orders > 0 ? round2(sales / orders) : 0,
      };
    });

    return okGzip(
      {
        range: { from: f, to: t },
        summary: summarizeSalesRows(mappedMonths),
        dailyBreakdown: mappedDays,
        columns: [
          { key: 'month', label: 'Month' },
          { key: 'orders', label: 'Orders' },
          { key: 'sales', label: 'Sales' },
          { key: 'cash', label: 'Cash' },
          { key: 'card', label: 'Card' },
          { key: 'other', label: 'Other' },
          { key: 'discount', label: 'Discounts' },
          { key: 'avg_order', label: 'Avg Order' },
        ],
        rows: mappedMonths,
      },
      req
    );
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
    return okGzip(
      {
        range: { from: f, to: t },
        columns: [
          { key: 'cashier', label: 'Cashier' },
          { key: 'orders', label: 'Orders' },
          { key: 'sales', label: 'Sales' },
          { key: 'discount', label: 'Discounts' },
        ],
        rows: rows.map((r) => ({ ...r, sales: Number(r.sales), discount: Number(r.discount) })),
      },
      req
    );
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
    return okGzip(
      {
        range: { from: f, to: t },
        columns: [
          { key: 'product', label: 'Product' },
          { key: 'qty_sold', label: 'Qty Sold' },
          { key: 'revenue', label: 'Revenue' },
        ],
        rows: rows.map((r) => ({ ...r, qty_sold: Number(r.qty_sold), revenue: Number(r.revenue) })),
      },
      req
    );
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
    return okGzip(
      {
        range: { from: f, to: t },
        columns: [
          { key: 'vendor', label: 'Vendor' },
          { key: 'date', label: 'Date' },
          { key: 'purchases', label: 'Purchases' },
          { key: 'total', label: 'Total' },
        ],
        rows: rows.map((r) => ({
          vendor: r.vendor,
          date: iso(r.d),
          purchases: r.purchases,
          total: Number(r.total),
        })),
      },
      req
    );
  }

  return fail('Unknown report type.', 400);
}
