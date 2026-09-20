// Variant (size) validation shared by the product create/update routes.
//
// Full-variant model (Phase 5): each variant is a row in product_variants
// and independently owns price, cost, wholesale/retail reference prices,
// tax, discount, stock, min/reorder, expiry, batch, supplier, image, status.
//
// Wire format: one object per variant. On UPDATE the list is reconciled by
// id (when given) or case-insensitive name, and each field uses PATCH
// semantics: a field present in the payload is written (even 0, '' or
// null); a field ABSENT keeps the row's existing value — so a client that
// only wants to change a price can never silently reset a size's stock.
// Legacy { name, price } entries are accepted (everything else kept/0).
// The server is authoritative: whatever passes here is what the POS and
// sale endpoint will accept.
import { toNumber, round2, validDate } from '@/lib/validate';
import { parseImageData } from './image-data';

export const MAX_VARIANTS = 10;
const MAX_NAME = 40;

function numField(input, { min = 0, max = Infinity } = {}) {
  // undefined/'' = "keep existing" (PATCH semantics); explicit value must be valid.
  if (input === undefined || input === null || input === '') return undefined;
  const n = toNumber(input);
  if (n === null || n < min || n > max) return null; // null = invalid
  return n;
}

function optTextField(input, max) {
  if (input === undefined || input === null) return undefined;
  const s = String(input).trim();
  if (s.length > max) return null; // null = invalid
  return s;
}

/**
 * Normalize + validate one variant entry.
 * Numeric/text fields === undefined mean "keep existing" on update.
 * @returns {{ error: string | null, value: object | null }}
 */
function parseVariantEntry(v, { allowId }) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'Invalid size entry.', value: null };
  const nameRaw = typeof v.name === 'string' ? v.name.trim() : '';
  if (!nameRaw || nameRaw.length > MAX_NAME) return { error: 'Every size needs a name (e.g. "50 ml" or "Small").', value: null };

  const price = toNumber(v.price);
  if (v.price === undefined || v.price === null || v.price === '') return { error: `Size "${nameRaw}" needs a price of 0 or more.`, value: null };
  if (price === null || price < 0) return { error: `Size "${nameRaw}" needs a price of 0 or more.`, value: null };

  const wholesale = numField(v.wholesalePrice, { max: 999999 });
  if (wholesale === null) return { error: `Size "${nameRaw}": wholesale price must be 0 or more.`, value: null };
  const special = numField(v.specialPrice, { max: 999999 });
  if (special === null) return { error: `Size "${nameRaw}": sale/special price must be 0 or more.`, value: null };
  const retail = numField(v.retailPrice, { max: 999999 });
  if (retail === null) return { error: `Size "${nameRaw}": retail price must be 0 or more.`, value: null };
  const cost = numField(v.cost, { max: 999999 });
  if (cost === null) return { error: `Size "${nameRaw}": cost price must be 0 or more.`, value: null };
  const taxRate = numField(v.taxRate, { max: 100 });
  if (taxRate === null) return { error: `Size "${nameRaw}": tax rate must be between 0 and 100%.`, value: null };
  const discountPct = numField(v.discountPct, { max: 100 });
  if (discountPct === null) return { error: `Size "${nameRaw}": discount must be between 0 and 100%.`, value: null };
  const stock = numField(v.stock);
  if (stock === null) return { error: `Size "${nameRaw}": stock must be 0 or more.`, value: null };
  const minStock = numField(v.minStock);
  if (minStock === null) return { error: `Size "${nameRaw}": minimum stock must be 0 or more.`, value: null };
  const reorderLevel = numField(v.reorderLevel);
  if (reorderLevel === null) return { error: `Size "${nameRaw}": reorder level must be 0 or more.`, value: null };

  // Per-mode minimum selling price (protection OFF by default).
  // undefined = keep existing; null/'' = clear (no minimum); number = set.
  let minPriceEnabled = undefined;
  if (v.minPriceEnabled !== undefined) {
    if (typeof v.minPriceEnabled !== 'boolean') {
      return { error: `Size "${nameRaw}": minimum price protection must be ON or OFF.`, value: null };
    }
    minPriceEnabled = v.minPriceEnabled;
  }
  // Per-mode minimum: undefined = keep existing; null = clear (no minimum);
  // number = set. Anything else is invalid.
  const parseMin = (field) => {
    if (v[field] === undefined) return { invalid: false, value: undefined };
    if (v[field] === null || v[field] === '') return { invalid: false, value: null };
    const n = toNumber(v[field]);
    if (n === null || n < 0 || n > 999999) return { invalid: true, value: null };
    return { invalid: false, value: n };
  };
  const minRetailP = parseMin('minRetail', 'retail');
  if (minRetailP.invalid) return { error: `Size "${nameRaw}": retail minimum must be 0 or more.`, value: null };
  const minWholesaleP = parseMin('minWholesale', 'wholesale');
  if (minWholesaleP.invalid) return { error: `Size "${nameRaw}": wholesale minimum must be 0 or more.`, value: null };
  const minSpecialP = parseMin('minSpecial', 'special');
  if (minSpecialP.invalid) return { error: `Size "${nameRaw}": sale/special minimum must be 0 or more.`, value: null };

  const expiryDate = v.expiryDate ? validDate(v.expiryDate) : undefined;
  if (v.expiryDate && !expiryDate) return { error: `Size "${nameRaw}": invalid expiry date.`, value: null };

  const unit = optTextField(v.unit, 20);
  if (unit === null) return { error: `Size "${nameRaw}": unit is too long.`, value: null };
  const sku = optTextField(v.sku, 60);
  if (sku === null) return { error: `Size "${nameRaw}": SKU is too long.`, value: null };
  const barcode = optTextField(v.barcode, 60);
  if (barcode === null) return { error: `Size "${nameRaw}": barcode is too long.`, value: null };
  const batchNo = optTextField(v.batchNo, 40);
  if (batchNo === null) return { error: `Size "${nameRaw}": batch number is too long.`, value: null };

  let supplierId = undefined;
  if (v.supplierId !== undefined && v.supplierId !== null && v.supplierId !== '') {
    supplierId = Number(v.supplierId);
    if (!Number.isInteger(supplierId) || supplierId < 1) return { error: `Size "${nameRaw}": invalid supplier.`, value: null };
  }

  let imageData = null;
  let imageMime = null;
  if (v.imageData) {
    const parsed = parseImageData(v.imageData);
    if (parsed.error) return { error: `Size "${nameRaw}": ${parsed.error}`, value: null };
    imageData = parsed.buffer;
    imageMime = parsed.mime;
  }

  let id = null;
  if (allowId && v.id !== undefined && v.id !== null && v.id !== '') {
    id = Number(v.id);
    if (!Number.isInteger(id) || id < 1) return { error: `Size "${nameRaw}": invalid variant id.`, value: null };
  }

  const value = {
    id,
    name: nameRaw,
    price: round2(price),
    // undefined = keep existing row value on update
    unit,
    sku,
    barcode,
    wholesale_price: wholesale === undefined ? undefined : round2(wholesale),
    retail_price: retail === undefined ? undefined : round2(retail),
    special_price: special === undefined ? undefined : round2(special),
    cost: cost === undefined ? undefined : round2(cost),
    tax_rate: taxRate === undefined ? undefined : round2(taxRate),
    discount_pct: discountPct === undefined ? undefined : round2(discountPct),
    stock: stock === undefined ? undefined : round2(stock),
    min_stock: minStock === undefined ? undefined : round2(minStock),
    reorder_level: reorderLevel === undefined ? undefined : round2(reorderLevel),
    min_price_enabled: minPriceEnabled, // undefined = keep; true/false = set
    min_retail: minRetailP.value === undefined ? undefined : (minRetailP.value === null ? null : round2(minRetailP.value)),
    min_wholesale: minWholesaleP.value === undefined ? undefined : (minWholesaleP.value === null ? null : round2(minWholesaleP.value)),
    min_special: minSpecialP.value === undefined ? undefined : (minSpecialP.value === null ? null : round2(minSpecialP.value)),
    expiry_date: expiryDate, // undefined = keep
    batch_no: batchNo,
    supplier_id: supplierId,
    image_data: imageData,
    image_mime: imageMime,
    clearImage: v.clearImage === true,
    active: typeof v.active === 'boolean' ? v.active : undefined,
    sort_order: Number.isInteger(v.sortOrder) ? v.sortOrder : undefined,
  };
  // an explicit empty value means "clear the field" (absent = keep)
  if (v.expiryDate === '' || v.expiryDate === null) value.expiry_date = null;
  // batch_no is NOT NULL DEFAULT '' — clearing means empty string, never NULL
  // (a NULL here violates the constraint and breaks every size edit).
  if (v.batchNo === '' || v.batchNo === null) value.batch_no = '';
  return { error: null, value };
}

/**
 * Parse body.variants.
 * @returns {{ error: string | null, value: Array | null | undefined }}
 *   undefined = field not present (caller keeps existing rows)
 *   null      = remove all variants of the product
 *   [...]     = desired list (reconciled by id / name on update)
 */
export function parseVariants(input, { allowId = false } = {}) {
  if (input === undefined) return { error: null, value: undefined };
  if (input === null) return { error: null, value: null };
  if (!Array.isArray(input)) return { error: 'Sizes must be a list of name/price pairs.', value: undefined };
  if (input.length > MAX_VARIANTS) return { error: `A product can have at most ${MAX_VARIANTS} sizes.`, value: undefined };

  const out = [];
  const seen = new Set();
  const seenIds = new Set();
  for (const v of input) {
    const r = parseVariantEntry(v, { allowId });
    if (r.error) return { error: r.error, value: undefined };
    const key = r.value.name.toLowerCase();
    if (seen.has(key)) return { error: `Duplicate size name: "${r.value.name}".`, value: undefined };
    seen.add(key);
    if (r.value.id !== null) {
      if (seenIds.has(r.value.id)) return { error: `Size "${r.value.name}": same variant listed twice.`, value: undefined };
      seenIds.add(r.value.id);
    }
    out.push(r.value);
  }
  return { error: null, value: out.length > 0 ? out : null };
}

/**
 * Apply a desired variant list to a product inside a transaction.
 * Reconciles by id (when given) or case-insensitive name:
 *   - id present & row exists for this product  -> UPDATE (PATCH fields)
 *   - no id & name matches an existing row (CI) -> UPDATE (PATCH fields)
 *   - otherwise                                  -> INSERT (absent = 0/''/defaults)
 * The product summary stock is kept equal to the sum of variant stock.
 * @param {import('pg').PoolClient} client
 * @param {number} productId
 */
export async function syncVariants(client, productId, desired) {
  const existingRes = await client.query('SELECT * FROM product_variants WHERE product_id = $1', [productId]);
  const byId = new Map(existingRes.rows.map((r) => [Number(r.id), r]));
  const byName = new Map(existingRes.rows.map((r) => [r.name.toLowerCase(), r]));

  // When a product goes from "plain" to "has sizes" for the first time, its
  // existing stock pool is carried by the first size (same rule as the data
  // migration) so stock is never silently reset to zero.
  const hadRows = existingRes.rows.length > 0;
  if (!hadRows) {
    const pRes = await client.query('SELECT stock FROM products WHERE id = $1', [productId]);
    const pStock = Number(pRes.rows[0]?.stock || 0);
    const desiredSum = desired.reduce((s, v) => s + Number(v.stock ?? 0), 0);
    if (pStock > 0 && desiredSum === 0 && desired.length > 0) {
      desired[0] = { ...desired[0], stock: pStock };
    }
  }

  for (const v of desired) {
    let target = v.id !== null ? byId.get(v.id) : undefined;
    if (target && Number(target.product_id) !== productId) {
      return { error: `Size "${v.name}": unknown or invalid variant.` };
    }
    if (!target) target = byName.get(v.name.toLowerCase());

    if (target) {
      // PATCH semantics: only write the fields the client sent.
      const sets = [`name = $1`, `price = $2`, `updated_at = now()`];
      const params = [v.name, v.price];
      const add = (col, val, sqlval = true) => {
        if (val === undefined) return;
        params.push(sqlval ? val : null);
        sets.push(`${col} = $${params.length}`);
      };
      add('unit', v.unit);
      add('sku', v.sku);
      add('barcode', v.barcode);
      add('wholesale_price', v.wholesale_price);
      add('retail_price', v.retail_price);
      add('special_price', v.special_price);
      add('cost', v.cost);
      add('tax_rate', v.tax_rate);
      add('discount_pct', v.discount_pct);
      add('stock', v.stock);
      add('min_stock', v.min_stock);
      add('reorder_level', v.reorder_level);
      add('min_price_enabled', v.min_price_enabled);
      add('min_retail', v.min_retail);
      add('min_wholesale', v.min_wholesale);
      add('min_special', v.min_special);
      add('expiry_date', v.expiry_date);
      add('batch_no', v.batch_no);
      add('supplier_id', v.supplier_id);
      add('active', v.active);
      add('sort_order', v.sort_order);
      const keepImage = v.image_data === null && !v.clearImage;
      if (!keepImage) {
        params.push(v.image_data, v.image_mime);
        sets.push(`image_data = $${params.length - 1}`, `image_mime = $${params.length}`);
      }
      params.push(Number(target.id));
      await client.query(
        `UPDATE product_variants SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params
      );
    } else {
      const ins = await client.query(
        `INSERT INTO product_variants
           (product_id, name, unit, sku, barcode, price, wholesale_price, retail_price, special_price, cost,
            tax_rate, discount_pct, stock, min_stock, reorder_level, expiry_date, batch_no,
            supplier_id, image_data, image_mime, active, sort_order,
            min_price_enabled, min_retail, min_wholesale, min_special)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
         RETURNING id`,
        [
          productId,
          v.name,
          v.unit ?? '',
          v.sku ?? '',
          v.barcode ?? '',
          v.price,
          v.wholesale_price ?? 0,
          v.retail_price ?? 0,
          v.special_price ?? null,
          v.cost ?? 0,
          v.tax_rate ?? 0,
          v.discount_pct ?? 0,
          v.stock ?? 0,
          v.min_stock ?? 0,
          v.reorder_level ?? 0,
          v.expiry_date ?? null,
          v.batch_no ?? '',
          v.supplier_id ?? null,
          v.image_data ?? null,
          v.image_mime ?? null,
          v.active ?? true,
          v.sort_order ?? 0,
          v.min_price_enabled ?? false,
          v.min_retail ?? null,
          v.min_wholesale ?? null,
          v.min_special ?? null,
        ]
      );
    }
  }

  // Keep the product-level summary stock equal to the sum of variant stock.
  await client.query(
    `UPDATE products SET stock = (SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = $1), updated_at = now()
      WHERE id = $1`,
    [productId]
  );
  return { error: null };
}
