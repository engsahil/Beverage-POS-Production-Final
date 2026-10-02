// GET /api/vendors/:id/ledger?from=&to=&method=&type= (admin)
// Accounting-style vendor statement with a running balance.
//
//   credit  = increases what we owe the vendor (opening payable, purchase invoice)
//   debit   = reduces what we owe / increases what vendor owes us (opening receivable, payment, settled claim)
//   balance = credit - debit (> 0 means Payable [we owe vendor], < 0 means Receivable [vendor owes us])
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { validDate, fail, ok, round2 } from '@/lib/validate';

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : '');

const storeDate = (ts, tz) =>
  ts instanceof Date
    ? ts.toLocaleDateString('sv-SE', { timeZone: tz })
    : ts
      ? String(ts).slice(0, 10)
      : '';

export async function GET(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const vendorId = Number((await params).id);
  if (!Number.isInteger(vendorId)) return fail('Invalid vendor id.', 404);

  const vendorRows = await query(
    `SELECT id, name, phone, notes, active,
            COALESCE(opening_balance, 0) AS opening_balance,
            COALESCE(opening_balance_type, 'payable') AS opening_balance_type,
            opening_balance_date,
            COALESCE(opening_balance_note, '') AS opening_balance_note
       FROM vendors
      WHERE id = $1`,
    [vendorId]
  );
  const vendor = vendorRows[0];
  if (!vendor) return fail('Vendor not found.', 404);

  const sp = req.nextUrl.searchParams;
  const from = validDate(sp.get('from'));
  const to = validDate(sp.get('to'));
  const method = ['cash', 'bank', 'card'].includes(sp.get('method')) ? sp.get('method') : null;
  const type = ['all', 'invoices', 'payments', 'adjustments'].includes(sp.get('type'))
    ? sp.get('type')
    : 'all';

  const settings = await getSettings();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: settings.timezone });

  const [invoices, payments, claims] = await Promise.all([
    query(
      `SELECT pr.id, pr.purchase_date, pr.total, pr.notes,
              (SELECT COUNT(*)::int FROM purchase_items pi WHERE pi.purchase_id = pr.id) AS item_count
         FROM purchases pr WHERE pr.vendor_id = $1`,
      [vendorId]
    ),
    query(
      `SELECT pp.id, pp.purchase_id, pp.payment_date, pp.amount, pp.method, pp.reference, pp.note
         FROM purchase_payments pp WHERE pp.vendor_id = $1`,
      [vendorId]
    ),
    query(
      `SELECT vc.id, vc.settled_at, vc.claim_date, vc.amount, vc.adjustment_ref, vc.reason
         FROM vendor_claims vc
        WHERE vc.vendor_id = $1 AND vc.status = 'settled'`,
      [vendorId]
    ),
  ]);

  const obAmount = round2(Number(vendor.opening_balance || 0));
  const obType = vendor.opening_balance_type === 'receivable' ? 'receivable' : 'payable';
  const signedOpening = round2(obType === 'receivable' ? -obAmount : obAmount);
  const obDate = vendor.opening_balance_date ? iso(vendor.opening_balance_date) : null;

  const allRows = [];
  let totalPurchases = 0;
  let totalPayments = 0;
  let totalClaims = 0;

  for (const inv of invoices) {
    const amt = round2(Number(inv.total));
    totalPurchases = round2(totalPurchases + amt);
    allRows.push({
      id: `inv-${inv.id}`,
      ref_id: inv.id,
      date: iso(inv.purchase_date),
      reference: `INV #${inv.id}`,
      description: `Purchase, ${inv.item_count} item${inv.item_count === 1 ? '' : 's'}${inv.notes ? ` — ${inv.notes}` : ''}`,
      type: 'invoices',
      method: null,
      credit: amt,
      debit: 0,
    });
  }
  for (const p of payments) {
    const amt = round2(Number(p.amount));
    totalPayments = round2(totalPayments + amt);
    allRows.push({
      id: `pay-${p.id}`,
      ref_id: p.id,
      purchase_id: p.purchase_id,
      date: iso(p.payment_date),
      reference: p.reference || `PAY #${p.id}`,
      description: `Payment via ${p.method}${p.note ? ` — ${p.note}` : ''}`,
      type: 'payments',
      method: p.method,
      credit: 0,
      debit: amt,
    });
  }
  for (const c of claims) {
    const amt = round2(Number(c.amount));
    totalClaims = round2(totalClaims + amt);
    allRows.push({
      id: `clm-${c.id}`,
      ref_id: c.id,
      date: storeDate(c.settled_at, settings.timezone) || iso(c.claim_date),
      reference: c.adjustment_ref || `CLM #${c.id}`,
      description: `Claim settled${c.reason ? ` — ${c.reason}` : ''}`,
      type: 'adjustments',
      method: null,
      credit: 0,
      debit: amt,
    });
  }
  allRows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Starting balance before `from`: vendor's carried-forward opening balance
  // plus any transactions strictly before `from`.
  let opening = signedOpening;
  for (const r of allRows) {
    if (from && r.date && r.date < from) {
      opening = round2(opening + r.credit - r.debit);
    }
  }

  let balance = opening;
  const out = [];
  for (const r of allRows) {
    if (!r.date) continue;
    if (from && r.date < from) continue;
    if (to && r.date > to) continue;
    if (type !== 'all' && r.type !== type) continue;
    if (method && r.type === 'payments' && r.method !== method) continue;
    balance = round2(balance + r.credit - r.debit);
    out.push({
      ...r,
      balance,
      payable: round2(Math.max(0, balance)),
      receivable: round2(Math.max(0, -balance)),
    });
  }

  const closing = round2(balance);
  const payable = round2(Math.max(0, closing));
  const receivable = round2(Math.max(0, -closing));

  const accountClosing = round2(signedOpening + totalPurchases - totalPayments - totalClaims);
  const accountPayable = round2(Math.max(0, accountClosing));
  const accountReceivable = round2(Math.max(0, -accountClosing));

  return ok({
    vendor: {
      id: vendor.id,
      name: vendor.name,
      opening_balance: obAmount,
      opening_balance_type: obType,
      opening_balance_date: obDate,
      opening_balance_note: vendor.opening_balance_note || '',
    },
    opening,
    closing,
    payable,
    receivable,
    today,
    summary: {
      opening_balance: obAmount,
      opening_balance_type: obType,
      opening_payable: obType === 'payable' ? obAmount : 0,
      opening_receivable: obType === 'receivable' ? obAmount : 0,
      signed_opening: signedOpening,
      purchases: totalPurchases,
      payments: totalPayments,
      claims: totalClaims,
      total_credit: round2((obType === 'payable' ? obAmount : 0) + totalPurchases),
      total_debit: round2((obType === 'receivable' ? obAmount : 0) + totalPayments + totalClaims),
      closing: accountClosing,
      payable: accountPayable,
      receivable: accountReceivable,
    },
    rows: out,
  });
}
