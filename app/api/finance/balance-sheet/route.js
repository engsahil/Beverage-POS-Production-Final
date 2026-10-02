// GET /api/finance/balance-sheet (admin)
// Position as of today, computed only from stored data:
//   assets      transaction accounts, customer receivables, vendor credits,
//               and inventory (stock x cost, variant-aware)
//   liabilities net vendor payables after payments and settled claims
//   equity      residual so that Assets = Liabilities + Equity always holds.
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
  // one costs a network round trip, so serialising them multiplies latency.
  const { sql, params } = accountBalanceQuery({ mode: 'all' });
  const [acctRows, recvRows, invRows, vendorRows] = await Promise.all([
    query(sql, params),
    // Customer outstanding is maintained transactionally by credit sales and
    // customer ledger routes.
    query('SELECT COALESCE(SUM(outstanding_balance), 0) AS s FROM customers'),
    // Variant stock x variant cost when sizes exist; otherwise the product
    // stock pool. The cases are mutually exclusive, so nothing is duplicated.
    query(
      `SELECT COALESCE(SUM(${stockValueExpr('p', 'v')}), 0) AS inventory
         FROM products p
         ${variantAggregate('p', 'v')}`
    ),
    // Calculate each vendor's position before summing. A credit with one
    // vendor is an asset and must not hide a payable owed to another vendor.
    query(
      `SELECT COALESCE(SUM(GREATEST(balance, 0)), 0) AS payables,
              COALESCE(SUM(GREATEST(-balance, 0)), 0) AS receivables
         FROM (
           SELECT v.id,
                  COALESCE(v.opening_balance, 0)
                    + COALESCE((SELECT SUM(pr.total) FROM purchases pr WHERE pr.vendor_id = v.id), 0)
                    - COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp WHERE pp.vendor_id = v.id), 0)
                    - COALESCE((SELECT SUM(vc.amount) FROM vendor_claims vc WHERE vc.vendor_id = v.id AND vc.status = 'settled'), 0)
                    AS balance
             FROM vendors v
         ) vendor_positions`
    ),
  ]);

  const acct = acctRows[0];
  const cash = Number(acct.cash);
  const bank = Number(acct.bank);
  const card = Number(acct.card);
  const receivables = Number(recvRows[0].s);
  const vendorReceivables = round2(Number(vendorRows[0].receivables));
  const inventory = Number(invRows[0].inventory);
  const payables = round2(Number(vendorRows[0].payables));

  const assets = round2(cash + bank + card + receivables + vendorReceivables + inventory);
  const liabilities = payables;
  const equity = round2(assets - liabilities);

  return ok({
    asOf: new Date().toLocaleDateString('sv-SE', { timeZone: settings.timezone }),
    assets: { cash, bank, card, receivables, vendor_receivables: vendorReceivables, inventory, total: assets },
    liabilities: { payables, total: liabilities },
    equity: { owner_equity: equity, total: equity },
    balanced: round2(assets) === round2(liabilities + equity),
  });
}
