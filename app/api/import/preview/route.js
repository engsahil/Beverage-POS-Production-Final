// POST /api/import/preview { entity, content }
// Validate a CSV in the browser before it touches the database.
// Returns row count, per-row errors and how many would be skipped as duplicates.
// Nothing is written here.
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { readJson, fail, ok } from '@/lib/validate';
import { parseCsv, rowsToObjects } from '@/lib/csv';
import { ENTITIES, findDuplicates, keyFor, validateRow } from '../shared';

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

  const errors = [];
  const valid = [];
  objects.forEach((r, i) => {
    const err = validateRow(entity, r, i + 2);
    if (err) errors.push({ row: i + 2, message: err });
    else valid.push(r);
  });

  const dupes = await findDuplicates(query, entity, valid);
  let skipped = 0;
  for (const r of valid) if (dupes.has(keyFor(entity, r))) skipped++;

  return ok({
    entity,
    totalRows: objects.length,
    validRows: valid.length,
    errors,
    duplicates: skipped,
    willInsert: valid.length - skipped,
  });
}
