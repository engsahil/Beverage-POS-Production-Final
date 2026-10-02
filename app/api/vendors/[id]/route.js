// GET /api/vendors/:id -> single vendor details (admin)
// PUT /api/vendors/:id -> edit vendor + opening balance / enable / disable (admin)
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { readJson, str, fail, ok } from '@/lib/validate';
import { VENDOR_SELECT_SQL, formatVendorRow, parseOpeningBalanceInput } from '../route.js';

export async function GET(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;
  const vendorId = Number(id);
  if (!Number.isInteger(vendorId)) return fail('Invalid vendor id.', 404);

  const rows = await query(`${VENDOR_SELECT_SQL} WHERE v.id = $1`, [vendorId]);
  if (!rows.length) return fail('Vendor not found.', 404);
  return ok({ vendor: formatVendorRow(rows[0]) });
}

export async function PUT(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;
  const vendorId = Number(id);
  if (!Number.isInteger(vendorId)) return fail('Invalid vendor id.', 404);

  const existingRows = await query(
    'SELECT id, opening_balance, opening_balance_type, opening_balance_date, opening_balance_note FROM vendors WHERE id = $1',
    [vendorId]
  );
  if (!existingRows.length) return fail('Vendor not found.', 404);
  const existing = existingRows[0];

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');

  const sets = [];
  const values = [];
  if (body.name !== undefined) {
    const name = str(body.name, { max: 120 });
    if (!name) return fail('Vendor name is required.');
    values.push(name);
    sets.push(`name = $${values.length}`);
  }
  if (body.phone !== undefined) {
    values.push(str(body.phone, { max: 30 }) ?? '');
    sets.push(`phone = $${values.length}`);
  }
  if (body.notes !== undefined) {
    values.push(str(body.notes, { max: 300 }) ?? '');
    sets.push(`notes = $${values.length}`);
  }
  if (typeof body.active === 'boolean') {
    values.push(body.active);
    sets.push(`active = $${values.length}`);
  }

  const ob = parseOpeningBalanceInput(body);
  if (ob.error) return fail(ob.error, 400);
  if (ob.provided) {
    const nextAmount = ob.hasAmt ? ob.amount : Number(existing.opening_balance || 0);
    const nextType = ob.hasType ? ob.type : existing.opening_balance_type || 'payable';
    const nextDate = nextAmount === 0 ? null : ob.hasDate ? ob.date : existing.opening_balance_date;
    const nextNote = nextAmount === 0 ? '' : ob.hasNote ? ob.note : existing.opening_balance_note || '';

    values.push(nextAmount);
    sets.push(`opening_balance = $${values.length}`);
    values.push(nextType);
    sets.push(`opening_balance_type = $${values.length}`);
    values.push(nextDate);
    sets.push(`opening_balance_date = $${values.length}`);
    values.push(nextNote);
    sets.push(`opening_balance_note = $${values.length}`);
    values.push(auth.user.id);
    sets.push(`opening_balance_updated_by = $${values.length}`);
    sets.push(`opening_balance_updated_at = now()`);
  }

  if (sets.length) {
    values.push(vendorId);
    await query(`UPDATE vendors SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
  }

  const updated = await query(`${VENDOR_SELECT_SQL} WHERE v.id = $1`, [vendorId]);
  return ok(formatVendorRow(updated[0]));
}
