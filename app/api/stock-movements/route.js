// GET /api/stock-movements?productId=1&limit=50 (admin)
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { fail, ok, okGzip } from '@/lib/validate';

export async function GET(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const sp = req.nextUrl.searchParams;
  const productId = Number(sp.get('productId'));
  if (!Number.isInteger(productId)) return fail('productId is required.');
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 50, 1), 200);

  const rows = await query(
    `SELECT sm.id, sm.change, sm.reason, sm.note, sm.created_at,
            u.full_name AS user_name
       FROM stock_movements sm
       LEFT JOIN users u ON u.id = sm.created_by
      WHERE sm.product_id = $1
      ORDER BY sm.id DESC
      LIMIT $2`,
    [productId, limit]
  );
  return okGzip({ movements: rows }, req);
}
