// GET  /api/customers -> list (any authenticated; search supported)
// POST /api/customers -> create (admin or customer_management permission)
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { readJson, str, fail, ok } from '@/lib/validate';

export async function GET(req) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const sp = req.nextUrl.searchParams;
  const search = (sp.get('search') || '').trim();
  const isAdminView = hasPermission(auth.user, 'customer_management'); // includes admins

  const where = [];
  const params = [];
  if (!isAdminView) where.push('c.active = TRUE');
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where.push(`(LOWER(c.name) LIKE $${params.length} OR LOWER(c.phone) LIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await query(
    `SELECT c.id, c.name, c.phone, c.address, c.notes, c.active, c.outstanding_balance, c.created_at
       FROM customers c
       ${whereSql}
      ORDER BY c.name
      LIMIT 500`,
    params
  );
  return ok({ customers: rows });
}

export async function POST(req) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  if (!hasPermission(auth.user, 'customer_management')) {
    return fail('You do not have permission to manage customers.', 403);
  }

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');
  const name = str(body.name, { max: 80 });
  const phone = str(body.phone, { max: 30 }) ?? '';
  const address = str(body.address, { max: 200 }) ?? '';
  const notes = str(body.notes, { max: 300 }) ?? '';
  const active = typeof body.active === 'boolean' ? body.active : true;

  if (!name) return fail('Customer name is required.');

  const rows = await query(
    'INSERT INTO customers (name, phone, address, notes, active) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [name, phone, address, notes, active]
  );
  return ok({ id: rows[0].id }, 201);
}
