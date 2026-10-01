// POST /api/import/apply { entity, content }
// Apply a CSV import in ONE transaction: everything is inserted, or
// nothing is (rollback + row errors are returned). Duplicates found at
// preview time are skipped, never overwritten.
import { withTransaction } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { readJson, fail, ok, toNumber, round2, HttpError } from '@/lib/validate';
import { parseCsv, rowsToObjects } from '@/lib/csv';
import { ENTITIES, findDuplicates, keyFor, parseDate, validateRow } from '../shared';

export async function POST(req) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  if (auth.user.role !== 'admin' && !hasPermission(auth.user, 'customer_management')) {
    return fail('You do not have permission to import data.', 403);
  }

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');
  const entity = ENTITIES[body.entity] ? body.entity : null;
  if (!entity) return fail('Unknown entity. Use products, customers or vendors.');
  if (typeof body.content !== 'string' || !body.content.trim()) {
    return fail('Paste a CSV file with a header row.');
  }
  if (body.content.length > 2 * 1024 * 1024) return fail('File is too large (max 2 MB).');

  const rows = parseCsv(body.content);
  if (rows.length < 2) return fail('The CSV needs a header row and at least one data row.');
  const objects = rowsToObjects(rows);

  try {
    const result = await withTransaction(async (client) => {
      const dupes = await findDuplicates(client, entity, objects);

      // Re-validate inside the transaction (same rules as preview).
      const errors = [];
      const toInsert = [];
      objects.forEach((r, i) => {
        const err = validateRow(entity, r, i + 2);
        if (err) errors.push({ row: i + 2, message: err });
        else toInsert.push(r);
      });
      if (errors.length) throw new HttpError('Some rows could not be imported.', 400, { errors });

      let inserted = 0;
      let skipped = 0;

      if (entity === 'products') {
        // Resolve categories: existing (case-insensitive) or create new.
        const catCache = new Map();
        const resolveCat = async (name) => {
          if (!name) return null;
          if (catCache.has(name)) return catCache.get(name);
          let res = await client.query('SELECT id FROM categories WHERE LOWER(name) = LOWER($1)', [name]);
          if (!res.rows.length) {
            res = await client.query('INSERT INTO categories (name) VALUES ($1) RETURNING id', [name]);
          }
          catCache.set(name, res.rows[0].id);
          return res.rows[0].id;
        };

        // Validate every row first, then insert in batches. The old code ran
        // one INSERT (plus one stock_movements INSERT) per row inside the
        // transaction, so a 500-row import made ~1000 database round trips -
        // invisible on localhost, but roughly 20 seconds against a database in
        // another region. Validation order is unchanged, so the same row
        // produces the same error message.
        const prepared = [];
        for (const r of toInsert) {
          if (dupes.has(keyFor(entity, r))) {
            skipped++;
            continue;
          }
          const price = round2(toNumber(r.price));
          const cost = r.cost === '' ? 0 : round2(toNumber(r.cost));
          const stock = r.stock === '' ? 0 : round2(toNumber(r.stock));
          const minStock = r.min_stock === '' ? 0 : round2(toNumber(r.min_stock));
          const minPrice = r.min_price === '' ? 0 : round2(toNumber(r.min_price));
          if (minPrice > price) {
            throw new HttpError('Some rows could not be imported.', 400, {
              errors: [{ row: 0, message: `min_price cannot exceed price (${r.name})` }],
            });
          }
          prepared.push({
            row: r,
            price,
            cost,
            stock,
            minStock,
            minPrice,
          });
        }

        const CHUNK = 100;
        for (let i = 0; i < prepared.length; i += CHUNK) {
          const slice = prepared.slice(i, i + CHUNK);
          // Categories are resolved per slice (resolveCat caches, so a repeat
          // name costs nothing after the first lookup).
          for (const p of slice) p.categoryId = await resolveCat(p.row.category);

          const params = [];
          const ph = [];
          for (const p of slice) {
            params.push(
              p.row.name,
              p.row.barcode || null,
              p.categoryId,
              p.price,
              p.cost,
              p.stock,
              p.minStock,
              p.minPrice,
              parseDate(p.row.expiry_date || '')
            );
            const n = params.length;
            ph.push(
              `($${n - 8}, $${n - 7}, $${n - 6}, $${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`
            );
          }
          const ins = await client.query(
            `INSERT INTO products (name, barcode, category_id, price, cost, stock, min_stock, min_price, expiry_date)
             VALUES ${ph.join(', ')} RETURNING id, stock`,
            params
          );
          inserted += ins.rows.length;

          // Opening stock movements for the rows that actually carry stock,
          // in ONE statement (the ids come back from the insert above).
          const withStock = ins.rows.filter((r) => Number(r.stock) > 0);
          if (withStock.length) {
            const mParams = [];
            const mPh = [];
            for (const r of withStock) {
              mParams.push(r.id, Number(r.stock), auth.user.id);
              const n = mParams.length;
              mPh.push(`($${n - 2}, $${n - 1}, 'adjustment', 'CSV import', $${n})`);
            }
            await client.query(
              `INSERT INTO stock_movements (product_id, change, reason, note, created_by)
               VALUES ${mPh.join(', ')}`,
              mParams
            );
          }
        }
      } else if (entity === 'customers') {
        const rowsC = toInsert.filter((r) => !dupes.has(keyFor(entity, r)));
        skipped += toInsert.length - rowsC.length;
        for (let i = 0; i < rowsC.length; i += 100) {
          const slice = rowsC.slice(i, i + 100);
          const params = [];
          const ph = [];
          for (const r of slice) {
            params.push(r.name, r.phone || '', r.address || '', r.notes || '');
            const n = params.length;
            ph.push(`($${n - 3}, $${n - 2}, $${n - 1}, $${n})`);
          }
          await client.query(
            `INSERT INTO customers (name, phone, address, notes) VALUES ${ph.join(', ')}`,
            params
          );
          inserted += slice.length;
        }
      } else {
        const rowsV = toInsert.filter((r) => !dupes.has(keyFor(entity, r)));
        skipped += toInsert.length - rowsV.length;
        for (let i = 0; i < rowsV.length; i += 100) {
          const slice = rowsV.slice(i, i + 100);
          // Placeholders restart at $1 for every chunk, matching the params
          // array passed with it.
          await client.query(
            `INSERT INTO vendors (name) VALUES ${slice.map((_, k) => `($${k + 1})`).join(', ')}`,
            slice.map((r) => r.name)
          );
          inserted += slice.length;
        }
      }

      return { inserted, skipped, total: toInsert.length };
    });

    return ok(result, 201);
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.data?.errors) return fail(err.message, err.status, err.data);
      return fail(err.message, err.status);
    }
    console.error('[import] apply failed:', err);
    return fail('The import failed and no data was changed. Please check the file.', 500);
  }
}
