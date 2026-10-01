// GET /api/dashboard (admin)
// One simple payload for the admin dashboard.
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { ok } from '@/lib/validate';
import { variantAggregate, stockValueExpr } from '@/lib/inventory';
import { sameBusinessDay, sameBusinessMonth, dayGte } from '@/lib/date-range';

export async function GET() {
  // Settings and the session are independent: start both at once so a
  // deployment that is N ms away from the database pays one round trip
  // instead of two before any data query can even be built.
  const settingsPromise = getSettings();
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const settings = await settingsPromise;
  const tz = settings.timezone;

  // "Today" is computed in the business timezone.
  // Goals: Today (sales vs daily goal), Streak (consecutive days meeting
  // the daily goal — the interpretation shown in the UI), and the
  // monthly goal (month-to-date sales vs the monthly target).
  const dailyGoal = Number(settings.daily_sales_goal);
  const monthlyGoal = Number(settings.monthly_sales_goal);

  // Two queries, issued together:
  //   1. every scalar + the three short lists (as JSON aggregates)
  //   2. the per-day sales series used for the streak
  // They used to be eight separate queries fired in parallel; on a warm
  // localhost pool that is free, but each one needs its own pooled
  // connection, so a deployed instance pays a connection setup + a network
  // round trip per query. Collapsing them keeps the payload identical.
  const [summary, dailyTotals] = await Promise.all([
    query(
      `SELECT
         (SELECT COUNT(*)::int FROM sales s
           WHERE ${sameBusinessDay('s.created_at', '$1')}) AS orders,
         (SELECT COALESCE(SUM(s.total), 0) FROM sales s
           WHERE ${sameBusinessDay('s.created_at', '$1')}) AS today_total,
         (SELECT COUNT(*)::int FROM purchases
           WHERE purchase_date = (now() AT TIME ZONE $1)::date) AS purchase_count,
         (SELECT COALESCE(SUM(total), 0) FROM purchases
           WHERE purchase_date = (now() AT TIME ZONE $1)::date) AS purchase_total,
         (SELECT COALESCE(SUM(s.total), 0) FROM sales s
           WHERE ${sameBusinessMonth('s.created_at', '$1')}) AS mtd_total,
         (SELECT COUNT(*)::int FROM products p WHERE p.active) AS products,
         (SELECT COUNT(*)::int FROM products p
           WHERE p.active AND p.stock = 0) AS out_of_stock,
         (SELECT COUNT(*)::int FROM products p
           WHERE p.active AND p.stock <= p.min_stock) AS low_stock,
         -- Inventory value at cost, across the WHOLE catalogue hierarchy:
         -- a sized product contributes the sum of its variants' stock x cost,
         -- a plain product contributes its own stock x cost. Never both.
         (SELECT COALESCE(SUM(${stockValueExpr('p', 'v')}), 0) FROM products p
           ${variantAggregate('p', 'v')}
           WHERE p.active) AS stock_value,
         (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
            SELECT id, name, stock, min_stock
              FROM products
             WHERE active AND stock <= min_stock
             ORDER BY stock ASC, name
             LIMIT 10) t) AS low_stock_rows,
         (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
            SELECT s.id, s.sale_no, s.created_at, s.total, s.payment_method,
                   u.full_name AS cashier
              FROM sales s
              JOIN users u ON u.id = s.cashier_id
             ORDER BY s.id DESC
             LIMIT 6) t) AS recent_sales,
         (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
            SELECT pr.id, pr.purchase_date, pr.total, v.name AS vendor
              FROM purchases pr
              JOIN vendors v ON v.id = pr.vendor_id
             ORDER BY pr.id DESC
             LIMIT 5) t) AS recent_purchases`,
      [tz]
    ),
    query(
      `SELECT (s.created_at AT TIME ZONE $1)::date AS d, COALESCE(SUM(s.total), 0) AS total
         FROM sales s
        WHERE ${dayGte('s.created_at', '$1', '$2')}
        GROUP BY 1
        ORDER BY 1 DESC`,
      [tz, businessDateNDaysAgo(tz, 365)]
    ),
  ]);
  const s = summary[0];

  // Streak: consecutive days (ending today) where sales met the daily
  // goal. If today has not met the goal yet, count back from yesterday —
  // the streak is still "alive" for the day in progress.
  // pg returns the DATE column as a JS Date (midnight UTC) — normalize to
  // YYYY-MM-DD so the keys match the business-date strings used below.
  const salesByDay = new Map(
    dailyTotals.map((r) => [
      r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10),
      Number(r.total),
    ])
  );
  const streak = { days: 0, goal: dailyGoal, active: dailyGoal > 0 };
  if (dailyGoal > 0) {
    // Date arithmetic in the BUSINESS timezone (the map keys are business
    // dates); calendar math on date strings is timezone-free.
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const prevDay = (d) => {
      const c = new Date(d + 'T00:00:00Z');
      c.setUTCDate(c.getUTCDate() - 1);
      return c.toISOString().slice(0, 10);
    };
    const meets = (d) => (salesByDay.get(d) || 0) >= dailyGoal;
    let cursor = todayStr;
    if (!meets(cursor)) cursor = prevDay(cursor);
    while (meets(cursor)) {
      streak.days += 1;
      cursor = prevDay(cursor);
    }
  }
  const mtdTotal = Number(s.mtd_total);
  const todayTotal = Number(s.today_total);
  const lowStock = (s.low_stock_rows || []).map((r) => ({
    ...r,
    stock: Number(r.stock),
    min_stock: Number(r.min_stock),
  }));

  return ok({
    today: { orders: s.orders, sales: todayTotal },
    goals: {
      daily: { goal: dailyGoal, sales: todayTotal, met: dailyGoal > 0 && todayTotal >= dailyGoal },
      streak,
      monthly: {
        goal: monthlyGoal,
        sales: mtdTotal,
        met: monthlyGoal > 0 && mtdTotal >= monthlyGoal,
      },
    },
    todayPurchases: { count: s.purchase_count, total: Number(s.purchase_total) },
    lowStock,
    recentSales: (s.recent_sales || []).map((r) => ({ ...r, total: Number(r.total) })),
    recentPurchases: (s.recent_purchases || []).map((r) => ({ ...r, total: Number(r.total) })),
    inventory: {
      products: s.products,
      out_of_stock: s.out_of_stock,
      low_stock: s.low_stock,
      stock_value: Number(s.stock_value),
    },
  });
}

/** Business date (YYYY-MM-DD) N days before today, in the store timezone. */
function businessDateNDaysAgo(tz, days) {
  const base = new Date();
  try {
    const todayStr = base.toLocaleDateString('en-CA', { timeZone: tz });
    const d = new Date(todayStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  } catch {
    const d = new Date(base.getTime() - days * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
}
