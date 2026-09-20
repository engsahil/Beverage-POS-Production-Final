// GET /api/finance/balance-sheet (admin)
// Position as of today, computed only from stored data:
//   assets     cash + bank + card (from real transactions), receivables
//              (customer outstanding), inventory (stock x cost, variant-aware)
//   liabilities payables (vendor invoices minus payments)
//   equity     residual so that Assets = Liabilities + Equity always holds.
// Equity here is "owner equity" as the difference of the recorded books —
// the app has no owner capital/withdrawal ledger (none has ever existed),
// so no separate figure is invented.
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { ok, round2 } from '@/lib/validate';
import { accountBalanceQuery } from '@/lib/finance';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const settings = await getSettings();

  const { sql, params } = accountBalanceQuery({ mode: 'all' });
  const acct = (await query(sql, params))[0];
  const cash = Number(acct.cash);
  const bank = Number(acct.bank);
  const card = Number(acct.card);

  // Receivables: customer outstanding (single stored column, maintained
  // transactionally by the credit-sale and payment routes).
  const recv = (await query('SELECT COALESCE(SUM(outstanding_balance), 0) AS s FROM customers'))[0];
  const receivables = Number(recv.s);

  // Inventory at current cost: variant stock when a product has sizes,
  // otherwise the plain product pool (plain products have no variant rows,
  // so the two parts never double count).
  const invRows = await query(
    `WITH sized AS (
       SELECT product_id FROM product_variants GROUP BY product_id
     )
     SELECT
       (SELECT COALESCE(SUM(v.stock * v.cost), 0) FROM product_variants v) AS variant_value,
       (SELECT COALESCE(SUM(p.stock * p.cost), 0) FROM products p
         WHERE p.id NOT IN (SELECT product_id FROM sized)) AS plain_value`
  );
  const inventory = Number(invRows[0].variant_value) + Number(invRows[0].plain_value);

  // Payables: what is still owed to vendors. Two scalar subqueries so an
  // invoice with several payments is counted ONCE (a JOIN would duplicate
  // the invoice total per payment row).
  const pay = await query(
    `SELECT (SELECT COALESCE(SUM(total), 0) FROM purchases) AS invoiced,
            (SELECT COALESCE(SUM(amount), 0) FROM purchase_payments) AS paid`
  );
  const payables = round2(Number(pay[0].invoiced) - Number(pay[0].paid));

  const assets = round2(cash + bank + card + receivables + inventory);
  const liabilities = round2(payables);
  const equity = round2(assets - liabilities);

  return ok({
    asOf: new Date().toLocaleDateString('sv-SE', { timeZone: settings.timezone }),
    assets: { cash, bank, card, receivables, inventory, total: assets },
    liabilities: { payables, total: liabilities },
    equity: { owner_equity: equity, total: equity },
    balanced: round2(assets) === round2(liabilities + equity),
  });
}
