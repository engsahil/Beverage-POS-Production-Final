// GET /api/finance/receivables (admin)
// Customer credit outstanding: who owes us money, from the stored credit
// ledger (customers.outstanding_balance, maintained transactionally).
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { ok, round2 } from '@/lib/validate';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const settings = await getSettings();

  const rows = await query(
    `SELECT c.id, c.name, c.phone, c.outstanding_balance,
            (SELECT MIN((ct.created_at AT TIME ZONE $1)) FROM customer_transactions ct
              WHERE ct.customer_id = c.id AND ct.type = 'sale') AS oldest_credit
       FROM customers c
      WHERE c.outstanding_balance > 0.005
      ORDER BY c.outstanding_balance DESC, c.name`,
    [settings.timezone]
  );
  const total = round2(rows.reduce((s, r) => s + Number(r.outstanding_balance), 0));
  return ok({
    total,
    customers: rows.map((r) => ({
      ...r,
      outstanding_balance: Number(r.outstanding_balance),
      oldest_credit: r.oldest_credit ? r.oldest_credit.toISOString().slice(0, 10) : null,
    })),
  });
}
