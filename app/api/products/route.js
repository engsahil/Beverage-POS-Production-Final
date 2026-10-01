// GET  /api/products -> list (admin: all; cashier: active only)
//      supports ?search= (name, barcode or variant name) and ?categoryId=
// POST /api/products -> create (admin), optionally with full variant rows
import { query, withTransaction } from '@/lib/db';
import { requireAdmin, requireUser } from '@/lib/auth';
import { readJson, str, toNumber, validDate, fail, ok, okGzip, round2 } from '@/lib/validate';
import { parseImageData } from './image-data';
import { parseVariants, syncVariants } from './variants';
import { variantAggregate, stockValueExpr } from '@/lib/inventory';

/**
 * Optional non-negative price. Blank / null / omitted => null ("not
 * configured", the price falls back to retail at sale time). A present but
 * invalid value returns null too, so the caller must distinguish "absent"
 * from "invalid" via the `absent` flag.
 */
// Comfortably inside numeric(12,2) so a crafted huge value fails
// validation (400) instead of overflowing the column (500).
const MAX_MONEY = 999999999.99;

function optPrice(value) {
  if (value === undefined || value === null || value === '') return { absent: true, value: null };
  const n = toNumber(value);
  if (n === null || n < 0 || n > MAX_MONEY) return { absent: false, value: 'invalid' };
  return { absent: false, value: n };
}

/**
 * Field projection for the POS screen.
 *
 * The POS sells; it never shows cost, stock value, category names or the
 * purchasing fields (reorder level, batch, supplier, tax). Sending them anyway
 * cost ~190 kB of the ~630 kB catalogue payload on every POS open. Admin
 * screens keep the full row — the default response is unchanged, so no
 * existing caller breaks. `?view=pos` opts in.
 *
 * The list is derived from what components/pos/PosClient.jsx and
 * lib/pricing.js actually read, not guessed.
 */
const POS_PRODUCT_FIELDS = `p.id, p.name, p.barcode, p.price, p.stock, p.min_stock,
            p.min_price, p.wholesale_price, p.special_price, p.expiry_date, p.active,
            p.min_price_enabled, p.min_retail, p.min_wholesale, p.min_special,
            p.category_id, (p.image_data IS NOT NULL) AS has_image`;

const POS_VARIANT_FIELDS = `v.product_id, v.id, v.name, v.price, v.wholesale_price, v.special_price,
         v.discount_pct, v.stock, v.active, v.barcode, v.expiry_date,
         v.min_price_enabled, v.min_retail, v.min_wholesale, v.min_special`;

const VARIANT_SELECT = `
  SELECT v.product_id, v.id, v.name, v.unit, v.sku, v.barcode, v.price, v.wholesale_price, v.retail_price,
         v.special_price, v.cost, v.tax_rate, v.discount_pct, v.stock, v.min_stock, v.reorder_level,
         v.expiry_date, v.batch_no, v.supplier_id, v.active, v.sort_order,
         v.min_price_enabled, v.min_retail, v.min_wholesale, v.min_special,
         (v.image_data IS NOT NULL) AS has_image, v.image_mime
    FROM product_variants v`;

async function attachVariants(products, fields = null) {
  if (!products.length) return products;
  // Ordering is by sort_order/id regardless of which columns are selected, so
  // a projection cannot change the order sizes appear in.
  const select = fields
    ? `SELECT ${fields} FROM product_variants v`
    : VARIANT_SELECT;
  const rows = await query(
    `${select} WHERE v.product_id = ANY($1::int[]) ORDER BY v.product_id, v.sort_order, v.id`,
    [products.map((p) => p.id)]
  );
  const byProduct = new Map();
  for (const r of rows) {
    if (!byProduct.has(Number(r.product_id))) byProduct.set(Number(r.product_id), []);
    byProduct.get(Number(r.product_id)).push(r);
  }
  for (const p of products) {
    p.variants = byProduct.get(Number(p.id)) || [];
  }
  return products;
}

export async function GET(req) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const sp = req.nextUrl.searchParams;
  const search = (sp.get('search') || '').trim();
  const categoryId = sp.get('categoryId') || '';
  const isAdmin = auth.user.role === 'admin';

  const where = [];
  const params = [];
  if (!isAdmin) where.push('p.active = TRUE');
  if (categoryId) {
    params.push(Number(categoryId));
    where.push(`p.category_id = $${params.length}`);
  }
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where.push(
      `(LOWER(p.name) LIKE $${params.length} OR LOWER(COALESCE(p.barcode, '')) LIKE $${params.length}
        OR EXISTS (SELECT 1 FROM product_variants pv2
                    WHERE pv2.product_id = p.id AND LOWER(pv2.name) LIKE $${params.length}))`
    );
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const posView = sp.get('view') === 'pos';

  if (posView) {
    // No category join and no variant aggregate lateral: the POS filters by
    // category_id (it already has the category list) and never shows a value
    // at cost, so that work is simply not done.
    const rows = await query(
      `SELECT ${POS_PRODUCT_FIELDS}
         FROM products p
         ${whereSql}
        ORDER BY p.name
        LIMIT 1000`,
      params
    );
    return okGzip({ products: await attachVariants(rows, POS_VARIANT_FIELDS) }, req);
  }

  const rows = await query(
    `SELECT p.id, p.name, p.barcode, p.price, p.cost, p.stock, p.min_stock,
            p.min_price, p.wholesale_price, p.special_price, p.expiry_date, p.active,
            p.min_price_enabled, p.min_retail, p.min_wholesale, p.min_special,
            p.category_id, c.name AS category_name,
            (p.image_data IS NOT NULL) AS has_image,
            v.active_variants,
            -- Authoritative value at cost of this product, computed here so
            -- every screen (POS, inventory, dashboard scope totals) sums the
            -- same number the database does. Sized products use the sum of
            -- their variants' stock x cost; plain products use their own.
            ${stockValueExpr('p', 'v')} AS stock_value
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ${variantAggregate('p', 'v')}
       ${whereSql}
      ORDER BY p.name
      LIMIT 1000`,
    params
  );
  for (const r of rows) {
    r.active_variants = Number(r.active_variants);
    r.stock_value = Number(r.stock_value);
  }
  return okGzip({ products: await attachVariants(rows) }, req);
}

export async function POST(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');

  const name = str(body.name, { max: 120 });
  const barcode = body.barcode ? str(body.barcode, { max: 60 }) : null;
  const categoryId = body.categoryId ? Number(body.categoryId) : null;
  const price = toNumber(body.price);
  const cost = body.cost === undefined || body.cost === null || body.cost === '' ? 0 : toNumber(body.cost);
  const minStock = body.minStock === undefined || body.minStock === null || body.minStock === '' ? 0 : toNumber(body.minStock);
  const minPrice =
    body.minPrice === undefined || body.minPrice === null || body.minPrice === '' ? 0 : toNumber(body.minPrice);
  const wholesale = optPrice(body.wholesalePrice);
  const special = optPrice(body.specialPrice);
  // Product-level per-mode minimum selling price (protection OFF by default;
  // blank/null minimum = none for that mode).
  if (body.minPriceEnabled !== undefined && typeof body.minPriceEnabled !== 'boolean') {
    return fail('Minimum price protection must be ON or OFF.');
  }
  const minPriceEnabled = body.minPriceEnabled === true;
  const minRetail = optPrice(body.minRetail);
  const minWholesale = optPrice(body.minWholesale);
  const minSpecial = optPrice(body.minSpecial);
  const expiryDate = body.expiryDate ? validDate(body.expiryDate) : null;
  if (body.expiryDate && !expiryDate) return fail('Invalid expiry date.');

  if (!wholesale.absent && (wholesale.value === 'invalid' || wholesale.value < 0)) {
    return fail('Wholesale price must be a number of 0 or more.');
  }
  if (!special.absent && (special.value === 'invalid' || special.value < 0)) {
    return fail('Sale / Special price must be a number of 0 or more.');
  }
  if (!minRetail.absent && (minRetail.value === 'invalid' || minRetail.value < 0)) {
    return fail('Retail minimum must be a number of 0 or more.');
  }
  if (!minWholesale.absent && (minWholesale.value === 'invalid' || minWholesale.value < 0)) {
    return fail('Wholesale minimum must be a number of 0 or more.');
  }
  if (!minSpecial.absent && (minSpecial.value === 'invalid' || minSpecial.value < 0)) {
    return fail('Sale / Special minimum must be a number of 0 or more.');
  }
  if (!name) return fail('Product name is required.');
  if (price === null || price < 0 || price > MAX_MONEY) return fail('Selling price must be a number of 0 or more.');
  if (cost === null || cost < 0 || cost > MAX_MONEY) return fail('Cost price must be a number of 0 or more.');
  if (minStock === null || minStock < 0) return fail('Minimum stock must be 0 or more.');
  if (minPrice === null || minPrice < 0 || minPrice > MAX_MONEY) return fail('Minimum selling price must be a number of 0 or more.');
  if (minPrice > price) return fail('Minimum selling price cannot be higher than the selling price.');
  if (barcode) {
    const dupe = await query('SELECT id FROM products WHERE barcode = $1', [barcode]);
    if (dupe.length > 0) return fail('Another product already uses this barcode.', 409);
  }
  if (categoryId) {
    const cat = await query('SELECT id FROM categories WHERE id = $1', [categoryId]);
    if (!cat.length) return fail('Category not found.');
  }

  let imageData = null;
  let imageMime = null;
  if (body.imageData) {
    const parsed = parseImageData(body.imageData);
    if (parsed.error) return fail(parsed.error);
    imageData = parsed.buffer;
    imageMime = parsed.mime;
  }

  const variants = parseVariants(body.variants);
  if (variants.error) return fail(variants.error);
  const variantList = variants.value || [];

  // Barcodes must be unique across products AND variants.
  if (barcode) {
    const dupe = await query('SELECT id FROM product_variants WHERE barcode = $1', [barcode]);
    if (dupe.length > 0) return fail('That barcode is already used by a size.', 409);
  }
  // ONE query for every size's barcode (was one round trip per size, so a
  // product with 5 sizes cost 5 trips before the insert even started).
  {
    const codes = variantList.filter((v) => v.barcode).map((v) => v.barcode);
    if (codes.length) {
      const dupes = await query(
        `SELECT b.code
           FROM unnest($1::text[]) AS b(code)
          WHERE EXISTS (SELECT 1 FROM products WHERE barcode = b.code)
             OR EXISTS (SELECT 1 FROM product_variants WHERE barcode = b.code)`,
        [codes]
      );
      if (dupes.length) {
        const hit = new Set(dupes.map((d) => d.code));
        const first = variantList.find((v) => v.barcode && hit.has(v.barcode));
        return fail(`Size "${first.name}": that barcode is already in use.`, 409);
      }
    }
  }

  const bodyStock = body.stock === undefined || body.stock === null || body.stock === '' ? 0 : toNumber(body.stock);
  if (bodyStock === null || bodyStock < 0) return fail('Stock must be 0 or more.');
  if (variantList.length > 0) {
    // Backward compatibility: a product created with sizes but no per-size
    // stock treats the product-level stock as a shared pool, carried by the
    // first size (same rule as the data migration).
    const variantSum = round2(variantList.reduce((s, v) => s + Number(v.stock), 0));
    if (variantSum === 0 && Number(bodyStock) > 0) {
      variantList[0] = { ...variantList[0], stock: round2(Number(bodyStock)) };
    }
  }
  const initialStock =
    variantList.length > 0
      ? round2(variantList.reduce((s, v) => s + Number(v.stock), 0))
      : round2(Number(bodyStock));

  let id;
  try {
    id = await withTransaction(async (client) => {
      const res = await client.query(
        `INSERT INTO products (name, barcode, category_id, price, cost, stock, min_stock, min_price,
                               wholesale_price, special_price,
                               min_price_enabled, min_retail, min_wholesale, min_special,
                               expiry_date, image_data, image_mime, variants)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
        [
          name,
          barcode,
          categoryId,
          round2(price),
          round2(cost),
          round2(variantList.length > 0 ? 0 : initialStock),
          round2(minStock),
          round2(minPrice),
          wholesale.value === null ? null : round2(wholesale.value),
          special.value === null ? null : round2(special.value),
          minPriceEnabled,
          minRetail.value === null ? null : round2(minRetail.value),
          minWholesale.value === null ? null : round2(minWholesale.value),
          minSpecial.value === null ? null : round2(minSpecial.value),
          expiryDate,
          imageData,
          imageMime,
          // legacy JSONB mirror (kept for backwards compatibility)
          variantList.length > 0
            ? JSON.stringify(variantList.map((v) => ({ name: v.name, price: v.price })))
            : null,
        ]
      );
      const newId = res.rows[0].id;
      if (variantList.length > 0) {
        const sync = await syncVariants(client, newId, variantList);
        if (sync.error) throw new Error(sync.error);
      }
      if (initialStock > 0) {
        await client.query(
          `INSERT INTO stock_movements (product_id, change, reason, note, created_by)
           VALUES ($1, $2, 'adjustment', 'Initial stock', $3)`,
          [newId, initialStock, auth.user.id]
        );
      }
      return newId;
    });
  } catch (err) {
    return fail(err.message || 'Could not save the product.');
  }
  return ok({ id }, 201);
}
