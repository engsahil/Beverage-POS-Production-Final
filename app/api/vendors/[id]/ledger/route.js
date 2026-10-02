// GET /api/vendors/:id/ledger?from=&to=&method=&type= (admin)
// Accounting-style vendor statement with a running balance.
//
//   credit  = invoice recorded (we now owe the vendor more)
//   debit   = payment or settled claim (we owe less)
//
// Filters: from/to (date range on the row date), method (cash|bank|card,
// applies to payments), type (all|invoices|payments|adjustments).
// The opening balance is everything before `from`; every row in range
// carries its balance after the row is applied. No stored balances —
// everything is derived from the actual rows.
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { validDate, fail, ok, round2 } from '@/lib/validate';

// pg returns DATE as a JS Date (midnight UTC) — always serialize as ISO.
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

// TIMESTAMPTZ (e.g. claim.settled_at) must be dated in the STORE timezone,
// not UTC — a claim settled at 04:00 PKT (19th) is a 19th business event
// even though UTC still shows the 18th. (sv-SE formats as YYYY-MM-DD.)
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

  const vendorRow = await query('SELECT id, opening_balance, opening_balance_note, opening_balance_date, opening_balance_updated_at FROM vendors WHERE id = $1', [vendorId]);
  if (!vendorRow[0]) return fail('Vendor not found.', 404);
  const vendor = vendorRow[0];

  const sp = req.nextUrl.searchParams;
  const from = validDate(sp.get('from'));
  const to = validDate(sp.get('to'));
  const method = ['cash', 'bank', 'card'].includes(sp.get('method')) ? sp.get('method') : null;
  const type = ['all', 'invoices', 'payments', 'adjustments'].includes(sp.get('type'))
    ? sp.get('type')
    : 'all';

  const settings = await getSettings();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: settings.timezone });

  // Collect every balance-affecting row for this vendor.
  const invoices = await query(
    `SELECT pr.id, pr.purchase_date, pr.total,
            (SELECT COUNT(*)::int FROM purchase_items pi WHERE pi.purchase_id = pr.id) AS item_count
       FROM purchases pr WHERE pr.vendor_id = $1`,
    [vendorId]
  );
  const payments = await query(
    `SELECT pp.id, pp.payment_date, pp.amount, pp.method, pp.reference, pp.note
       FROM purchase_payments pp WHERE pp.vendor_id = $1`,
    [vendorId]
  );
  const claims = await query(
    `SELECT vc.id, vc.settled_at, vc.amount, vc.adjustment_ref, vc.reason
       FROM vendor_claims vc
      WHERE vc.vendor_id = $1 AND vc.status = 'settled'`,
    [vendorId]
  );

  const rows = [];
  // Vendor opening balance — a carried-forward payable that predates the
  // purchases in this system. Treated as a credit (we owe more), dated on
  // its explicit date or the vendor's creation date, and always part of
  // the running balance. Mirrors the customer opening_balance ledger type
  // but fits the derived vendor ledger (no second ledger table).
  const ob = Number(vendor.opening_balance || 0);
  if (ob > 0.005) {
    const obDate = vendor.opening_balance_date ? iso(vendor.opening_balance_date) : null;
    // Use a stable early date so the opening row sorts before purchases
    // when no explicit date is stored; the ledger's opening calculation
    // still counts it (it is added to `opening` below).
    const dateForRow = obDate || '1970-01-01';
    rows.push({
      date: dateForRow,
      reference: 'OPENING',
      description: vendor.opening_balance_note ? `Opening balance — ${vendor.opening_balance_note}` : 'Opening balance',
      type: 'invoices',
      method: null,
      credit: round2(ob),
      debit: 0,
      _isOpening: true,
    });
  }
  for (const inv of invoices) {
    rows.push({
      date: iso(inv.purchase_date),
      reference: `INV #${inv.id}`,
      description: `Purchase, ${inv.item_count} item${inv.item_count === 1 ? '' : 's'}`,
      type: 'invoices',
      method: null,
      credit: Number(inv.total),
      debit: 0,
    });
  }
  for (const p of payments) {
    rows.push({
      date: iso(p.payment_date),
      reference: p.reference || `PAY #${p.id}`,
      description: `Payment via ${p.method}${p.note ? ` — ${p.note}` : ''}`,
      type: 'payments',
      method: p.method,
      credit: 0,
      debit: Number(p.amount),
    });
  }
  for (const c of claims) {
    rows.push({
      date: storeDate(c.settled_at, settings.timezone),
      reference: c.adjustment_ref || `CLM #${c.id}`,
      description: `Claim settled${c.reason ? ` — ${c.reason}` : ''}`,
      type: 'adjustments',
      method: null,
      credit: 0,
      debit: Number(c.amount),
    });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Opening balance for the range: opening_balance column + every row dated
  // strictly before `from`. The closing is the opening plus every in-range row.
  let opening = Number(vendor.opening_balance || 0);
  // Add historical rows before `from`, but do not double-count the synthetic
  // opening row (it is already in `opening` via the column).
  for (const r of rows) {
    if (r._isOpening) continue;
    if (from && r.date && r.date < from) opening += r.credit - r.debit;
  }
  opening = round2(opening);

  // In-range rows, filtered, with running balance.
  // The synthetic opening row is shown when it falls in range (or when no `from`).
  let balance = opening;
  // If the synthetic opening row is dated before `from`, it is already counted
  // in `opening` and must not be emitted again; otherwise start the ledger
  // with the stored opening balance already in `balance` and emit the row
  // with a 0 delta (so the table shows the opening entry).
  // Simpler: emit the synthetic row only when it is in range; its credit is
  // NOT added again to `balance` because `balance` already contains it.
  const out = [];
  for (const r of rows) {
    if (!r.date) continue;
    if (from && r.date < from) continue;
    if (to && r.date > to) continue;
    if (type !== 'all' && r.type !== type) continue;
    if (method && r.type === 'payments' && r.method !== method) continue;
    if (r._isOpening) {
      // Opening row: balance is the opening itself (already in `balance`),
      // not opening + credit again.
      out.push({ date: r.date === '1970-01-01' ? '' : r.date, reference: r.reference, description: r.description, type: r.type, method: r.method, credit: r.credit, debit: r.debit, balance: round2(opening) });
      continue;
    }
    balance = round2(balance + r.credit - r.debit);
    out.push({ ...r, balance });
  }
  // When no synthetic opening row was emitted but we still carry an opening
  // balance (e.g. filtered out by date/type), the closing must still reflect it.
  // `balance` already does; `opening` is the correct opening.

  return ok({
    opening,
    closing: round2(balance),
    today,
    opening_balance: round2(Number(vendor.opening_balance || 0)),
    opening_balance_note: vendor.opening_balance_note || '',
    opening_balance_date: vendor.opening_balance_date ? iso(vendor.opening_balance_date) : null,
    rows: out,
  });
}
