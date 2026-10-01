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
import { variantAggregate, stockValueExpr } from '@/lib/inventory';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const settings = await getSettings();

  // Four independent reads. Run them together: on a deployed instance each
  // one costs a network round trip, so serialising them multiplied the
  // response time for no reason.
  const { sql, params } = accountBalanceQuery({ mode: 'all' });
  const [acctRows, recvRows, invRows, pay] = await Promise.all([
    query(sql, params),
    // Receivables: customer outstanding (single stored column, maintained
    // transactionally by the credit-sale and payment routes).
    query('SELECT COALESCE(SUM(outstanding_balance), 0) AS s FROM customers'),
    // Inventory at current cost, using the SAME rule as the dashboard, the
    // inventory screen and the inventory report (lib/inventory.js): variant
    // stock x variant cost when a product has sizes, otherwise the plain
    // product pool. The two cases are mutually exclusive, so nothing is ever
    // counted twice.
    query(
      `SELECT COALESCE(SUM(${stockValueExpr('p', 'v')}), 0) AS inventory
         FROM products p
         ${variantAggregate('p', 'v')}`
    ),
    // Payables: what is still owed to vendors. Two scalar subqueries so an
    // invoice with several payments is counted ONCE (a JOIN would duplicate
    // the invoice total per payment row).
    query(
      `SELECT (SELECT COALESCE(SUM(total), 0) FROM purchases) AS invoiced,
              (SELECT COALESCE(SUM(amount), 0) FROM purchase_payments) AS paid`
    ),
  ]);
  const acct = acctRows[0];
  const cash = Number(acct.cash);
  const bank = Number(acct.bank);
  const card = Number(acct.card);
  const receivables = Number(recvRows[0].s);
  const inventory = Number(invRows[0].inventory);
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
