// PUT /api/vendors/:id -> edit / enable / disable (admin)
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { readJson, str, fail, ok } from '@/lib/validate';

export async function PUT(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;
  const vendorId = Number(id);
  if (!Number.isInteger(vendorId)) return fail('Invalid vendor id.', 404);

  const rows = await query('SELECT id FROM vendors WHERE id = $1', [vendorId]);
  if (!rows.length) return fail('Vendor not found.', 404);

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
  if (sets.length) {
    values.push(vendorId);
    await query(`UPDATE vendors SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
  }
  return ok(null);
}
