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
          const categoryId = await resolveCat(r.category);
          const ins = await client.query(
            `INSERT INTO products (name, barcode, category_id, price, cost, stock, min_stock, min_price, expiry_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [r.name, r.barcode || null, categoryId, price, cost, stock, minStock, minPrice, parseDate(r.expiry_date || '')]
          );
          inserted++;
          if (stock > 0) {
            await client.query(
              `INSERT INTO stock_movements (product_id, change, reason, note, created_by)
               VALUES ($1, $2, 'adjustment', 'CSV import', $3)`,
              [ins.rows[0].id, stock, auth.user.id]
            );
          }
        }
      } else if (entity === 'customers') {
        for (const r of toInsert) {
          if (dupes.has(keyFor(entity, r))) {
            skipped++;
            continue;
          }
          await client.query(
            'INSERT INTO customers (name, phone, address, notes) VALUES ($1, $2, $3, $4)',
            [r.name, r.phone || '', r.address || '', r.notes || '']
          );
          inserted++;
        }
      } else {
        for (const r of toInsert) {
          if (dupes.has(keyFor(entity, r))) {
            skipped++;
            continue;
          }
          await client.query('INSERT INTO vendors (name) VALUES ($1)', [r.name]);
          inserted++;
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
