// GET /api/vendors/:id/opening-balance -> inspect vendor opening balance (admin)
// PUT /api/vendors/:id/opening-balance -> set/update/clear vendor opening balance (admin)
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { readJson, fail, ok } from '@/lib/validate';
import { VENDOR_SELECT_SQL, formatVendorRow, parseOpeningBalanceInput } from '../../route.js';

export async function GET(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const vendorId = Number((await params).id);
  if (!Number.isInteger(vendorId)) return fail('Invalid vendor id.', 404);

  const rows = await query(`${VENDOR_SELECT_SQL} WHERE v.id = $1`, [vendorId]);
  if (!rows.length) return fail('Vendor not found.', 404);
  return ok(formatVendorRow(rows[0]));
}

export async function PUT(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const vendorId = Number((await params).id);
  if (!Number.isInteger(vendorId)) return fail('Invalid vendor id.', 404);

  const existingRows = await query(
    'SELECT id, opening_balance, opening_balance_type, opening_balance_date, opening_balance_note FROM vendors WHERE id = $1',
    [vendorId]
  );
  if (!existingRows.length) return fail('Vendor not found.', 404);
  const existing = existingRows[0];

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');

  const ob = parseOpeningBalanceInput(body);
  if (ob.error) return fail(ob.error, 400);
  if (!ob.hasAmt) return fail('Enter an opening balance of 0 or more.', 400);

  const nextAmount = ob.amount;
  const nextType = ob.hasType ? ob.type : existing.opening_balance_type || 'payable';
  const nextDate = nextAmount === 0 ? null : ob.hasDate ? ob.date : existing.opening_balance_date;
  const nextNote = nextAmount === 0 ? '' : ob.hasNote ? ob.note : existing.opening_balance_note || '';

  await query(
    `UPDATE vendors
        SET opening_balance = $1,
            opening_balance_type = $2,
            opening_balance_date = $3,
            opening_balance_note = $4,
            opening_balance_updated_at = now(),
            opening_balance_updated_by = $5
      WHERE id = $6`,
    [nextAmount, nextType, nextDate, nextNote, auth.user.id, vendorId]
  );

  const updated = await query(`${VENDOR_SELECT_SQL} WHERE v.id = $1`, [vendorId]);
  return ok(formatVendorRow(updated[0]));
}
