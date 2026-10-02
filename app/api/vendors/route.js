// GET  /api/vendors -> list (admin)
// POST /api/vendors -> create (admin)
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { readJson, str, toNumber, validDate, fail, ok, okGzip, round2 } from '@/lib/validate';

const MAX_OB = 999_999_999.99;
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

export function formatVendorRow(r) {
  const ob = round2(Number(r.opening_balance || 0));
  const obType = r.opening_balance_type === 'receivable' ? 'receivable' : 'payable';
  const signedOb = obType === 'receivable' ? -ob : ob;
  const totalPurchases = round2(Number(r.total_purchases || 0));
  const totalPayments = round2(Number(r.total_payments || 0));
  const totalClaims = round2(Number(r.total_claims || 0));
  const outstanding = round2(
    r.outstanding !== undefined
      ? Number(r.outstanding)
      : signedOb + totalPurchases - totalPayments - totalClaims
  );
  const payable = round2(Math.max(0, outstanding));
  const receivable = round2(Math.max(0, -outstanding));
  return {
    id: r.id,
    name: r.name,
    phone: r.phone || '',
    notes: r.notes || '',
    active: Boolean(r.active),
    created_at: r.created_at,
    opening_balance: ob,
    opening_balance_type: obType,
    opening_balance_date: iso(r.opening_balance_date),
    opening_balance_note: r.opening_balance_note || '',
    opening_payable: obType === 'payable' ? ob : 0,
    opening_receivable: obType === 'receivable' ? ob : 0,
    total_purchases: totalPurchases,
    total_payments: totalPayments,
    total_claims: totalClaims,
    outstanding,
    payable,
    receivable,
    balance_type: payable > 0.005 ? 'payable' : receivable > 0.005 ? 'receivable' : 'settled',
  };
}

export function parseOpeningBalanceInput(body) {
  const rawAmt =
    body.opening_balance !== undefined
      ? body.opening_balance
      : body.openingBalance !== undefined
        ? body.openingBalance
        : body.amount;
  const hasAmt = rawAmt !== undefined;
  let amount = 0;
  if (hasAmt && rawAmt !== '' && rawAmt !== null) {
    const n = toNumber(rawAmt);
    if (n === null || n < 0) {
      return { error: 'Opening balance must be 0 or a positive amount.' };
    }
    if (n > MAX_OB) {
      return { error: 'Opening balance exceeds the maximum allowed amount (999,999,999.99).' };
    }
    amount = round2(n);
  }

  const rawType =
    body.opening_balance_type ??
    body.openingBalanceType ??
    body.direction ??
    body.type;
  const hasType = rawType !== undefined;
  let type = 'payable';
  if (hasType && rawType !== '' && rawType !== null) {
    const normalizedType = String(rawType).toLowerCase().trim();
    if (!['payable', 'receivable'].includes(normalizedType)) {
      return { error: 'Opening balance direction must be "payable" or "receivable".' };
    }
    type = normalizedType;
  }

  const rawDate =
    body.opening_balance_date !== undefined
      ? body.opening_balance_date
      : body.openingBalanceDate !== undefined
        ? body.openingBalanceDate
        : body.date;
  const hasDate = rawDate !== undefined;
  let date = null;
  if (hasDate && rawDate !== '' && rawDate !== null) {
    date = validDate(rawDate);
    if (!date) return { error: 'Invalid opening balance date (use YYYY-MM-DD).' };
  }

  const rawNote =
    body.opening_balance_note !== undefined
      ? body.opening_balance_note
      : body.openingBalanceNote !== undefined
        ? body.openingBalanceNote
        : body.note;
  const hasNote = rawNote !== undefined;
  const note = hasNote ? str(rawNote, { max: 200 }) ?? '' : '';

  return {
    provided: hasAmt || hasType || hasDate || hasNote,
    hasAmt,
    hasType,
    hasDate,
    hasNote,
    amount,
    type,
    date,
    note,
  };
}

export const VENDOR_SELECT_SQL = `
  SELECT v.id, v.name, v.phone, v.notes, v.active, v.created_at,
         COALESCE(v.opening_balance, 0) AS opening_balance,
         COALESCE(v.opening_balance_type, 'payable') AS opening_balance_type,
         v.opening_balance_date,
         COALESCE(v.opening_balance_note, '') AS opening_balance_note,
         COALESCE((SELECT SUM(pr.total) FROM purchases pr WHERE pr.vendor_id = v.id), 0) AS total_purchases,
         COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp WHERE pp.vendor_id = v.id), 0) AS total_payments,
         COALESCE((SELECT SUM(vc.amount) FROM vendor_claims vc WHERE vc.vendor_id = v.id AND vc.status = 'settled'), 0) AS total_claims,
         (CASE WHEN COALESCE(v.opening_balance_type, 'payable') = 'receivable'
               THEN -COALESCE(v.opening_balance, 0)
               ELSE COALESCE(v.opening_balance, 0)
          END)
           + COALESCE((SELECT SUM(pr.total) FROM purchases pr WHERE pr.vendor_id = v.id), 0)
           - COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp WHERE pp.vendor_id = v.id), 0)
           - COALESCE((SELECT SUM(vc.amount) FROM vendor_claims vc WHERE vc.vendor_id = v.id AND vc.status = 'settled'), 0)
           AS outstanding
    FROM vendors v
`;

export async function GET(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const rows = await query(`${VENDOR_SELECT_SQL} ORDER BY v.name`);
  return okGzip({ vendors: rows.map(formatVendorRow) }, req);
}

export async function POST(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');
  const name = str(body.name, { max: 120 });
  const phone = str(body.phone, { max: 30 }) ?? '';
  const notes = str(body.notes, { max: 300 }) ?? '';

  if (!name) return fail('Vendor name is required.');

  const ob = parseOpeningBalanceInput(body);
  if (ob.error) return fail(ob.error, 400);

  const amount = ob.hasAmt ? ob.amount : 0;
  const type = amount === 0 ? (ob.hasType ? ob.type : 'payable') : ob.type;
  const date = amount === 0 ? null : ob.date;
  const note = amount === 0 ? '' : ob.note;

  const updatedAt = amount > 0 ? new Date() : null;
  const updatedBy = amount > 0 ? auth.user.id : null;

  const rows = await query(
    `INSERT INTO vendors (
       name, phone, notes,
       opening_balance, opening_balance_type, opening_balance_date, opening_balance_note,
       opening_balance_updated_at, opening_balance_updated_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [name, phone, notes, amount, type, date, note, updatedAt, updatedBy]
  );
  const full = await query(`${VENDOR_SELECT_SQL} WHERE v.id = $1`, [rows[0].id]);
  return ok(formatVendorRow(full[0]), 201);
}
