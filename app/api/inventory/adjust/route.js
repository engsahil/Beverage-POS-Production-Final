// POST /api/inventory/adjust -> manual stock adjustment
// { productId, delta, note? }  — delta may be negative.
// Allowed for admins and cashiers holding the stock_adjustment permission.
import { query, withTransaction } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { readJson, toNumber, str, fail, ok, HttpError } from '@/lib/validate';
import { formatQtySafe } from './formatQty';

export async function POST(req) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  if (!hasPermission(auth.user, 'stock_adjustment')) {
    return fail('You do not have permission to adjust stock.', 403);
  }

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');
  const productId = Number(body.productId);
  const delta = toNumber(body.delta);
  const note = str(body.note, { max: 160 }) ?? '';
  const variantId = body.variantId ? Number(body.variantId) : null;
  if (body.variantId && (!Number.isInteger(variantId) || variantId < 1)) return fail('Invalid size.');

  if (!Number.isInteger(productId)) return fail('Invalid product.');
  if (delta === null || delta === 0) return fail('Enter a quantity to adjust.');

  try {
    await withTransaction(async (client) => {
      const res = await client.query('SELECT id, name, stock FROM products WHERE id = $1 FOR UPDATE', [
        productId,
      ]);
      const product = res.rows[0];
      if (!product) throw new HttpError('Product not found.', 404);

      let variant = null;
      if (variantId) {
        const vRes = await client.query('SELECT * FROM product_variants WHERE id = $1 FOR UPDATE', [
          variantId,
        ]);
        variant = vRes.rows[0];
        if (!variant || Number(variant.product_id) !== productId) {
          throw new HttpError('That size does not belong to this product.', 400);
        }
      } else {
        const vCount = await client.query('SELECT 1 FROM product_variants WHERE product_id = $1 LIMIT 1', [
          productId,
        ]);
        if (vCount.rows.length > 0) {
          throw new HttpError('This product has sizes — adjust a specific size.', 400);
        }
      }

      const targetStock = variant ? Number(variant.stock) : Number(product.stock);
      const newStock = targetStock + delta;
      if (newStock < 0) {
        throw new HttpError(
          `Cannot reduce below zero. Current stock is ${formatQtySafe(targetStock)}.`,
          400
        );
      }
      if (variant) {
        await client.query('UPDATE product_variants SET stock = $1, updated_at = now() WHERE id = $2', [
          newStock,
          variant.id,
        ]);
      }
      await client.query('UPDATE products SET stock = stock + $1, updated_at = now() WHERE id = $2', [
        delta,
        productId,
      ]);
      await client.query(
        `INSERT INTO stock_movements (product_id, variant_id, change, reason, note, created_by)
         VALUES ($1, $2, $3, 'adjustment', $4, $5)`,
        [productId, variant ? variant.id : null, delta, variant ? `${note} (${variant.name})` : note, auth.user.id]
      );
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    console.error('[inventory] adjustment failed:', err);
    return fail('Unable to adjust stock. Please try again.', 500);
  }
  return ok(null);
}
