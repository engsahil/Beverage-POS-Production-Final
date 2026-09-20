// GET  /api/users        -> list users (admin)
// POST /api/users        -> create user (admin)
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { hashPassword } from '@/lib/password';
import { PERMISSIONS } from '@/lib/permissions';
import { readJson, str, fail, ok } from '@/lib/validate';

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const rows = await query(
    `SELECT u.id, u.username, u.full_name, u.role, u.active, u.created_at,
            COALESCE(array_agg(DISTINCT up.permission) FILTER (WHERE up.permission IS NOT NULL), '{}')::text[] AS permissions
       FROM users u
       LEFT JOIN user_permissions up ON up.user_id = u.id
      GROUP BY u.id
      ORDER BY u.role, u.username`
  );
  return ok({ users: rows });
}

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,30}$/;

export async function POST(req) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');
  const username = str(body.username, { max: 30 });
  const fullName = str(body.fullName, { max: 80 }) ?? '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role = body.role === 'admin' ? 'admin' : 'cashier';

  if (!username || !USERNAME_RE.test(username)) {
    return fail('Username must be 3-30 characters: letters, numbers, dot, dash or underscore.');
  }
  if (!password || password.length < 6) {
    return fail('Password must be at least 6 characters.');
  }
  const dupe = await query('SELECT id FROM users WHERE username = $1', [username]);
  if (dupe.length > 0) return fail('That username is already in use.', 409);

  // Validate permissions BEFORE any write: a rejected request must not
  // leave a half-created (orphaned) user row behind.
  if (role === 'cashier' && Array.isArray(body.permissions)) {
    for (const perm of body.permissions) {
      if (!PERMISSIONS.includes(perm)) return fail('Unknown permission.');
    }
  }

  const rows = await query(
    'INSERT INTO users (username, full_name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
    [username, fullName, hashPassword(password), role]
  );

  if (role === 'cashier' && Array.isArray(body.permissions)) {
    for (const perm of [...new Set(body.permissions)]) {
      await query('INSERT INTO user_permissions (user_id, permission) VALUES ($1, $2)', [
        rows[0].id,
        perm,
      ]);
    }
  }
  return ok({ id: rows[0].id }, 201);
}
