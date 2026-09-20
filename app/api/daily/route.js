// GET /api/daily?from=YYYY-MM-DD&to=YYYY-MM-DD (admin, or cashier with the reports permission)
// Daily records: sales by business date (using the configured timezone),
// plus purchases and expenses for each date.
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { getSettings } from '@/lib/settings';
import { validDate, fail, ok } from '@/lib/validate';

export async function GET(req) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  if (!hasPermission(auth.user, 'reports')) {
    return fail('You do not have permission to view reports.', 403);
  }
  const settings = await getSettings();
  const tz = settings.timezone;

  const sp = req.nextUrl.searchParams;
  const from = validDate(sp.get('from')) || null;
  const to = validDate(sp.get('to')) || null;
  if (sp.get('from') && !from) return fail('Invalid "from" date.');
  if (sp.get('to') && !to) return fail('Invalid "to" date.');

  const where = [];
  const params = [tz];
  if (from) {
    params.push(from);
    where.push(`(s.created_at AT TIME ZONE $1)::date >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`(s.created_at AT TIME ZONE $1)::date <= $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // The three aggregations are independent — build all three WHERE
  // clauses, then run the queries in parallel.
  const pWhere = [];
  const pParams = [];
  if (from) {
    pParams.push(from);
    pWhere.push(`purchase_date >= $${pParams.length}`);
  }
  if (to) {
    pParams.push(to);
    pWhere.push(`purchase_date <= $${pParams.length}`);
  }
  const pWhereSql = pWhere.length ? `WHERE ${pWhere.join(' AND ')}` : '';

  const eWhere = [];
  const eParams = [];
  if (from) {
    eParams.push(from);
    eWhere.push(`expense_date >= $${eParams.length}`);
  }
  if (to) {
    eParams.push(to);
    eWhere.push(`expense_date <= $${eParams.length}`);
  }
  const eWhereSql = eWhere.length ? `WHERE ${eWhere.join(' AND ')}` : '';

  const [saleRows, purchaseRows, expenseRows] = await Promise.all([
    query(
      `SELECT (s.created_at AT TIME ZONE $1)::date AS d,
              COUNT(*)::int AS orders,
              COALESCE(SUM(s.total), 0) AS sales,
              COALESCE(SUM(CASE WHEN s.payment_method = 'cash' THEN s.total END), 0) AS cash,
              COALESCE(SUM(CASE WHEN s.payment_method = 'card' THEN s.total END), 0) AS card,
              COALESCE(SUM(CASE WHEN s.payment_method = 'other' THEN s.total END), 0) AS other,
              COALESCE(SUM(s.discount), 0) AS discount
         FROM sales s
         ${whereSql}
        GROUP BY 1`,
      params
    ),
    query(
      `SELECT purchase_date AS d,
              COUNT(*)::int AS purchase_count,
              COALESCE(SUM(total), 0) AS purchases
         FROM purchases
         ${pWhereSql}
        GROUP BY purchase_date`,
      pParams
    ),
    query(
      `SELECT expense_date AS d, COALESCE(SUM(amount), 0) AS expenses
         FROM expenses
         ${eWhereSql}
        GROUP BY expense_date`,
      eParams
    ),
  ]);

  const map = new Map();
  for (const r of saleRows) {
    const key = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10);
    map.set(key, {
      date: key,
      orders: r.orders,
      sales: Number(r.sales),
      cash: Number(r.cash),
      card: Number(r.card),
      other: Number(r.other),
      discount: Number(r.discount),
      purchases: 0,
      purchase_count: 0,
    });
  }
  for (const r of purchaseRows) {
    const key = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10);
    const existing = map.get(key);
    if (existing) {
      existing.purchases = Number(r.purchases);
      existing.purchase_count = r.purchase_count;
    } else {
      map.set(key, {
        date: key,
        orders: 0,
        sales: 0,
        cash: 0,
        card: 0,
        other: 0,
        discount: 0,
        purchases: Number(r.purchases),
        purchase_count: r.purchase_count,
      });
    }
  }

  for (const r of expenseRows) {
    const key = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10);
    const existing = map.get(key);
    if (existing) existing.expenses = Number(r.expenses);
    else
      map.set(key, {
        date: key,
        orders: 0,
        sales: 0,
        cash: 0,
        card: 0,
        other: 0,
        discount: 0,
        purchases: 0,
        purchase_count: 0,
        expenses: Number(r.expenses),
      });
  }
  for (const d of map.values()) if (d.expenses === undefined) d.expenses = 0;

  const days = [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  return ok({ days });
}
