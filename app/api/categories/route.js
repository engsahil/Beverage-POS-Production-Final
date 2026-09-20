// GET  /api/categories -> list (admins: all; cashiers: active only)
// POST /api/categories -> create (admin)
import { query } from '@/lib/db';
import { requireAdmin, requireUser } from '@/lib/auth';
import { readJson, str, fail, ok } from '@/lib/validate';

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const isAdmin = auth.user.role === 'admin';
  const rows = await query(
    `SELECT c.id, c.name, c.active,
            (SELECT COUNT(*)::int FROM products p WHERE p.category_id = c.id) AS product_count
       FROM categories c
      ORDER BY c.name`
  );
  return ok({ categories: isAdmin ? rows : rows.filter((c) => c.active) });
}

export async function POST(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');
  const name = str(body.name, { max: 60 });
  if (!name) return fail('Category name is required.');

  const dupe = await query('SELECT id FROM categories WHERE LOWER(name) = LOWER($1)', [name]);
  if (dupe.length > 0) return fail('A category with this name already exists.', 409);

  const rows = await query('INSERT INTO categories (name) VALUES ($1) RETURNING id', [name]);
  return ok({ id: rows[0].id }, 201);
}
