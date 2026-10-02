// GET /api/finance/balance-sheet (admin)
// Position as of today, computed only from stored data:
//   assets      transaction accounts, customer receivables, vendor receivables,
//               and inventory (stock x cost, variant-aware)
//   liabilities net vendor payables after opening balance, payments and settled claims
//   equity      residual so that Assets = Liabilities + Equity always holds.
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

  const { sql, params } = accountBalanceQuery({ mode: 'all' });
  const [acctRows, recvRows, invRows, vendorRows] = await Promise.all([
    query(sql, params),
    query('SELECT COALESCE(SUM(outstanding_balance), 0) AS s FROM customers'),
    query(
      `SELECT COALESCE(SUM(${stockValueExpr('p', 'v')}), 0) AS inventory
         FROM products p
         ${variantAggregate('p', 'v')}`
    ),
    query(
      `SELECT COALESCE(SUM(GREATEST(balance, 0)), 0) AS payables,
              COALESCE(SUM(GREATEST(-balance, 0)), 0) AS receivables
         FROM (
           SELECT v.id,
                  (CASE WHEN COALESCE(v.opening_balance_type, 'payable') = 'receivable'
                        THEN -COALESCE(v.opening_balance, 0)
                        ELSE COALESCE(v.opening_balance, 0)
                   END)
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
  const liabilities = round2(payables);
  const equity = round2(assets - liabilities);

  return ok({
    asOf: new Date().toLocaleDateString('sv-SE', { timeZone: settings.timezone }),
    assets: { cash, bank, card, receivables, vendor_receivables: vendorReceivables, inventory, total: assets },
    liabilities: { payables, total: liabilities },
    equity: { owner_equity: equity, total: equity },
    balanced: round2(assets) === round2(liabilities + equity),
  });
}
