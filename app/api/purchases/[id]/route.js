// GET    /api/purchases/:id -> purchase detail with items + payments (admin)
// PUT    /api/purchases/:id -> edit an existing purchase with full stock & balance reconciliation (admin)
// DELETE /api/purchases/:id -> delete/remove a purchase and reverse its stock & financial impact (admin)
import { query, withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { readJson, str, toNumber, validDate, fail, ok, round2, HttpError } from '@/lib/validate';
import { purchaseStatus } from '../route.js';

const MAX_MONEY = 999_999_999.99;

async function fetchPurchaseDetail(purchaseId, today) {
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
  if (!purchase) return null;

  const [items, payments] = await Promise.all([
    query(
      `SELECT pi.id, pi.product_id, pi.variant_id, pi.qty, pi.cost, pi.batch_no, pi.expiry_date,
              p.name AS product_name,
              COALESCE(vv.name, '') AS variant_name
         FROM purchase_items pi
         JOIN products p ON p.id = pi.product_id
         LEFT JOIN product_variants vv ON vv.id = pi.variant_id
        WHERE pi.purchase_id = $1
        ORDER BY pi.id`,
      [purchaseId]
    ),
    query(
      `SELECT pp.id, pp.amount, pp.method, pp.payment_date, pp.reference, pp.note,
              u.full_name AS created_by_name
         FROM purchase_payments pp
         LEFT JOIN users u ON u.id = pp.created_by
        WHERE pp.purchase_id = $1
        ORDER BY pp.id`,
      [purchaseId]
    ),
  ]);

  const paid = Number(purchase.paid);
  return {
    purchase: purchaseStatus(purchase, today),
    items: items.map((r) => ({
      ...r,
      product_id: Number(r.product_id),
      variant_id: r.variant_id ? Number(r.variant_id) : null,
      qty: Number(r.qty),
      cost: Number(r.cost),
    })),
    payments: payments.map((r) => ({ ...r, amount: Number(r.amount) })),
    remaining: round2(Number(purchase.total) - paid),
  };
}

export async function GET(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;
  const purchaseId = Number(id);
  if (!Number.isInteger(purchaseId)) return fail('Invalid purchase id.', 404);

  const settings = await getSettings();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: settings.timezone });

  const detail = await fetchPurchaseDetail(purchaseId, today);
  if (!detail) return fail('Purchase not found.', 404);
  return ok(detail);
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
    const productId = Number(it.productId ?? it.product_id);
    const qty = toNumber(it.qty);
    const cost = toNumber(it.cost);
    if (!Number.isInteger(productId) || qty === null || qty <= 0 || cost === null || cost < 0) {
      return fail('Each line needs a product, a quantity above zero and a cost of 0 or more.');
    }
    const rawVar = it.variantId ?? it.variant_id;
    const variantId = rawVar ? Number(rawVar) : null;
    if (rawVar && (!Number.isInteger(variantId) || variantId < 1)) {
      return fail('One line has an invalid size.');
    }
    const rawExp = it.expiryDate ?? it.expiry_date;
    const expiryDate = rawExp ? validDate(rawExp) : null;
    if (rawExp && !expiryDate) return fail('One line has an invalid expiry date.');
    const rawBatch = it.batchNo ?? it.batch_no;
    const batchNo = rawBatch ? str(rawBatch, { max: 40 }) : '';
    if (rawBatch && !batchNo) return fail('Batch number is too long.');
    normalized.push({
      productId,
      qty: round2(qty),
      cost: round2(cost),
      variantId,
      expiryDate,
      batchNo,
    });
  }

  const newTotal = round2(normalized.reduce((s, i) => s + i.qty * i.cost, 0));
  if (newTotal > MAX_MONEY) {
    return fail('Purchase total exceeds the maximum allowed amount.');
  }

  const vendorRows = await query('SELECT id, active FROM vendors WHERE id = $1', [vendorId]);
  const vendor = vendorRows[0];
  if (!vendor) return fail('Vendor not found.', 404);
  if (!vendor.active) return fail('This vendor is disabled. Enable it before editing purchases.');

  try {
    await withTransaction(async (client) => {
      const pr = await client.query(
        'SELECT id, vendor_id, total FROM purchases WHERE id = $1 FOR UPDATE',
        [purchaseId]
      );
      const existing = pr.rows[0];
      if (!existing) throw new HttpError('Purchase not found.', 404);

      const paySum = await client.query(
        'SELECT COALESCE(SUM(amount), 0) AS s FROM purchase_payments WHERE purchase_id = $1',
        [purchaseId]
      );
      const paid = Number(paySum.rows[0].s);
      if (newTotal < paid - 0.005) {
        throw new HttpError(
          `Cannot reduce purchase total (${newTotal.toFixed(2)}) below already paid amount (${paid.toFixed(2)}). Remove or adjust a payment first.`,
          400
        );
      }

      const oldItems = (
        await client.query(
          'SELECT product_id, variant_id, qty, cost FROM purchase_items WHERE purchase_id = $1 FOR UPDATE',
          [purchaseId]
        )
      ).rows;

      const oldIds = oldItems.map((r) => Number(r.product_id));
      const newIds = normalized.map((i) => i.productId);
      const allIds = [...new Set([...oldIds, ...newIds])];

      const prods = await client.query(
        'SELECT id, name, stock FROM products WHERE id = ANY($1::int[]) FOR UPDATE',
        [allIds]
      );
      const prodById = new Map(prods.rows.map((r) => [Number(r.id), r]));
      for (const it of normalized) {
        if (!prodById.has(it.productId)) {
          throw new HttpError('A selected product no longer exists.', 400);
        }
      }

      const vRows = await client.query(
        'SELECT * FROM product_variants WHERE product_id = ANY($1::int[]) FOR UPDATE',
        [allIds]
      );
      const variantById = new Map();
      const variantsByProduct = new Map();
      for (const v of vRows.rows) {
        variantById.set(Number(v.id), v);
        const pid = Number(v.product_id);
        if (!variantsByProduct.has(pid)) variantsByProduct.set(pid, []);
        variantsByProduct.get(pid).push(v);
      }

      for (const it of normalized) {
        const activeVariants = (variantsByProduct.get(it.productId) || []).filter((v) => v.active);
        if (activeVariants.length > 0) {
          const v = it.variantId ? variantById.get(it.variantId) : null;
          if (!v || Number(v.product_id) !== it.productId) {
            const prodName = prodById.get(it.productId)?.name || `#${it.productId}`;
            throw new HttpError(`Select a size for "${prodName}".`, 400);
          }
        } else if (it.variantId) {
          const prodName = prodById.get(it.productId)?.name || `#${it.productId}`;
          throw new HttpError(`${prodName} has no sizes.`, 400);
        }
      }

      // Compute old and new quantities per product and per variant.
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
        const delta = round2((newQtyByProduct[pid] || 0) - (oldQtyByProduct[pid] || 0));
        const future = round2(current + delta);
        if (future < -0.005) {
          const prodName = prodById.get(pid)?.name || `#${pid}`;
          throw new HttpError(
            `Insufficient stock for "${prodName}": editing would make stock negative (${future.toFixed(2)}).`,
            400
          );
        }
      }

      const allVariantIds = [
        ...new Set([...Object.keys(oldQtyByVariant), ...Object.keys(newQtyByVariant)].map(Number)),
      ];
      for (const vid of allVariantIds) {
        const v = variantById.get(vid);
        if (!v) continue;
        const current = Number(v.stock ?? 0);
        const delta = round2((newQtyByVariant[vid] || 0) - (oldQtyByVariant[vid] || 0));
        const future = round2(current + delta);
        if (future < -0.005) {
          throw new HttpError(
            `Insufficient stock for size "${v.name}": editing would make stock negative (${future.toFixed(2)}).`,
            400
          );
        }
      }

      // 1) Remove old purchase items and old purchase stock movements.
      await client.query('DELETE FROM purchase_items WHERE purchase_id = $1', [purchaseId]);
      await client.query(
        `DELETE FROM stock_movements WHERE reason = 'purchase' AND ref_id = $1`,
        [purchaseId]
      );

      // 2) Apply net stock delta to products.
      for (const pid of allIds) {
        const delta = round2((newQtyByProduct[pid] || 0) - (oldQtyByProduct[pid] || 0));
        if (Math.abs(delta) > 0.0001) {
          await client.query(
            'UPDATE products SET stock = stock + $1, updated_at = now() WHERE id = $2',
            [delta, pid]
          );
        }
      }

      // 3) Apply net stock delta and cost/batch/expiry updates to variants.
      const variantMeta = new Map();
      for (const it of normalized) {
        if (it.variantId) {
          variantMeta.set(it.variantId, {
            cost: it.cost,
            expiryDate: it.expiryDate,
            batchNo: it.batchNo || '',
          });
        }
      }
      for (const vid of allVariantIds) {
        const delta = round2((newQtyByVariant[vid] || 0) - (oldQtyByVariant[vid] || 0));
        const meta = variantMeta.get(vid);
        if (meta) {
          await client.query(
            `UPDATE product_variants
                SET stock = stock + $1,
                    cost = $2,
                    expiry_date = COALESCE($3, expiry_date),
                    batch_no = CASE WHEN $4::text = '' THEN batch_no ELSE $4::text END,
                    updated_at = now()
              WHERE id = $5`,
            [delta, meta.cost, meta.expiryDate, meta.batchNo, vid]
          );
        } else if (Math.abs(delta) > 0.0001) {
          await client.query(
            'UPDATE product_variants SET stock = stock + $1, updated_at = now() WHERE id = $2',
            [delta, vid]
          );
        }
      }

      // 4) Insert new purchase_items and matching stock_movements (one per line, matching POST /api/purchases).
      for (const it of normalized) {
        const v = it.variantId ? variantById.get(it.variantId) : null;
        await client.query(
          `INSERT INTO purchase_items (purchase_id, product_id, variant_id, qty, cost, expiry_date, batch_no)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [purchaseId, it.productId, v ? v.id : null, it.qty, it.cost, it.expiryDate, it.batchNo]
        );
        await client.query(
          `INSERT INTO stock_movements (product_id, variant_id, change, reason, ref_id, note, created_by)
           VALUES ($1, $2, $3, 'purchase', $4, $5, $6)`,
          [
            it.productId,
            v ? v.id : null,
            it.qty,
            purchaseId,
            it.batchNo ? `Batch ${it.batchNo}` : '',
            auth.user.id,
          ]
        );
      }

      // 5) Update purchase header & keep any attached payments linked to the purchase's vendor.
      const dueDate = new Date(new Date(date + 'T00:00:00Z').getTime() + 30 * 86400000)
        .toISOString()
        .slice(0, 10);
      await client.query(
        `UPDATE purchases
            SET vendor_id = $1, purchase_date = $2, due_date = $3, total = $4, notes = $5
          WHERE id = $6`,
        [vendorId, date, dueDate, newTotal, notes, purchaseId]
      );
      if (Number(existing.vendor_id) !== vendorId) {
        await client.query(
          'UPDATE purchase_payments SET vendor_id = $1 WHERE purchase_id = $2',
          [vendorId, purchaseId]
        );
      }
    });

    const settings = await getSettings();
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: settings.timezone });
    const detail = await fetchPurchaseDetail(purchaseId, today);
    return ok(detail);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    console.error('[purchases] edit failed:', err);
    return fail('Unable to update purchase. Please try again.', 500);
  }
}

export async function DELETE(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;
  const purchaseId = Number(id);
  if (!Number.isInteger(purchaseId)) return fail('Invalid purchase id.', 404);

  try {
    await withTransaction(async (client) => {
      const pr = await client.query(
        'SELECT id, vendor_id, total FROM purchases WHERE id = $1 FOR UPDATE',
        [purchaseId]
      );
      if (!pr.rows[0]) throw new HttpError('Purchase not found.', 404);

      const oldItems = (
        await client.query(
          'SELECT product_id, variant_id, qty FROM purchase_items WHERE purchase_id = $1 FOR UPDATE',
          [purchaseId]
        )
      ).rows;

      const pids = [...new Set(oldItems.map((r) => Number(r.product_id)))];
      if (pids.length > 0) {
        const prods = await client.query(
          'SELECT id, name, stock FROM products WHERE id = ANY($1::int[]) FOR UPDATE',
          [pids]
        );
        const prodById = new Map(prods.rows.map((r) => [Number(r.id), r]));
        const vRows = await client.query(
          'SELECT id, name, stock FROM product_variants WHERE product_id = ANY($1::int[]) FOR UPDATE',
          [pids]
        );
        const variantById = new Map(vRows.rows.map((r) => [Number(r.id), r]));

        const qtyByProduct = {};
        const qtyByVariant = {};
        for (const r of oldItems) {
          const pid = Number(r.product_id);
          qtyByProduct[pid] = round2((qtyByProduct[pid] || 0) + Number(r.qty));
          if (r.variant_id) {
            const vid = Number(r.variant_id);
            qtyByVariant[vid] = round2((qtyByVariant[vid] || 0) + Number(r.qty));
          }
        }

        for (const [pidStr, removeQty] of Object.entries(qtyByProduct)) {
          const pid = Number(pidStr);
          const p = prodById.get(pid);
          if (!p) continue;
          const future = round2(Number(p.stock) - removeQty);
          if (future < -0.005) {
            throw new HttpError(
              `Cannot delete purchase: stock for "${p.name}" would become negative (${future.toFixed(2)}) because items were already sold.`,
              400
            );
          }
        }

        for (const [vidStr, removeQty] of Object.entries(qtyByVariant)) {
          const vid = Number(vidStr);
          const v = variantById.get(vid);
          if (!v) continue;
          const future = round2(Number(v.stock) - removeQty);
          if (future < -0.005) {
            throw new HttpError(
              `Cannot delete purchase: stock for size "${v.name}" would become negative (${future.toFixed(2)}).`,
              400
            );
          }
        }

        for (const [pidStr, removeQty] of Object.entries(qtyByProduct)) {
          await client.query(
            'UPDATE products SET stock = stock - $1, updated_at = now() WHERE id = $2',
            [removeQty, Number(pidStr)]
          );
        }
        for (const [vidStr, removeQty] of Object.entries(qtyByVariant)) {
          await client.query(
            'UPDATE product_variants SET stock = stock - $1, updated_at = now() WHERE id = $2',
            [removeQty, Number(vidStr)]
          );
        }
      }

      await client.query(
        `DELETE FROM stock_movements WHERE reason = 'purchase' AND ref_id = $1`,
        [purchaseId]
      );
      await client.query('DELETE FROM purchase_payments WHERE purchase_id = $1', [purchaseId]);
      await client.query('DELETE FROM purchase_items WHERE purchase_id = $1', [purchaseId]);
      await client.query('DELETE FROM purchases WHERE id = $1', [purchaseId]);
    });

    return ok({ deleted: purchaseId });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    console.error('[purchases] delete failed:', err);
    return fail('Unable to delete purchase. Please try again.', 500);
  }
}
