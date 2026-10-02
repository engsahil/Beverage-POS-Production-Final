// GET /api/finance/payables (admin)
// Net vendor balances after invoices, payments, opening balances and settled
// claims. A positive balance is payable; a negative balance is a vendor credit.
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { ok, round2 } from '@/lib/validate';
import { purchaseStatus } from '@/app/api/purchases/route.js';

function emptyVendor(id, name) {
  return {
    vendor_id: id,
    name,
    outstanding: 0,
    payable: 0,
    receivable: 0,
    overdue: 0,
    invoices: 0,
    claims: 0,
  };
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const settings = await getSettings();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: settings.timezone });

  const rows = await query(
    `SELECT pr.id, pr.vendor_id, pr.purchase_date, pr.due_date, pr.total,
            COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp WHERE pp.purchase_id = pr.id), 0) AS paid,
            v.name AS vendor_name
       FROM purchases pr
       JOIN vendors v ON v.id = pr.vendor_id
      ORDER BY pr.purchase_date, pr.id`
  );

  const invoices = rows.map((r) => ({ ...purchaseStatus(r, today), vendor_name: r.vendor_name }));
  const open = invoices.filter((i) => i.outstanding > 0.005);

  const byVendor = new Map();
  for (const inv of open) {
    const cur = byVendor.get(inv.vendor_id) || emptyVendor(inv.vendor_id, inv.vendor_name);
    cur.outstanding = round2(cur.outstanding + inv.outstanding);
    if (inv.status === 'overdue') cur.overdue = round2(cur.overdue + inv.outstanding);
    cur.invoices += 1;
    byVendor.set(inv.vendor_id, cur);
  }

  // Carried-forward payables are not tied to an invoice due date.
  const obRows = await query('SELECT id, name, opening_balance FROM vendors WHERE COALESCE(opening_balance, 0) > 0.005');
  for (const v of obRows) {
    const cur = byVendor.get(v.id) || emptyVendor(v.id, v.name);
    cur.outstanding = round2(cur.outstanding + Number(v.opening_balance));
    byVendor.set(v.id, cur);
  }

  // A settled claim is a credit from the vendor. The vendor ledger already
  // records it as a debit, so the point-in-time summary must subtract it too.
  const claimRows = await query(
    `SELECT v.id, v.name, COALESCE(SUM(vc.amount), 0) AS amount
       FROM vendor_claims vc
       JOIN vendors v ON v.id = vc.vendor_id
      WHERE vc.status = 'settled'
      GROUP BY v.id, v.name`
  );
  for (const v of claimRows) {
    const cur = byVendor.get(v.id) || emptyVendor(v.id, v.name);
    cur.claims = round2(Number(v.amount));
    cur.outstanding = round2(cur.outstanding - cur.claims);
    byVendor.set(v.id, cur);
  }

  const vendors = [...byVendor.values()]
    .map((v) => {
      const payable = round2(Math.max(v.outstanding, 0));
      const receivable = round2(Math.max(-v.outstanding, 0));
      return {
        ...v,
        payable,
        receivable,
        // A vendor cannot have more overdue than its current net payable.
        overdue: round2(Math.min(v.overdue, payable)),
      };
    })
    .filter((v) => v.payable > 0.005 || v.receivable > 0.005)
    .sort((a, b) => b.outstanding - a.outstanding);

  const totalOpening = round2(obRows.reduce((s, r) => s + Number(r.opening_balance), 0));
  const totalClaims = round2(claimRows.reduce((s, r) => s + Number(r.amount), 0));
  const total = round2(vendors.reduce((s, v) => s + v.payable, 0));
  const receivableTotal = round2(vendors.reduce((s, v) => s + v.receivable, 0));
  const overdueTotal = round2(vendors.reduce((s, v) => s + v.overdue, 0));

  return ok({
    total,
    receivableTotal,
    overdueTotal,
    totalOpening,
    totalClaims,
    vendors,
    invoices: open,
  });
}
