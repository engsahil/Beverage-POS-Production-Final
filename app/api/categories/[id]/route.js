// PUT /api/categories/:id -> rename / enable / disable (admin)
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { readJson, str, fail, ok } from '@/lib/validate';

export async function PUT(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;
  const catId = Number(id);
  if (!Number.isInteger(catId)) return fail('Invalid category id.', 404);

  const rows = await query('SELECT * FROM categories WHERE id = $1', [catId]);
  const cat = rows[0];
  if (!cat) return fail('Category not found.', 404);

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');

  if (body.name !== undefined) {
    const name = str(body.name, { max: 60 });
    if (!name) return fail('Category name is required.');
    const dupe = await query('SELECT id FROM categories WHERE LOWER(name) = LOWER($1) AND id <> $2', [
      name,
      catId,
    ]);
    if (dupe.length > 0) return fail('A category with this name already exists.', 409);
    await query('UPDATE categories SET name = $1 WHERE id = $2', [name, catId]);
  }
  if (typeof body.active === 'boolean') {
    await query('UPDATE categories SET active = $1 WHERE id = $2', [body.active, catId]);
  }
  return ok(null);
}
