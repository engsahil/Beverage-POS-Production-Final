// POST /api/auth/login  { username, password }
import { query } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { createSession, sessionCookieOptions } from '@/lib/session';
import { readJson, str, fail, ok } from '@/lib/validate';

export async function POST(req) {
  const body = await readJson(req);
  if (!body) return fail('Invalid request.');
  const username = str(body.username, { max: 60 });
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) return fail('Enter your username and password.');

  const rows = await query('SELECT * FROM users WHERE username = $1', [username]);
  const user = rows[0];

  if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
    console.warn('[auth] failed login for username:', username);
    return fail('Invalid username or password.', 401);
  }

  const token = await createSession(user.id);
  const permRows =
    user.role === 'admin'
      ? []
      : await query(
          `SELECT COALESCE(array_agg(DISTINCT permission), '{}')::text[] AS perms
             FROM user_permissions WHERE user_id = $1`,
          [user.id]
        );
  const permissions = user.role === 'admin' ? [] : (permRows[0]?.perms || []);
  const res = ok({
    username: user.username,
    role: user.role,
    name: user.full_name,
    permissions,
  });
  res.cookies.set(sessionCookieOptions(token));
  return res;
}
