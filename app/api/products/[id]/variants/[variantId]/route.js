// DELETE /api/products/:id/variants/:variantId -> remove a size (admin)
// Historic sale lines keep their name/price snapshots; the variant row is
// removed and its remaining stock is written off as an adjustment so the
// stock ledger stays honest.
import { query, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { fail, ok } from '@/lib/validate';

export async function DELETE(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id, variantId } = await params;
  const productId = Number(id);
  const vid = Number(variantId);
  if (!Number.isInteger(productId) || !Number.isInteger(vid)) return fail('Invalid product id.', 404);

  const rows = await query('SELECT * FROM product_variants WHERE id = $1', [vid]);
  const variant = rows[0];
  if (!variant || Number(variant.product_id) !== productId) return fail('Size not found for this product.', 404);

  await withTransaction(async (client) => {
    await client.query('DELETE FROM product_variants WHERE id = $1', [vid]);
    if (Number(variant.stock) > 0) {
      await client.query(
        `INSERT INTO stock_movements (product_id, variant_id, change, reason, note, created_by)
         VALUES ($1, NULL, $2, 'adjustment', $3, $4)`,
        [productId, -Number(variant.stock), `Size removed: ${variant.name}`, auth.user.id]
      );
    }
    await client.query(
      `UPDATE products SET stock = (SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = $1), updated_at = now()
        WHERE id = $1`,
      [productId]
    );
    // keep the legacy JSONB mirror in sync
    const rest = await client.query('SELECT name, price FROM product_variants WHERE product_id = $1', [productId]);
    await client.query('UPDATE products SET variants = $1, updated_at = now() WHERE id = $2', [
      rest.length ? JSON.stringify(rest.rows.map((r) => ({ name: r.name, price: Number(r.price) }))) : null,
      productId,
    ]);
  });
  return ok(null);
}
