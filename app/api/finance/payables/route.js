// GET /api/finance/payables (admin)
// Net vendor balances after invoices, payments, opening balances (payable or
// receivable) and settled claims.
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { ok, round2 } from '@/lib/validate';
import { purchaseStatus } from '@/app/api/purchases/route.js';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const settings = await getSettings();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: settings.timezone });

  const [invRows, vendorRows] = await Promise.all([
    query(
      `SELECT pr.id, pr.vendor_id, v.name AS vendor_name, pr.purchase_date, pr.due_date, pr.total,
              COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp WHERE pp.purchase_id = pr.id), 0) AS paid
         FROM purchases pr
         JOIN vendors v ON v.id = pr.vendor_id
        ORDER BY pr.due_date ASC NULLS LAST, pr.id ASC`
    ),
    query(
      `SELECT v.id, v.name, v.phone,
              COALESCE(v.opening_balance, 0) AS opening_balance,
              COALESCE(v.opening_balance_type, 'payable') AS opening_balance_type,
              COALESCE((SELECT SUM(pr.total) FROM purchases pr WHERE pr.vendor_id = v.id), 0) AS purchases,
              COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp WHERE pp.vendor_id = v.id), 0) AS payments,
              COALESCE((SELECT SUM(vc.amount) FROM vendor_claims vc WHERE vc.vendor_id = v.id AND vc.status = 'settled'), 0) AS claims
         FROM vendors v
        ORDER BY v.name`
    ),
  ]);

  const open = invRows
    .map((r) => purchaseStatus(r, today))
    .filter((r) => r.outstanding > 0.005);

  const invoiceStatsByVendor = new Map();
  for (const inv of open) {
    const cur = invoiceStatsByVendor.get(inv.vendor_id) || { invoices: 0, overdue: 0 };
    cur.invoices += 1;
    if (inv.status === 'overdue') cur.overdue = round2(cur.overdue + inv.outstanding);
    invoiceStatsByVendor.set(inv.vendor_id, cur);
  }

  const vendors = [];
  for (const v of vendorRows) {
    const ob = round2(Number(v.opening_balance || 0));
    const obType = v.opening_balance_type === 'receivable' ? 'receivable' : 'payable';
    const signedOb = obType === 'receivable' ? -ob : ob;
    const purchases = round2(Number(v.purchases || 0));
    const payments = round2(Number(v.payments || 0));
    const claims = round2(Number(v.claims || 0));
    const outstanding = round2(signedOb + purchases - payments - claims);
    const payable = round2(Math.max(0, outstanding));
    const receivable = round2(Math.max(0, -outstanding));
    const invStat = invoiceStatsByVendor.get(v.id) || { invoices: 0, overdue: 0 };
    const overdue = round2(Math.min(invStat.overdue, payable));

    if (payable > 0.005 || receivable > 0.005) {
      vendors.push({
        vendor_id: v.id,
        name: v.name,
        phone: v.phone || '',
        opening_balance: ob,
        opening_balance_type: obType,
        purchases,
        payments,
        claims,
        outstanding,
        payable,
        receivable,
        overdue,
        invoices: invStat.invoices,
      });
    }
  }

  vendors.sort((a, b) => b.outstanding - a.outstanding);

  const total = round2(vendors.reduce((s, v) => s + v.payable, 0));
  const receivableTotal = round2(vendors.reduce((s, v) => s + v.receivable, 0));
  const overdueTotal = round2(vendors.reduce((s, v) => s + v.overdue, 0));

  return ok({
    total,
    receivableTotal,
    overdueTotal,
    vendors,
    openInvoices: open,
  });
}
