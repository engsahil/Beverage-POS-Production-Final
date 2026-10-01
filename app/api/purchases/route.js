// GET  /api/purchases -> list (admin, optional ?from & ?to & ?vendorId)
// POST /api/purchases -> record a purchase (admin)
// A completed purchase increases stock inside a database transaction.
import { query, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { readJson, str, toNumber, validDate, fail, ok, okGzip, round2, HttpError } from '@/lib/validate';

// Shared payment summary + status for a purchase row.
// Status: paid | partially_paid | unpaid | overdue (overdue = money still
// owed and the due date has passed).
const isoDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

export function purchaseStatus(pr, today) {
  const total = Number(pr.total);
  const paid = Number(pr.paid ?? 0);
  const outstanding = round2(total - paid);
  let status;
  if (outstanding <= 0.005) status = 'paid';
  else if (pr.due_date && isoDate(pr.due_date) < today) status = 'overdue';
  else if (paid > 0) status = 'partially_paid';
  else status = 'unpaid';
  return { ...pr, paid, outstanding, status };
}

export async function GET(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const sp = req.nextUrl.searchParams;
  const from = validDate(sp.get('from'));
  const to = validDate(sp.get('to'));
  const vendorId = sp.get('vendorId');

  const settings = await getSettings();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: settings.timezone });

  const where = [];
  const params = [];
  if (from) {
    params.push(from);
    where.push(`pr.purchase_date >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`pr.purchase_date <= $${params.length}`);
  }
  if (vendorId) {
    params.push(Number(vendorId));
    where.push(`pr.vendor_id = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT pr.id, pr.purchase_date, pr.due_date, pr.total, pr.notes, pr.created_at,
            (pr.attachment_data IS NOT NULL) AS has_attachment,
            COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp WHERE pp.purchase_id = pr.id), 0) AS paid,
            v.name AS vendor_name,
            u.full_name AS created_by_name,
            (SELECT COUNT(*)::int FROM purchase_items pi WHERE pi.purchase_id = pr.id) AS item_count
       FROM purchases pr
       JOIN vendors v ON v.id = pr.vendor_id
       LEFT JOIN users u ON u.id = pr.created_by
       ${whereSql}
      ORDER BY pr.id DESC
      LIMIT 200`,
    params
  );
  return okGzip({ purchases: rows.map((r) => purchaseStatus(r, today)) }, req);
}

export async function POST(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');

  const vendorId = Number(body.vendorId);
  const date = validDate(body.date);
  const notes = str(body.notes, { max: 300 }) ?? '';
  const items = Array.isArray(body.items) ? body.items : [];

  if (!Number.isInteger(vendorId)) return fail('Select a vendor.');
  if (!date) return fail('Select a valid purchase date.');
  if (items.length === 0) return fail('Add at least one product line.');
  if (items.length > 100) return fail('Too many line items.');

  const normalized = [];
  for (const it of items) {
    const productId = Number(it.productId);
    const qty = toNumber(it.qty);
    const cost = toNumber(it.cost);
    if (!Number.isInteger(productId) || qty === null || qty <= 0 || cost === null || cost < 0) {
      return fail('Each line needs a product, a quantity above zero and a cost of 0 or more.');
    }
    const variantId = it.variantId ? Number(it.variantId) : null;
    if (it.variantId && (!Number.isInteger(variantId) || variantId < 1)) {
      return fail('One line has an invalid size.');
    }
    const expiryDate = it.expiryDate ? validDate(it.expiryDate) : null;
    if (it.expiryDate && !expiryDate) return fail('One line has an invalid expiry date.');
    const batchNo = it.batchNo ? str(it.batchNo, { max: 40 }) : '';
    if (it.batchNo && !batchNo) return fail('Batch number is too long.');
    normalized.push({ productId, qty: round2(qty), cost: round2(cost), variantId, expiryDate, batchNo });
  }

  const vendorRows = await query('SELECT id, active FROM vendors WHERE id = $1', [vendorId]);
  const vendor = vendorRows[0];
  if (!vendor) return fail('Vendor not found.', 404);
  if (!vendor.active) return fail('This vendor is disabled. Enable it before recording purchases.');

  try {
    const purchaseId = await withTransaction(async (client) => {
      const productIds = [...new Set(normalized.map((i) => i.productId))];
      const prods = await client.query('SELECT id, name FROM products WHERE id = ANY($1::int[])', [
        productIds,
      ]);
      const known = new Set(prods.rows.map((r) => r.id));
      for (const it of normalized) {
        if (!known.has(it.productId)) throw new HttpError('A selected product no longer exists.', 400);
      }

      // Per-variant receiving: a product that has sizes must receive stock
      // into one of them; a plain product cannot.
      const vRows = await client.query(
        'SELECT * FROM product_variants WHERE product_id = ANY($1::int[]) FOR UPDATE',
        [productIds]
      );
      const variantsByProduct = new Map();
      const variantById = new Map();
      for (const v of vRows.rows) {
        if (!variantsByProduct.has(v.product_id)) variantsByProduct.set(v.product_id, []);
        variantsByProduct.get(v.product_id).push(v);
        variantById.set(v.id, v);
      }
      for (const it of normalized) {
        const vs = variantsByProduct.get(it.productId) || [];
        if (vs.length > 0) {
          const v = it.variantId ? variantById.get(it.variantId) : null;
          if (!v || Number(v.product_id) !== it.productId) {
            throw new HttpError(`Select a size for "${prods.rows.find((r) => r.id === it.productId)?.name}".`, 400);
          }
        } else if (it.variantId) {
          throw new HttpError(`${prods.rows.find((r) => r.id === it.productId)?.name} has no sizes.`, 400);
        }
      }

      const total = round2(normalized.reduce((s, i) => s + i.qty * i.cost, 0));
      // Due date = purchase date + 30 days (standard terms for this app).
      const dueDate = new Date(new Date(date + 'T00:00:00Z').getTime() + 30 * 86400000)
        .toISOString()
        .slice(0, 10);
      const ins = await client.query(
        `INSERT INTO purchases (vendor_id, purchase_date, due_date, total, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [vendorId, date, dueDate, total, notes, auth.user.id]
      );
      const id = ins.rows[0].id;

      for (const it of normalized) {
        const v = it.variantId ? variantById.get(it.variantId) : null;
        await client.query(
          `INSERT INTO purchase_items (purchase_id, product_id, variant_id, qty, cost, expiry_date, batch_no)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, it.productId, v ? v.id : null, it.qty, it.cost, it.expiryDate, it.batchNo]
        );
        await client.query('UPDATE products SET stock = stock + $1, updated_at = now() WHERE id = $2', [
          it.qty,
          it.productId,
        ]);
        if (v) {
          await client.query(
            `UPDATE product_variants
                SET stock = stock + $1, cost = $2,
                    expiry_date = COALESCE($3, expiry_date),
                    batch_no = CASE WHEN $4::text = '' THEN batch_no ELSE $4::text END,
                    updated_at = now()
              WHERE id = $5`,
            [it.qty, it.cost, it.expiryDate, it.batchNo, v.id]
          );
        }
        await client.query(
          `INSERT INTO stock_movements (product_id, variant_id, change, reason, ref_id, note, created_by)
           VALUES ($1, $2, $3, 'purchase', $4, $5, $6)`,
          [
            it.productId,
            v ? v.id : null,
            it.qty,
            id,
            it.batchNo ? `Batch ${it.batchNo}` : '',
            auth.user.id,
          ]
        );
      }
      return id;
    });
    return ok({ id: purchaseId }, 201);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    console.error('[purchases] create failed:', err);
    return fail('Unable to save purchase. Please try again.', 500);
  }
}
