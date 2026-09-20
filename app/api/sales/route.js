// GET  /api/sales -> list (cashier: own only; admin: all, with filters)
// POST /api/sales -> complete a sale
//
// The sale is written in ONE database transaction:
//   lock products (+ customer if credit) -> validate stock/expiry/minimum price
//   -> insert sale + items -> decrease stock -> stock movements
//   -> customer credit ledger if applicable -> commit
// If anything fails, everything rolls back. No partial sales, ever.
//
// Server-side rules (frontend is never authoritative):
//   - prices come from the database
//   - expired products cannot be sold
//   - discount must not take any product below its minimum selling price
//     (unless the seller holds the price_override permission / is admin)
//   - discount > 0 requires the discount permission (admins implicit)
//   - paid < total is only allowed as a customer credit sale
//     (customer selected + customer_credit permission)
//   - products with sizes/variants must be sold with a valid variant;
//     the variant price (from the database) is charged
//   - stock is deducted exactly once per base product per sale, even
//     when several sizes of the same product are sold
import { query, withTransaction } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { hasPermission } from '@/lib/permissions';
import { readJson, str, toNumber, validDate, fail, ok, round2, HttpError } from '@/lib/validate';
import { PRICING_MODES, normalizePricingMode, priceForMode, minForMode, summarizeModes } from '@/lib/pricing';

export async function GET(req) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const sp = req.nextUrl.searchParams;
  const isAdmin = auth.user.role === 'admin';
  const settings = await getSettings();
  const tz = settings.timezone;

  const from = validDate(sp.get('from'));
  const to = validDate(sp.get('to'));
  const method = sp.get('paymentMethod') || '';
  const cashierId = sp.get('cashierId') ? Number(sp.get('cashierId')) : null;

  const where = [];
  const params = [];
  if (!isAdmin) {
    params.push(auth.user.id);
    where.push(`s.cashier_id = $${params.length}`);
  } else if (Number.isInteger(cashierId) && cashierId) {
    params.push(cashierId);
    where.push(`s.cashier_id = $${params.length}`);
  }
  if (['cash', 'card', 'other'].includes(method)) {
    params.push(method);
    where.push(`s.payment_method = $${params.length}`);
  }
  if (from) {
    params.push(tz, from);
    where.push(`(s.created_at AT TIME ZONE $${params.length - 1})::date >= $${params.length}`);
  }
  if (to) {
    params.push(tz, to);
    where.push(`(s.created_at AT TIME ZONE $${params.length - 1})::date <= $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT s.id, s.sale_no, s.created_at, s.total, s.subtotal, s.discount,
            s.payment_method, s.paid, s.change_due, s.status, s.pricing_mode,
            u.full_name AS cashier_name,
            COALESCE(c.name, NULLIF(s.customer_name, '')) AS customer_name,
            (SELECT COUNT(*)::int FROM sale_items si WHERE si.sale_id = s.id) AS line_count
       FROM sales s
       JOIN users u ON u.id = s.cashier_id
       LEFT JOIN customers c ON c.id = s.customer_id
       ${whereSql}
      ORDER BY s.id DESC
      LIMIT 200`,
    params
  );
  return ok({ sales: rows });
}

const METHODS = ['cash', 'card', 'other'];

/** Business "today" in the store timezone, YYYY-MM-DD. */
function businessToday(tz) {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: tz });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** pg returns DATE columns as Date objects — normalize to YYYY-MM-DD. */
function dateStr(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

export async function POST(req) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return fail('The cart is empty.');
  if (items.length > 100) return fail('Too many line items.');

  const normalized = [];
  for (const it of items) {
    const productId = Number(it.productId);
    const qty = toNumber(it.qty);
    if (!Number.isInteger(productId) || qty === null || qty <= 0) {
      return fail('Each cart line needs a valid product and quantity.');
    }
    const variantLabel =
      it.variant === undefined || it.variant === null ? '' : String(it.variant).trim().slice(0, 40);
    const variantId = it.variantId ? Number(it.variantId) : null;
    if (it.variantId && (!Number.isInteger(variantId) || variantId < 1)) {
      return fail('Each cart line needs a valid size.');
    }
    // Per-line pricing mode (the POS applies a mode per cart line).
    // Absent/null/'' falls back to the sale-level mode (legacy payloads);
    // any other value must be a known mode.
    const lineModeRaw =
      it.mode === undefined || it.mode === null || it.mode === '' ? undefined : it.mode;
    if (lineModeRaw !== undefined && !PRICING_MODES.includes(lineModeRaw)) {
      return fail(`Line ${normalized.length + 1}: invalid pricing mode.`);
    }
    normalized.push({ productId, qty: round2(qty), variant: variantLabel, variantId, mode: lineModeRaw });
  }

  const discount = toNumber(body.discount);
  if (discount === null || discount < 0) return fail('Discount must be 0 or more.');
  const paymentMethod = METHODS.includes(body.paymentMethod) ? body.paymentMethod : null;
  if (!paymentMethod) return fail('Select a payment method.');
  const paid = toNumber(body.paid);
  if (paid === null || paid < 0) return fail('Enter the amount the customer paid.');
  const customerName = str(body.customerName, { max: 80 }) ?? '';
  const customerPhone = str(body.customerPhone, { max: 30 }) ?? '';
  const customerId = body.customerId ? Number(body.customerId) : null;
  const tableNo = str(body.tableNo, { max: 20 }) ?? null; // dining table; null = walk-in/bar
  const notes = str(body.notes, { max: 300 }) ?? ''; // kitchen/order notes

  // Pricing mode (retail | wholesale | special). Absent = retail. An unknown
  // value is rejected — the mode is validated here AND the price is always
  // re-derived from the database, so a crafted request cannot set a price.
  const mode = normalizePricingMode(body.pricingMode);
  if (body.pricingMode !== undefined && body.pricingMode !== null && !PRICING_MODES.includes(body.pricingMode)) {
    return fail('Invalid pricing mode.');
  }

  // Permission checks (admins pass automatically).
  if (discount > 0 && !hasPermission(auth.user, 'discount')) {
    return fail('You do not have permission to apply discounts.');
  }
  if (customerId !== null && !Number.isInteger(customerId)) return fail('Invalid customer.');

  const settings = await getSettings();
  const tz = settings.timezone;
  const today = businessToday(tz);

  // Admin-configured minimum prices for THIS cashier (admin is never limited).
  // Read outside the lock: it is configuration, not transactional balance.
  let limits = null;
  if (auth.user.role !== 'admin') {
    const lim = await query(
      'SELECT retail_min, wholesale_min, special_min FROM cashier_price_limits WHERE user_id = $1',
      [auth.user.id]
    );
    const r = lim[0];
    if (r) {
      const num = (v) => (v === null || v === undefined ? null : Number(v));
      limits = { retail: num(r.retail_min), wholesale: num(r.wholesale_min), special: num(r.special_min) };
    }
  }
  // Per-line limits are read inside the line loop (each line has its own
  // mode), so no single sale-level limit variable is needed here.

  try {
    const saleId = await withTransaction(async (client) => {
      // 1) Lock the products we are selling (prevents overselling), and
      // their variant rows (per-variant stock + expiry are authoritative).
      const productIds = [...new Set(normalized.map((i) => i.productId))];
      const prods = await client.query(
        'SELECT id, name, price, stock, active, min_price, wholesale_price, special_price, expiry_date, min_price_enabled, min_retail, min_wholesale, min_special FROM products WHERE id = ANY($1::int[]) FOR UPDATE',
        [productIds]
      );
      const byId = new Map(prods.rows.map((r) => [r.id, r]));
      const vRows = await client.query(
        'SELECT * FROM product_variants WHERE product_id = ANY($1::int[]) ORDER BY product_id, sort_order, id FOR UPDATE',
        [productIds]
      );
      const variantsByProduct = new Map();
      const variantById = new Map();
      for (const v of vRows.rows) {
        if (!variantsByProduct.has(v.product_id)) variantsByProduct.set(v.product_id, []);
        variantsByProduct.get(v.product_id).push(v);
        variantById.set(v.id, v);
      }

      // Customer (for credit sales) — lock for consistent balance updates.
      let customer = null;
      if (customerId !== null) {
        // outstanding_balance is read here (under the row lock) so a second
        // credit sale adds to the existing balance instead of resetting it.
        const cRes = await client.query(
          'SELECT id, name, active, outstanding_balance FROM customers WHERE id = $1 FOR UPDATE',
          [customerId]
        );
        customer = cRes.rows[0] || null;
        if (!customer) throw new HttpError('Customer not found.', 409);
        if (!customer.active) throw new HttpError('This customer is disabled.', 409);
      }

      // 2) Validate and compute totals from DATABASE prices (never client prices).
      // Each cart line keeps its own size/variant (same product may appear
      // several times with different sizes). Stock + expiry are checked on
      // the variant row when the product has sizes, otherwise on the product.
      const qtyById = {};
      const qtyByVariant = {}; // variantId -> total qty across its lines
      const productOfVariant = {};
      for (const it of normalized) qtyById[it.productId] = (qtyById[it.productId] || 0) + it.qty;

      let subtotal = 0;
      let floorTotal = 0; // sum of qty * (effective discount floor per line)
      let minFloorTotal = 0; // sum of qty * (product min_price floor per line)
      let userFloorRaised = false; // a cashier per-mode minimum raised a line floor
      let itemFloorRaised = false; // a product/variant minimum raised a line floor
      const lines = [];
      const checkedProducts = new Set();
      for (const it of normalized) {
        const p = byId.get(it.productId);
        if (!p) throw new HttpError('A product in this sale no longer exists.', 409);
        if (!p.active) throw new HttpError(`Product "${p.name}" is disabled.`, 409);

        // Size/variant: the server decides the price, the client only picks.
        // Each line carries its own pricing mode (validated above); a
        // missing line mode falls back to the sale-level mode. A missing
        // mode price falls back to retail — see lib/pricing.js.
        const itemMode = it.mode || mode;
        const variants = variantsByProduct.get(p.id) || [];
        let linePrice = priceForMode(p, itemMode);
        let floorPrice = Math.min(linePrice, Number(p.min_price) || 0);
        let vLabel = '';
        let vRow = null;
        if (variants.length > 0) {
          vRow = it.variantId
            ? variants.find((v) => Number(v.id) === it.variantId)
            : variants.find((v) => v.name.trim() === (it.variant || ''));
          if (!vRow) {
            throw new HttpError(
              it.variantId || it.variant
                ? `Unknown size for "${p.name}".`
                : `"${p.name}" has sizes — select one.`,
              400
            );
          }
          if (!vRow.active) throw new HttpError(`"${p.name}" size "${vRow.name}" is disabled.`, 409);
          const vExpiry = dateStr(vRow.expiry_date);
          if (vExpiry && vExpiry < today) {
            throw new HttpError(`"${p.name} (${vRow.name})" is expired (${vExpiry}). Remove it.`, 409);
          }
          vLabel = vRow.name;
          linePrice = priceForMode(vRow, itemMode);
          if (!Number.isFinite(linePrice) || linePrice < 0) {
            throw new HttpError(`"${p.name}" size "${vLabel}" has an invalid price.`, 409);
          }
          floorPrice = linePrice; // the variant's own price is its floor
          qtyByVariant[vRow.id] = (qtyByVariant[vRow.id] || 0) + it.qty;
          productOfVariant[vRow.id] = p.id;
        } else {
          if (it.variantId || it.variant) throw new HttpError(`"${p.name}" has no sizes.`, 400);
          if (!checkedProducts.has(p.id)) {
            const expiry = dateStr(p.expiry_date);
            if (expiry && expiry < today) {
              throw new HttpError(`"${p.name}" is expired (${expiry}). Remove it.`, 409);
            }
            const need = qtyById[p.id];
            const have = Number(p.stock);
            if (have < need) {
              const avail = Number.isInteger(have) ? have : have.toFixed(2);
              throw new HttpError(`"${p.name}" is out of stock. Available: ${avail}.`, 409);
            }
            checkedProducts.add(p.id);
          }
        }
        // Cashier minimum price for THIS line's mode (admin-configured,
        // server-side). The applied price must not fall below it — even
        // before any discount.
        const rowLimit = limits ? limits[itemMode] ?? null : null;
        if (rowLimit !== null && Number.isFinite(rowLimit) && linePrice < rowLimit - 0.001) {
          throw new HttpError(
            `"${p.name}"${vLabel ? ` (${vLabel})` : ''}: the ${itemMode} price (${linePrice.toFixed(2)}) is below your minimum allowed price (${rowLimit.toFixed(2)}).`,
            400
          );
        }
        // Product/variant minimum selling price for this line's mode
        // (admin-configured per mode, ON/OFF). A HARD floor for every seller
        // — the effective floor is the max of all configured restrictions,
        // so neither level weakens the other.
        let itemFloor = minForMode(p, itemMode);
        if (vRow) {
          const vMin = minForMode(vRow, itemMode);
          if (vMin !== null) itemFloor = itemFloor === null ? vMin : Math.max(itemFloor, vMin);
        }
        if (itemFloor !== null && linePrice < itemFloor - 0.001) {
          throw new HttpError(
            `"${p.name}"${vLabel ? ` (${vLabel})` : ''}: the ${itemMode} price (${linePrice.toFixed(2)}) is below the minimum selling price for this item (${itemFloor.toFixed(2)}).`,
            400
          );
        }
        // The line's own floor (product min_price / variant price) — recorded
        // before any hard minimum raises it, so the floors stay separate.
        const baseFloor = floorPrice;
        minFloorTotal = round2(minFloorTotal + it.qty * baseFloor);
        // Hard floors raise the line floor (even the price_override
        // permission cannot cross them), so discounts can't push a line
        // below them either. Remember which level is binding on lines where
        // a hard floor applies, for an accurate error message.
        const userFloor = rowLimit !== null && Number.isFinite(rowLimit) ? rowLimit : null;
        const hardFloor = Math.max(baseFloor, userFloor ?? -1, itemFloor ?? -1);
        if (hardFloor > baseFloor) {
          floorPrice = hardFloor;
          const userBinds = userFloor !== null && (itemFloor === null || userFloor >= itemFloor);
          if (userBinds) userFloorRaised = true;
          else itemFloorRaised = true;
        }
        subtotal = round2(subtotal + it.qty * linePrice);
        floorTotal = round2(floorTotal + it.qty * floorPrice);
        lines.push({
          id: p.id,
          name: p.name,
          variant: vLabel,
          variantId: vRow ? vRow.id : null,
          price: linePrice,
          qty: it.qty,
          mode: itemMode,
        });
      }

      // Per-variant stock (each size has its own stock level).
      for (const [vid, need] of Object.entries(qtyByVariant)) {
        const v = variantById.get(Number(vid));
        const have = Number(v.stock);
        if (have < need) {
          const avail = Number.isInteger(have) ? have : have.toFixed(2);
          throw new HttpError(
            `"${byId.get(productOfVariant[vid]).name}" size "${v.name}" is out of stock. Available: ${avail}.`,
            409
          );
        }
      }

      const disc = round2(discount);
      if (disc > subtotal) throw new HttpError('Discount cannot be greater than the subtotal.', 400);
      const total = round2(subtotal - disc);

      // Two discount floors per line:
      //   floorTotal    = the effective floor, raised by the cashier's
      //                   per-mode minimums where configured (HARD — no
      //                   permission, including price_override, crosses it)
      //   minFloorTotal = the product's own minimum selling price floor
      //                   (softer — price_override may lift it).
      const maxDiscount = round2(subtotal - floorTotal);
      if (disc > maxDiscount + 0.001) {
        const limitRaised = floorTotal > minFloorTotal + 0.001;
        if (limitRaised || !hasPermission(auth.user, 'price_override')) {
          const msg =
            userFloorRaised && !itemFloorRaised
              ? `Discount would take the sale below your minimum allowed price. Maximum discount: ${maxDiscount}.`
              : itemFloorRaised && !userFloorRaised
                ? `Discount would take the sale below the minimum selling price for this item. Maximum discount: ${maxDiscount}.`
                : limitRaised
                  ? `Discount would take the sale below a configured minimum price. Maximum discount: ${maxDiscount}.`
                  : `Discount would take a product below its minimum selling price. Maximum discount: ${maxDiscount}.`;
          throw new HttpError(msg, 400);
        }
      }

      const paidNum = round2(paid);
      let credit = 0;
      if (paidNum < total) {
        // Only allowed as a customer credit sale.
        if (!customer) throw new HttpError('Select a customer to record the balance as credit.', 400);
        if (!hasPermission(auth.user, 'customer_credit')) {
          throw new HttpError('You do not have permission to make credit sales.', 400);
        }
        credit = round2(total - paidNum);
      }
      const changeDue = round2(Math.max(paidNum - total, 0));
      // Sale-level summary: the single mode if every line used it, else
      // 'mixed'. Per-line modes are the source of truth (sale_items).
      const storedMode = summarizeModes(lines.map((l) => l.mode));

      // 3) Insert the sale, then assign its sequential invoice number.
      const ins = await client.query(
        `INSERT INTO sales
           (sale_no, cashier_id, customer_name, customer_phone, customer_id,
            subtotal, discount, total, payment_method, paid, change_due, table_no, notes, pricing_mode)
         VALUES ('TMP', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [
          auth.user.id,
          customer ? '' : customerName,
          customer ? '' : customerPhone,
          customerId,
          subtotal,
          disc,
          total,
          paymentMethod,
          paidNum,
          changeDue,
          tableNo,
          notes,
          storedMode,
        ]
      );
      const id = ins.rows[0].id;
      // Sequential invoice number from the serial id: 00001, 00002, ...
      // The serial guarantees uniqueness under concurrency (gaps are
      // possible after rollbacks, duplicates are not).
      const no = await client.query(`SELECT lpad($1::text, 5, '0') AS no`, [id]);
      await client.query('UPDATE sales SET sale_no = $1 WHERE id = $2', [no.rows[0].no, id]);

      // 4) Item lines (one per cart line, keeping its size/variant),
      // then ONE stock decrease + ONE movement per base product (even when
      // several sizes of the same product are in the sale), plus the
      // per-variant stock decreases.
      for (const l of lines) {
        await client.query(
          'INSERT INTO sale_items (sale_id, product_id, name, qty, unit_price, variant, variant_id, pricing_mode) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [id, l.id, l.name, l.qty, l.price, l.variant, l.variantId, l.mode]
        );
      }
      for (const pid of productIds) {
        const need = qtyById[pid];
        // human-readable note: which sizes went out with this sale
        const sold = lines.filter((l) => l.id === pid);
        const sizeNote = sold
          .filter((l) => l.variant)
          .map((l) => `${l.qty} x ${l.variant}`)
          .join(', ');
        const soldVariantIds = [...new Set(sold.map((l) => l.variantId))];
        const singleVariant = soldVariantIds.length === 1 && soldVariantIds[0] ? soldVariantIds[0] : null;
        await client.query('UPDATE products SET stock = stock - $1, updated_at = now() WHERE id = $2', [
          need,
          pid,
        ]);
        await client.query(
          `INSERT INTO stock_movements (product_id, variant_id, change, reason, ref_id, note, created_by)
           VALUES ($1, $2, $3, 'sale', $4, $5, $6)`,
          [pid, singleVariant || null, -need, id, sizeNote, auth.user.id]
        );
        if (singleVariant) {
          await client.query('UPDATE product_variants SET stock = stock - $1, updated_at = now() WHERE id = $2', [
            need,
            singleVariant,
          ]);
        }
      }
      // Mixed-size sales: deduct each variant by its own total.
      for (const [vid, need] of Object.entries(qtyByVariant)) {
        const v = variantById.get(Number(vid));
        const pid = productOfVariant[vid];
        const sold = lines.filter((l) => l.id === pid);
        const soldVariantIds = [...new Set(sold.map((l) => l.variantId))];
        if (soldVariantIds.length > 1) {
          await client.query('UPDATE product_variants SET stock = stock - $1, updated_at = now() WHERE id = $2', [
            need,
            Number(vid),
          ]);
        }
      }

      // 5) Customer credit ledger (same transaction as the sale).
      if (credit > 0) {
        const bal = Number(customer.outstanding_balance ?? 0) + credit;
        const after = round2(bal);
        await client.query('UPDATE customers SET outstanding_balance = $1 WHERE id = $2', [
          after,
          customer.id,
        ]);
        await client.query(
          `INSERT INTO customer_transactions
             (customer_id, type, amount, balance_after, ref_id, note, created_by)
           VALUES ($1, 'sale', $2, $3, $4, $5, $6)`,
          [customer.id, credit, after, id, `Sale ${no.rows[0].no}`, auth.user.id]
        );
      }
      return id;
    });

    return ok({ id: saleId }, 201);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    console.error('[sales] create failed:', err);
    return fail('Unable to complete sale. Please try again.', 500);
  }
}
