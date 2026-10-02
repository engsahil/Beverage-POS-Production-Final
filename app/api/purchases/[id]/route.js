// GET /api/purchases/:id -> purchase detail with items + payments (admin)
// PUT /api/purchases/:id -> edit an existing purchase (admin)
// The edit reverses the old stock effect and applies the new one in ONE
// transaction, so the final stock effect is exactly the new lines — never
// old + new together. Payable balance (purchase total minus payments) and
// all derived reports update automatically because they are computed from
// purchases + purchase_payments.
import { query, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { readJson, str, toNumber, validDate, fail, ok, round2, HttpError } from '@/lib/validate';
import { purchaseStatus } from '../route.js';

export async function GET(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;
  const purchaseId = Number(id);
  if (!Number.isInteger(purchaseId)) return fail('Invalid purchase id.', 404);

  const settings = await getSettings();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: settings.timezone });

  const rows = await query(
    `SELECT pr.id, pr.vendor_id, pr.purchase_date, pr.due_date, pr.total, pr.notes, pr.created_at,
            (pr.attachment_data IS NOT NULL) AS has_attachment,
            pr.attachment_name,
            COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp WHERE pp.purchase_id = pr.id), 0) AS paid,
            v.name AS vendor_name, u.full_name AS created_by_name
       FROM purchases pr
       JOIN vendors v ON v.id = pr.vendor_id
       LEFT JOIN users u ON u.id = pr.created_by
      WHERE pr.id = $1`,
    [purchaseId]
  );
  const purchase = rows[0];
  if (!purchase) return fail('Purchase not found.', 404);

  const items = await query(
    `SELECT pi.qty, pi.cost, pi.batch_no, pi.expiry_date, pi.product_id, pi.variant_id,
            p.name AS product_name,
            COALESCE(vv.name, '') AS variant_name
       FROM purchase_items pi
       JOIN products p ON p.id = pi.product_id
       LEFT JOIN product_variants vv ON vv.id = pi.variant_id
      WHERE pi.purchase_id = $1
      ORDER BY pi.id`,
    [purchaseId]
  );

  const payments = await query(
    `SELECT pp.id, pp.amount, pp.method, pp.payment_date, pp.reference, pp.note,
            u.full_name AS created_by_name
       FROM purchase_payments pp
       LEFT JOIN users u ON u.id = pp.created_by
      WHERE pp.purchase_id = $1
      ORDER BY pp.id`,
    [purchaseId]
  );

  const paid = Number(purchase.paid);
  return ok({
    purchase: purchaseStatus(purchase, today),
    items: items.map((r) => ({ ...r, product_id: r.product_id, variant_id: r.variant_id, qty: Number(r.qty), cost: Number(r.cost) })),
    payments: payments.map((r) => ({ ...r, amount: Number(r.amount) })),
    remaining: round2(Number(purchase.total) - paid),
  });
}

export async function PUT(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;
  const purchaseId = Number(id);
  if (!Number.isInteger(purchaseId)) return fail('Invalid purchase id.', 404);

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
  if (!vendor.active) return fail('This vendor is disabled. Enable it before editing purchases.');

  try {
    const newTotal = round2(normalized.reduce((s, i) => s + i.qty * i.cost, 0));
    await withTransaction(async (client) => {
      const pr = await client.query('SELECT id, vendor_id, total FROM purchases WHERE id = $1 FOR UPDATE', [purchaseId]);
      const existing = pr.rows[0];
      if (!existing) throw new HttpError('Purchase not found.', 404);

      const paySum = await client.query('SELECT COALESCE(SUM(amount), 0) AS s FROM purchase_payments WHERE purchase_id = $1', [purchaseId]);
      const paid = Number(paySum.rows[0].s);
      if (newTotal < paid - 0.005) {
        throw new HttpError(`Cannot reduce total below already paid amount (${paid.toFixed(2)}). Remove a payment first or increase the total.`, 400);
      }

      const oldItems = (await client.query('SELECT product_id, variant_id, qty, cost FROM purchase_items WHERE purchase_id = $1 FOR UPDATE', [purchaseId])).rows;

      // Gather all product ids involved (old + new) to lock them.
      const oldIds = oldItems.map((r) => Number(r.product_id));
      const newIds = normalized.map((i) => i.productId);
      const allIds = [...new Set([...oldIds, ...newIds])];

      const prods = await client.query('SELECT id, name, stock FROM products WHERE id = ANY($1::int[]) FOR UPDATE', [allIds]);
      const prodById = new Map(prods.rows.map((r) => [Number(r.id), r]));
      for (const it of normalized) {
        if (!prodById.has(it.productId)) throw new HttpError('A selected product no longer exists.', 400);
      }

      const vRows = await client.query('SELECT * FROM product_variants WHERE product_id = ANY($1::int[]) FOR UPDATE', [allIds]);
      const variantById = new Map();
      const variantsByProduct = new Map();
      for (const v of vRows.rows) {
        variantById.set(Number(v.id), v);
        if (!variantsByProduct.has(Number(v.product_id))) variantsByProduct.set(Number(v.product_id), []);
        variantsByProduct.get(Number(v.product_id)).push(v);
      }

      // Validate variant rules for new lines (same as creation).
      for (const it of normalized) {
        const vs = variantsByProduct.get(it.productId) || [];
        if (vs.length > 0) {
          const v = it.variantId ? variantById.get(it.variantId) : null;
          if (!v || Number(v.product_id) !== it.productId) {
            const prodName = prodById.get(it.productId)?.name || `#${it.productId}`;
            throw new HttpError(`Select a size for \"${prodName}\".`, 400);
          }
        } else if (it.variantId) {
          const prodName = prodById.get(it.productId)?.name || `#${it.productId}`;
          throw new HttpError(`${prodName} has no sizes.`, 400);
        }
      }

      // Stock validation: new stock must stay >= 0.
      // Current stock already includes oldItems effect, so: newStock = current - oldQty + newQty
      const oldQtyByProduct = {};
      const oldQtyByVariant = {};
      for (const r of oldItems) {
        const pid = Number(r.product_id);
        oldQtyByProduct[pid] = round2((oldQtyByProduct[pid] || 0) + Number(r.qty));
        if (r.variant_id) {
          const vid = Number(r.variant_id);
          oldQtyByVariant[vid] = round2((oldQtyByVariant[vid] || 0) + Number(r.qty));
        }
      }
      const newQtyByProduct = {};
      const newQtyByVariant = {};
      for (const it of normalized) {
        newQtyByProduct[it.productId] = round2((newQtyByProduct[it.productId] || 0) + it.qty);
        if (it.variantId) {
          newQtyByVariant[it.variantId] = round2((newQtyByVariant[it.variantId] || 0) + it.qty);
        }
      }

      for (const pid of allIds) {
        const current = Number(prodById.get(pid)?.stock ?? 0);
        const oldQ = oldQtyByProduct[pid] || 0;
        const newQ = newQtyByProduct[pid] || 0;
        const future = round2(current - oldQ + newQ);
        if (future < -0.005) {
          const prodName = prodById.get(pid)?.name || `#${pid}`;
          throw new HttpError(`Insufficient stock for \"${prodName}\": editing would make stock negative (${future.toFixed(2)}).`, 400);
        }
      }
      for (const vid of new Set([...Object.keys(oldQtyByVariant), ...Object.keys(newQtyByVariant)].map(Number))) {
        const v = variantById.get(vid);
        if (!v) continue;
        const current = Number(v.stock ?? 0);
        const oldQ = oldQtyByVariant[vid] || 0;
        const newQ = newQtyByVariant[vid] || 0;
        const future = round2(current - oldQ + newQ);
        if (future < -0.005) {
          throw new HttpError(`Insufficient stock for size \"${v.name}\": editing would make stock negative (${future.toFixed(2)}).`, 400);
        }
      }

      // Perform the edit atomically.
      // 1) Remove old lines and movements.
      await client.query('DELETE FROM purchase_items WHERE purchase_id = $1', [purchaseId]);
      await client.query('DELETE FROM stock_movements WHERE reason = \'purchase\' AND ref_id = $1', [purchaseId]);

      // 2) Adjust product stock by delta.
      for (const pid of allIds) {
        const delta = round2((newQtyByProduct[pid] || 0) - (oldQtyByProduct[pid] || 0));
        if (Math.abs(delta) > 0.0001) {
          await client.query('UPDATE products SET stock = stock + $1, updated_at = now() WHERE id = $2', [delta, pid]);
        }
      }
      // 3) Adjust variant stock and cost.
      const variantCostByNew = new Map();
      const variantMetaByNew = new Map();
      for (const it of normalized) {
        if (it.variantId) {
          // Last line for this variant wins (cost/expiry/batch)
          variantCostByNew.set(it.variantId, it.cost);
          variantMetaByNew.set(it.variantId, { expiryDate: it.expiryDate, batchNo: it.batchNo });
        }
      }
      for (const vid of new Set([...Object.keys(oldQtyByVariant), ...Object.keys(newQtyByVariant)].map(Number))) {
        const delta = round2((newQtyByVariant[vid] || 0) - (oldQtyByVariant[vid] || 0));
        const newCost = variantCostByNew.get(vid);
        const meta = variantMetaByNew.get(vid);
        if (newCost !== undefined) {
          await client.query(
            `UPDATE product_variants
                SET stock = stock + $1, cost = $2,
                    expiry_date = COALESCE($3, expiry_date),
                    batch_no = CASE WHEN $4::text = '' THEN batch_no ELSE $4::text END,
                    updated_at = now()
              WHERE id = $5`,
            [delta, newCost, meta?.expiryDate || null, meta?.batchNo || '', vid]
          );
        } else if (Math.abs(delta) > 0.0001) {
          await client.query('UPDATE product_variants SET stock = stock + $1, updated_at = now() WHERE id = $2', [delta, vid]);
        }
      }

      // 4) Insert new purchase items.
      for (const it of normalized) {
        const v = it.variantId ? variantById.get(it.variantId) : null;
        await client.query(
          `INSERT INTO purchase_items (purchase_id, product_id, variant_id, qty, cost, expiry_date, batch_no)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [purchaseId, it.productId, v ? v.id : null, it.qty, it.cost, it.expiryDate, it.batchNo]
        );
      }

      // 5) Insert stock movements (one per distinct product, with size note).
      const distinctPids = [...new Set(normalized.map((i) => i.productId))];
      for (const pid of distinctPids) {
        const qt = newQtyByProduct[pid];
        const sold = normalized.filter((l) => l.productId === pid);
        const sizeNote = sold.filter((l) => l.variantId).map((l) => {
          const v = variantById.get(l.variantId);
          return `${l.qty} x ${v?.name || l.variantId}`;
        }).join(', ');
        const variantIds = [...new Set(sold.map((l) => l.variantId).filter(Boolean))];
        const singleVariant = variantIds.length === 1 ? variantIds[0] : null;
        await client.query(
          `INSERT INTO stock_movements (product_id, variant_id, change, reason, ref_id, note, created_by)
           VALUES ($1, $2, $3, 'purchase', $4, $5, $6)`,
          [pid, singleVariant, qt, purchaseId, sizeNote ? `Batch ${sizeNote}` : '', auth.user.id]
        );
      }

      // 6) Update the purchase header.
      const dueDate = new Date(new Date(date + 'T00:00:00Z').getTime() + 30 * 86400000).toISOString().slice(0, 10);
      await client.query(
        `UPDATE purchases SET vendor_id = $1, purchase_date = $2, due_date = $3, total = $4, notes = $5 WHERE id = $6`,
        [vendorId, date, dueDate, newTotal, notes, purchaseId]
      );
    });
    const settings = await getSettings();
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: settings.timezone });
    const rows = await query(
      `SELECT pr.id, pr.vendor_id, pr.purchase_date, pr.due_date, pr.total, pr.notes, pr.created_at,
              (pr.attachment_data IS NOT NULL) AS has_attachment, pr.attachment_name,
              COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp WHERE pp.purchase_id = pr.id), 0) AS paid,
              v.name AS vendor_name, u.full_name AS created_by_name
         FROM purchases pr JOIN vendors v ON v.id = pr.vendor_id LEFT JOIN users u ON u.id = pr.created_by WHERE pr.id = $1`,
      [purchaseId]
    );
    const purchase = rows[0];
    if (!purchase) return fail('Purchase not found.', 404);
    const items2 = await query(
      `SELECT pi.qty, pi.cost, pi.batch_no, pi.expiry_date, pi.product_id, pi.variant_id,
              p.name AS product_name, COALESCE(vv.name, '') AS variant_name
         FROM purchase_items pi JOIN products p ON p.id = pi.product_id LEFT JOIN product_variants vv ON vv.id = pi.variant_id
        WHERE pi.purchase_id = $1 ORDER BY pi.id`, [purchaseId]
    );
    const payments = await query(
      `SELECT pp.id, pp.amount, pp.method, pp.payment_date, pp.reference, pp.note, u.full_name AS created_by_name
         FROM purchase_payments pp LEFT JOIN users u ON u.id = pp.created_by WHERE pp.purchase_id = $1 ORDER BY pp.id`, [purchaseId]
    );
    const paid = Number(purchase.paid);
    return ok({
      purchase: purchaseStatus(purchase, today),
      items: items2.map((r) => ({ ...r, qty: Number(r.qty), cost: Number(r.cost) })),
      payments: payments.map((r) => ({ ...r, amount: Number(r.amount) })),
      remaining: round2(Number(purchase.total) - paid),
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    console.error('[purchases] edit failed:', err);
    return fail('Unable to update purchase. Please try again.', 500);
  }
}
