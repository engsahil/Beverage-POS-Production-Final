// PUT /api/products/:id -> edit product (admin)
// - For products WITHOUT variants, a stock change is recorded as an adjustment.
// - For products WITH variants, stock lives on the variant rows; the submitted
//   `variants` list is reconciled (by id or name) and the product summary
//   stock is kept equal to the sum of variant stock.
import { query, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { readJson, str, toNumber, validDate, fail, ok, round2 } from '@/lib/validate';
import { parseImageData } from '../image-data';
import { parseVariants, syncVariants } from '../variants';

export async function PUT(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isInteger(productId)) return fail('Invalid product id.', 404);

  const rows = await query('SELECT * FROM products WHERE id = $1', [productId]);
  const product = rows[0];
  if (!product) return fail('Product not found.', 404);

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');

  const name = body.name !== undefined ? str(body.name, { max: 120 }) : product.name;
  const barcode =
    body.barcode === undefined ? product.barcode : body.barcode ? str(body.barcode, { max: 60 }) : null;
  const categoryId =
    body.categoryId === undefined ? product.category_id : body.categoryId ? Number(body.categoryId) : null;
  const price = body.price !== undefined ? toNumber(body.price) : Number(product.price);
  const cost =
    body.cost !== undefined
      ? body.cost === null || body.cost === ''
        ? 0
        : toNumber(body.cost)
      : Number(product.cost);
  const minStock =
    body.minStock !== undefined
      ? body.minStock === null || body.minStock === ''
        ? 0
        : toNumber(body.minStock)
      : Number(product.min_stock);
  const minPrice =
    body.minPrice !== undefined
      ? body.minPrice === null || body.minPrice === ''
        ? 0
        : toNumber(body.minPrice)
      : Number(product.min_price);
  const expiryDate =
    body.expiryDate === undefined
      ? product.expiry_date
        ? String(product.expiry_date).slice(0, 10)
        : null
      : body.expiryDate
        ? validDate(body.expiryDate)
        : null;
  const active = typeof body.active === 'boolean' ? body.active : product.active;
  if (body.expiryDate && !expiryDate) return fail('Invalid expiry date.');

  // Optional pricing-mode prices (PATCH semantics: absent = keep, null/'' =
  // clear, number = set). A cleared price falls back to retail at sale time.
  // Comfortably inside numeric(12,2) — a crafted huge value must fail
  // validation (400), not overflow the column (500).
  const MAX_MONEY = 999999999.99;
  const parseModePrice = (field, existing) => {
    if (body[field] === undefined) {
      return { ok: true, value: existing === null || existing === undefined ? null : Number(existing) };
    }
    if (body[field] === null || body[field] === '') return { ok: true, value: null };
    const n = toNumber(body[field]);
    if (n === null || n < 0 || n > MAX_MONEY) return { ok: false, value: null };
    return { ok: true, value: round2(n) };
  };
  const wholesaleP = parseModePrice('wholesalePrice', product.wholesale_price);
  if (!wholesaleP.ok) return fail('Wholesale price must be a number of 0 or more.');
  const specialP = parseModePrice('specialPrice', product.special_price);
  if (!specialP.ok) return fail('Sale / Special price must be a number of 0 or more.');
  const wholesalePrice = wholesaleP.value;
  const specialPrice = specialP.value;

  // Product-level per-mode minimum selling price (PATCH semantics: absent =
  // keep, null/'' = clear, number = set; boolean for the protection switch).
  if (body.minPriceEnabled !== undefined && typeof body.minPriceEnabled !== 'boolean') {
    return fail('Minimum price protection must be ON or OFF.');
  }
  const minPriceEnabled =
    body.minPriceEnabled === undefined ? product.min_price_enabled === true : body.minPriceEnabled === true;
  const minRetailP = parseModePrice('minRetail', product.min_retail);
  if (!minRetailP.ok) return fail('Retail minimum must be a number of 0 or more.');
  const minWholesaleP = parseModePrice('minWholesale', product.min_wholesale);
  if (!minWholesaleP.ok) return fail('Wholesale minimum must be a number of 0 or more.');
  const minSpecialP = parseModePrice('minSpecial', product.min_special);
  if (!minSpecialP.ok) return fail('Sale / Special minimum must be a number of 0 or more.');

  if (!name) return fail('Product name is required.');
  if (price === null || price < 0 || price > MAX_MONEY) return fail('Selling price must be a number of 0 or more.');
  if (cost === null || cost < 0 || cost > MAX_MONEY) return fail('Cost price must be a number of 0 or more.');
  if (minStock === null || minStock < 0) return fail('Minimum stock must be 0 or more.');
  if (minPrice === null || minPrice < 0 || minPrice > MAX_MONEY) return fail('Minimum selling price must be a number of 0 or more.');
  if (minPrice > price) return fail('Minimum selling price cannot be higher than the selling price.');
  if (barcode) {
    const dupe = await query('SELECT id FROM products WHERE barcode = $1 AND id <> $2', [barcode, productId]);
    if (dupe.length > 0) return fail('Another product already uses this barcode.', 409);
    const vdupe = await query('SELECT id FROM product_variants WHERE barcode = $1', [barcode]);
    if (vdupe.length > 0) return fail('That barcode is already used by a size.', 409);
  }
  if (categoryId) {
    const cat = await query('SELECT id FROM categories WHERE id = $1', [categoryId]);
    if (!cat.length) return fail('Category not found.');
  }

  const variants = parseVariants(body.variants, { allowId: true });
  if (variants.error) return fail(variants.error);
  if (variants.value) {
    for (const v of variants.value) {
      if (!v.barcode) continue;
      const dupe = await query(
        `SELECT id FROM products WHERE barcode = $1
         UNION ALL SELECT id FROM product_variants WHERE barcode = $1 AND id <> COALESCE($2::int, 0)`,
        [v.barcode, v.id]
      );
      if (dupe.length > 0) return fail(`Size "${v.name}": that barcode is already in use.`, 409);
    }
  }

  const hasVariantRows =
    (await query('SELECT 1 FROM product_variants WHERE product_id = $1 LIMIT 1', [productId])).length > 0;

  let imageData = null;
  let imageMime = null;
  if (body.imageData) {
    const parsed = parseImageData(body.imageData);
    if (parsed.error) return fail(parsed.error);
    imageData = parsed.buffer;
    imageMime = parsed.mime;
  }

  try {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE products
            SET name = $1, barcode = $2, category_id = $3, price = $4, cost = $5,
                min_stock = $6, min_price = $7, wholesale_price = $8, special_price = $9,
                min_price_enabled = $10, min_retail = $11, min_wholesale = $12, min_special = $13,
                expiry_date = $14, active = $15, updated_at = now()
          WHERE id = $16`,
        [name, barcode, categoryId, round2(price), round2(cost), round2(minStock), round2(minPrice),
         wholesalePrice, specialPrice,
         minPriceEnabled, minRetailP.value, minWholesaleP.value, minSpecialP.value,
         expiryDate, active, productId]
      );

      if (imageData) {
        await client.query('UPDATE products SET image_data = $1, image_mime = $2, updated_at = now() WHERE id = $3', [
          imageData,
          imageMime,
          productId,
        ]);
      } else if (body.clearImage === true && product.image_data) {
        await client.query('UPDATE products SET image_data = NULL, image_mime = NULL, updated_at = now() WHERE id = $1', [
          productId,
        ]);
      }

      // Variants: reconcile / clear (undefined = no change)
      if (variants.value !== undefined) {
        if (variants.value === null) {
          await client.query('DELETE FROM product_variants WHERE product_id = $1', [productId]);
        } else {
          const sync = await syncVariants(client, productId, variants.value);
          if (sync.error) throw new Error(sync.error);
        }
        // legacy JSONB mirror stays consistent
        const mirror =
          variants.value === null
            ? null
            : JSON.stringify(variants.value.map((v) => ({ name: v.name, price: v.price })));
        await client.query('UPDATE products SET variants = $1, updated_at = now() WHERE id = $2', [mirror, productId]);
      }

      // Product-level stock edit applies only to products without variants.
      const newStock =
        body.stock !== undefined && body.stock !== null && body.stock !== '' ? toNumber(body.stock) : null;
      if (newStock !== null && newStock < 0) throw new Error('Stock must be 0 or more.');
      if (newStock !== null && !hasVariantRows) {
        // Lock the row (waits for in-flight sales to commit) so a sale's
        // stock decrement can't be silently overwritten, and so the
        // movement records the true delta instead of a stale one.
        const locked = await client.query('SELECT stock FROM products WHERE id = $1 FOR UPDATE', [productId]);
        const currentStock = Number(locked.rows[0]?.stock ?? product.stock);
        if (Math.abs(newStock - currentStock) > 0.001) {
          await client.query('UPDATE products SET stock = $1, updated_at = now() WHERE id = $2', [
            round2(newStock),
            productId,
          ]);
          const diff = round2(newStock - currentStock);
          await client.query(
            `INSERT INTO stock_movements (product_id, change, reason, note, created_by)
             VALUES ($1, $2, 'adjustment', 'Stock set in product edit', $3)`,
            [productId, diff, auth.user.id]
          );
        }
      }
    });
  } catch (err) {
    return fail(err.message || 'Could not save the product.');
  }
  return ok(null);
}
