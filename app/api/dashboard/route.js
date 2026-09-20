// GET /api/dashboard (admin)
// One simple payload for the admin dashboard.
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { ok } from '@/lib/validate';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const settings = await getSettings();
  const tz = settings.timezone;

  // "Today" is computed in the business timezone.
  // All six are small aggregate queries — run them in parallel.
  // Goals: Today (sales vs daily goal), Streak (consecutive days meeting
  // the daily goal — the interpretation shown in the UI), and the
  // monthly goal (month-to-date sales vs the monthly target).
  const dailyGoal = Number(settings.daily_sales_goal);
  const monthlyGoal = Number(settings.monthly_sales_goal);

  const [today, todayPurchases, lowStock, recentSales, recentPurchases, inventory, dailyTotals, mtd] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS orders,
              COALESCE(SUM(s.total), 0) AS total
         FROM sales s
        WHERE (s.created_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date`,
      [tz]
    ),
    query(
      `SELECT COUNT(*)::int AS purchase_count,
              COALESCE(SUM(total), 0) AS total
         FROM purchases
        WHERE purchase_date = (now() AT TIME ZONE $1)::date`,
      [tz]
    ),
    query(
      `SELECT id, name, stock, min_stock
         FROM products
        WHERE active AND stock <= min_stock
        ORDER BY stock ASC, name
        LIMIT 10`
    ),
    query(
      `SELECT s.id, s.sale_no, s.created_at, s.total, s.payment_method,
              u.full_name AS cashier
         FROM sales s
         JOIN users u ON u.id = s.cashier_id
        ORDER BY s.id DESC
        LIMIT 6`
    ),
    query(
      `SELECT pr.id, pr.purchase_date, pr.total, v.name AS vendor
         FROM purchases pr
         JOIN vendors v ON v.id = pr.vendor_id
        ORDER BY pr.id DESC
        LIMIT 5`
    ),
    query(
      `SELECT COUNT(*)::int AS products,
              COUNT(*) FILTER (WHERE stock = 0)::int AS out_of_stock,
              COUNT(*) FILTER (WHERE stock <= min_stock)::int AS low_stock,
              COALESCE(SUM(stock * cost), 0) AS stock_value
         FROM products
        WHERE active`
    ),
    query(
      `SELECT (s.created_at AT TIME ZONE $1)::date AS d, COALESCE(SUM(s.total), 0) AS total
         FROM sales s
        WHERE (s.created_at AT TIME ZONE $1)::date >= CURRENT_DATE - 365
        GROUP BY 1
        ORDER BY 1 DESC`,
      [tz]
    ),
    query(
      `SELECT COALESCE(SUM(s.total), 0) AS total
         FROM sales s
        WHERE date_trunc('month', (s.created_at AT TIME ZONE $1)::date)
              = date_trunc('month', (now() AT TIME ZONE $1)::date)`,
      [tz]
    ),
  ]);

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
    const prevDay = (s) => {
      const c = new Date(s + 'T00:00:00Z');
      c.setUTCDate(c.getUTCDate() - 1);
      return c.toISOString().slice(0, 10);
    };
    const meets = (s) => (salesByDay.get(s) || 0) >= dailyGoal;
    let cursor = todayStr;
    if (!meets(cursor)) cursor = prevDay(cursor);
    while (meets(cursor)) {
      streak.days += 1;
      cursor = prevDay(cursor);
    }
  }
  const mtdTotal = Number(mtd[0].total);

  return ok({
    today: { orders: today[0].orders, sales: Number(today[0].total) },
    goals: {
      daily: { goal: dailyGoal, sales: Number(today[0].total), met: dailyGoal > 0 && Number(today[0].total) >= dailyGoal },
      streak,
      monthly: {
        goal: monthlyGoal,
        sales: mtdTotal,
        met: monthlyGoal > 0 && mtdTotal >= monthlyGoal,
      },
    },
    todayPurchases: { count: todayPurchases[0].purchase_count, total: Number(todayPurchases[0].total) },
    lowStock: lowStock.map((r) => ({ ...r, stock: Number(r.stock), min_stock: Number(r.min_stock) })),
    recentSales: recentSales.map((r) => ({ ...r, total: Number(r.total) })),
    recentPurchases: recentPurchases.map((r) => ({ ...r, total: Number(r.total) })),
    inventory: {
      products: inventory[0].products,
      out_of_stock: inventory[0].out_of_stock,
      low_stock: inventory[0].low_stock,
      stock_value: Number(inventory[0].stock_value),
    },
  });
}
