// POST /api/data/clear  (admin only, explicit confirmation required)
// Scoped cleanup for test data. Every operation is transactional and
// conservative:
//   operation: 'sales'    -> sales before a date; restores product stock;
//                            sales that created customer credit are SKIPPED
//   operation: 'customers'-> customers with NO sales and NO ledger entries
//   operation: 'expenses' -> expenses before a date
// Nothing else is ever touched (products, settings, users, shifts remain).
import { withTransaction } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { readJson, validDate, fail, ok } from '@/lib/validate';

const OPERATIONS = ['sales', 'customers', 'expenses'];

export async function POST(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');
  const operation = OPERATIONS.includes(body.operation) ? body.operation : null;
  if (!operation) return fail('Unknown operation.');
  if (body.confirm !== 'DELETE') {
    return fail('Type DELETE in the confirmation field to proceed.');
  }

  const before = body.before ? validDate(body.before) : null;
  if ((operation === 'sales' || operation === 'expenses') && !before) {
    return fail('Select the "before" date for this operation.');
  }

  const settings = await getSettings();
  const tz = settings.timezone;

  try {
    const result = await withTransaction(async (client) => {
      if (operation === 'sales') {
        // Target sales, in business-date terms, that have no credit ledger.
        const sel = await client.query(
          `SELECT s.id FROM sales s
            WHERE (s.created_at AT TIME ZONE $1)::date < $2
              AND NOT EXISTS (SELECT 1 FROM customer_transactions ct WHERE ct.ref_id = s.id)`,
          [tz, before]
        );
        const skippedRes = await client.query(
          `SELECT COUNT(*)::int AS n FROM sales s
            WHERE (s.created_at AT TIME ZONE $1)::date < $2
              AND EXISTS (SELECT 1 FROM customer_transactions ct WHERE ct.ref_id = s.id)`,
          [tz, before]
        );
        const ids = sel.rows.map((r) => r.id);
        if (ids.length) {
          // Restore stock first (history stays honest).
          // Variant lines go back into their size's stock.
          await client.query(
            `UPDATE product_variants pv SET stock = pv.stock + d.add, updated_at = now()
               FROM (SELECT si.variant_id, SUM(si.qty)::numeric AS add
                       FROM sale_items si
                      WHERE si.sale_id = ANY($1::int[]) AND si.variant_id IS NOT NULL
                      GROUP BY si.variant_id) d
              WHERE pv.id = d.variant_id`,
            [ids]
          );
          await client.query(
            `UPDATE products p SET stock = p.stock + d.add, updated_at = now()
               FROM (SELECT si.product_id, SUM(si.qty)::numeric AS add
                       FROM sale_items si
                      WHERE si.sale_id = ANY($1::int[])
                      GROUP BY si.product_id) d
              WHERE p.id = d.product_id`,
            [ids]
          );
          // Products that have sizes keep stock on the size rows: re-derive
          // the product summary from the (already restored) variant stock so
          // nothing is double-counted.
          await client.query(
            `UPDATE products p
                SET stock = (SELECT COALESCE(SUM(pv.stock), 0) FROM product_variants pv WHERE pv.product_id = p.id),
                    updated_at = now()
              WHERE EXISTS (SELECT 1 FROM product_variants pv2 WHERE pv2.product_id = p.id)`
          );
          await client.query(
            `INSERT INTO stock_movements (product_id, change, reason, note, created_by)
             SELECT d.product_id, d.add, 'adjustment', 'Test data cleared (stock restored)', $2
               FROM (SELECT si.product_id, SUM(si.qty)::numeric AS add
                       FROM sale_items si
                      WHERE si.sale_id = ANY($1::int[])
                      GROUP BY si.product_id) d`,
            [ids, auth.user.id]
          );
          // Keep the original negative sale movements as immutable stock
          // history. The positive restoration rows above cancel them exactly.
          await client.query('DELETE FROM sale_items WHERE sale_id = ANY($1::int[])', [ids]);
          await client.query('DELETE FROM sales WHERE id = ANY($1::int[])', [ids]);
        }
        return { deleted: ids.length, skipped: skippedRes.rows[0].n };
      }

      if (operation === 'customers') {
        const res = await client.query(
          `DELETE FROM customers c
            WHERE NOT EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id)
              AND NOT EXISTS (SELECT 1 FROM customer_transactions ct WHERE ct.customer_id = c.id)
            RETURNING c.id`
        );
        return { deleted: res.rowCount, skipped: 0 };
      }

      // expenses
      const res = await client.query('DELETE FROM expenses WHERE expense_date < $1', [before]);
      return { deleted: res.rowCount, skipped: 0 };
    });

    return ok(result);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, err.status);
    console.error('[data] clear failed:', err);
    return fail('The operation failed and no data was changed.', 500);
  }
}
