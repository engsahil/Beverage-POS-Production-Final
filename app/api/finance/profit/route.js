// GET /api/finance/profit?from=&to= (admin)
// Profit & loss for a period. COGS uses each sold line's quantity times the
// cost stored on that line's record — the variant's own cost when the line
// sold a variant, otherwise the product's current cost (the app does not
// snapshot cost at sale time) — labelled as such in the UI. Vendor claims
// settled in the period reduce the cost of the goods they cover.
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { validDate, fail, ok, round2 } from '@/lib/validate';

export async function GET(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const sp = req.nextUrl.searchParams;
  const from = validDate(sp.get('from'));
  const to = validDate(sp.get('to'));
  if (sp.get('from') && !from) return fail('Invalid "from" date.');
  if (sp.get('to') && !to) return fail('Invalid "to" date.');

  const settings = await getSettings();
  // Default range = last 30 business days in the STORE timezone (not UTC).
  const today = new Date().toLocaleDateString('en-CA', { timeZone: settings.timezone });
  const d0 = new Date(today + 'T00:00:00Z');
  d0.setUTCDate(d0.getUTCDate() - 29);
  const f = from || d0.toISOString().slice(0, 10);
  const t = to || today;

  const [rev, cogs, expRows, claims] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(s.total), 0) AS total
         FROM sales s
        WHERE (s.created_at AT TIME ZONE $1)::date BETWEEN $2 AND $3`,
      [settings.timezone, f, t]
    ),
    query(
      `SELECT COALESCE(SUM(si.qty * COALESCE(v.cost, p.cost)), 0) AS total
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
         LEFT JOIN product_variants v ON v.id = si.variant_id
        WHERE (s.created_at AT TIME ZONE $1)::date BETWEEN $2 AND $3`,
      [settings.timezone, f, t]
    ),
    query(
      `SELECT COALESCE(e.category, 'Other') AS category, COALESCE(SUM(e.amount), 0) AS total
         FROM expenses e
        WHERE e.expense_date BETWEEN $1 AND $2
        GROUP BY 1 ORDER BY 2 DESC`,
      [f, t]
    ),
    query(
      `SELECT COALESCE(SUM(vc.amount), 0) AS total
         FROM vendor_claims vc
        WHERE vc.status = 'settled' AND (vc.settled_at AT TIME ZONE $1)::date BETWEEN $2 AND $3`,
      [settings.timezone, f, t]
    ),
  ]);

  const revenue = Number(rev[0].total);
  const cogsTotal = Number(cogs[0].total);
  const expenses = expRows.map((r) => ({ category: r.category, total: Number(r.total) }));
  const expenseTotal = round2(expenses.reduce((s, e) => s + e.total, 0));
  const claimsTotal = Number(claims[0].total);
  const gross = round2(revenue - cogsTotal);
  const net = round2(gross - expenseTotal + claimsTotal);

  return ok({
    from: f,
    to: t,
    revenue,
    cogs: cogsTotal,
    gross,
    expenses,
    expenseTotal,
    claims: claimsTotal,
    net,
  });
}
