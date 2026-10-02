// GET /api/finance/payables (admin)
// What we still owe vendors, per invoice and per vendor. Overdue = the
// invoice's due_date has passed with money still outstanding.
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
    const cur = byVendor.get(inv.vendor_id) || {
      vendor_id: inv.vendor_id,
      name: inv.vendor_name,
      outstanding: 0,
      overdue: 0,
      invoices: 0,
    };
    cur.outstanding = round2(cur.outstanding + inv.outstanding);
    if (inv.status === 'overdue') cur.overdue = round2(cur.overdue + inv.outstanding);
    cur.invoices += 1;
    byVendor.set(inv.vendor_id, cur);
  }

  // Vendor opening balances (carried-forward payables not yet invoiced in this system)
  const obRows = await query('SELECT id, name, opening_balance FROM vendors WHERE COALESCE(opening_balance, 0) > 0.005');
  for (const v of obRows) {
    const ob = Number(v.opening_balance);
    const cur = byVendor.get(v.id) || {
      vendor_id: v.id,
      name: v.name,
      outstanding: 0,
      overdue: 0,
      invoices: 0,
    };
    cur.outstanding = round2(cur.outstanding + ob);
    // Opening balances are not overdue by invoice due_date; they are always outstanding.
    byVendor.set(v.id, cur);
  }

  const totalInvoices = round2(open.reduce((s, i) => s + i.outstanding, 0));
  const totalOpening = round2(obRows.reduce((s, r) => s + Number(r.opening_balance), 0));
  const total = round2(totalInvoices + totalOpening);
  const overdueTotal = round2(open.filter((i) => i.status === 'overdue').reduce((s, i) => s + i.outstanding, 0));

  return ok({
    total,
    overdueTotal,
    totalOpening,
    vendors: [...byVendor.values()].sort((a, b) => b.outstanding - a.outstanding),
    invoices: open,
  });
}
