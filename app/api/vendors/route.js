// GET  /api/vendors -> list (admin)
// POST /api/vendors -> create (admin)
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { readJson, str, fail, ok, okGzip } from '@/lib/validate';

export async function GET(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const rows = await query(
    `SELECT v.id, v.name, v.phone, v.notes, v.active, v.created_at,
            COALESCE(v.opening_balance, 0) AS opening_balance,
            v.opening_balance_note, v.opening_balance_date,
            COALESCE(v.opening_balance, 0)
              + COALESCE((SELECT SUM(pr.total) FROM purchases pr WHERE pr.vendor_id = v.id), 0)
              - COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp WHERE pp.vendor_id = v.id), 0)
              - COALESCE((SELECT SUM(vc.amount) FROM vendor_claims vc WHERE vc.vendor_id = v.id AND vc.status = 'settled'), 0)
              AS outstanding
       FROM vendors v
      ORDER BY v.name`
  );
  return okGzip({ vendors: rows.map((r) => ({ ...r, opening_balance: Number(r.opening_balance), outstanding: Number(r.outstanding) })) }, req);
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

  const rows = await query(
    'INSERT INTO vendors (name, phone, notes) VALUES ($1, $2, $3) RETURNING id',
    [name, phone, notes]
  );
  return ok({ id: rows[0].id }, 201);
}
