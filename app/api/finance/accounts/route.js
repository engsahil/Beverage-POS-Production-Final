// GET /api/finance/accounts -> current cash / bank / card balances (admin)
// Balances are derived from the real transaction rows (sales, customer
// payments, vendor payments, expenses) — nothing is stored as an account
// balance, so it cannot drift from the books.
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { ok } from '@/lib/validate';
import { accountBalanceQuery } from '@/lib/finance';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const settings = await getSettings();

  const { sql, params } = accountBalanceQuery({ mode: 'all' });
  const rows = await query(sql, params);
  const r = rows[0];
  return ok({
    cash: Number(r.cash),
    bank: Number(r.bank),
    card: Number(r.card),
    unspecified: Number(r.unspecified),
    total: Number(r.cash) + Number(r.bank) + Number(r.card),
  });
}
