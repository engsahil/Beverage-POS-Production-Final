// GET  /api/claims -> list (admin; ?status=pending|settled)
// POST /api/claims -> create a vendor claim (admin)
// Simple internal record + status workflow. No settlement APIs,
// no automatic stock changes (use Inventory > Adjust if needed).
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { readJson, str, toNumber, validDate, fail, ok, okGzip, round2 } from '@/lib/validate';

export async function GET(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const sp = req.nextUrl.searchParams;
  const status = sp.get('status') || '';
  const where = ['pending', 'settled'].includes(status) ? 'WHERE vc.status = $1' : '';
  const params = where ? [status] : [];
  const rows = await query(
    `SELECT vc.*, v.name AS vendor_name, p.name AS product_name,
            u.full_name AS created_by_name
       FROM vendor_claims vc
       JOIN vendors v ON v.id = vc.vendor_id
       LEFT JOIN products p ON p.id = vc.product_id
       LEFT JOIN users u ON u.id = vc.created_by
       ${where}
      ORDER BY vc.id DESC
      LIMIT 200`,
    params
  );
  return okGzip({ claims: rows }, req);
}

export async function POST(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');
  const vendorId = Number(body.vendorId);
  const productId = body.productId ? Number(body.productId) : null;
  const qty = body.qty === undefined || body.qty === null || body.qty === '' ? null : toNumber(body.qty);
  const amount = toNumber(body.amount);
  const reason = str(body.reason, { max: 200 });
  const date = body.date ? validDate(body.date) : null;
  const note = str(body.note, { max: 300 }) ?? '';

  if (!Number.isInteger(vendorId)) return fail('Select a vendor.');
  if (qty !== null && (qty === null || qty <= 0)) return fail('Quantity must be above zero.');
  if (amount === null || amount <= 0) return fail('Enter the claim amount.');
  if (!reason) return fail('Enter a reason.');
  if (body.date && !date) return fail('Invalid claim date.');

  const vendor = await query('SELECT id FROM vendors WHERE id = $1', [vendorId]);
  if (!vendor.length) return fail('Vendor not found.', 404);
  if (productId) {
    const product = await query('SELECT id FROM products WHERE id = $1', [productId]);
    if (!product.length) return fail('Product not found.');
  }

  const rows = await query(
    `INSERT INTO vendor_claims (vendor_id, product_id, qty, amount, reason, claim_date, note, created_by)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE), $7, $8) RETURNING id`,
    [vendorId, productId, qty !== null ? round2(qty) : null, round2(amount), reason, date, note, auth.user.id]
  );
  return ok({ id: rows[0].id }, 201);
}
