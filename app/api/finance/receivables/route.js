// GET /api/finance/receivables (admin)
// Customer credit outstanding: who owes us money, from the stored credit
// ledger (customers.outstanding_balance, maintained transactionally).
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { ok, okGzip, round2 } from '@/lib/validate';

export async function GET(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const settings = await getSettings();

  // One grouped pass over the ledger instead of a correlated sub-query per
  // customer (the same value, but O(rows) instead of O(customers x probes)).
  const rows = await query(
    `SELECT c.id, c.name, c.phone, c.outstanding_balance, o.oldest_credit
       FROM customers c
       LEFT JOIN (SELECT customer_id, MIN(created_at AT TIME ZONE $1) AS oldest_credit
                    FROM customer_transactions
                   WHERE type = 'sale'
                   GROUP BY customer_id) o ON o.customer_id = c.id
      WHERE c.outstanding_balance > 0.005
      ORDER BY c.outstanding_balance DESC, c.name`,
    [settings.timezone]
  );
  const total = round2(rows.reduce((s, r) => s + Number(r.outstanding_balance), 0));
  return okGzip({
    total,
    customers: rows.map((r) => ({
      ...r,
      outstanding_balance: Number(r.outstanding_balance),
      oldest_credit: r.oldest_credit ? r.oldest_credit.toISOString().slice(0, 10) : null,
    })),
  }, req);
}
