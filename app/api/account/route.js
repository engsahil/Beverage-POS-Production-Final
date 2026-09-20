// GET  /api/account  -> my profile
// POST /api/account  -> change my username / name / password
// Password changes always require the current password.
import { query } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/password';
import { readJson, str, fail, ok } from '@/lib/validate';

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  // permissions already come from the session (array_agg, no extra query)
  const { permissions, ...rest } = auth.user;
  return ok({ ...rest, permissions: rest.role === 'admin' ? null : permissions });
}

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,30}$/;

export async function POST(req) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');

  const rows = await query('SELECT * FROM users WHERE id = $1', [auth.user.id]);
  const user = rows[0];
  if (!user) return fail('Account not found.', 404);

  const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  if (!verifyPassword(current, user.password_hash)) {
    return fail('Current password is incorrect.');
  }

  let changed = false;

  if (body.newUsername !== undefined) {
    const newUsername = str(body.newUsername, { max: 30 });
    if (!newUsername || !USERNAME_RE.test(newUsername)) {
      return fail('Username must be 3-30 characters: letters, numbers, dot, dash or underscore.');
    }
    if (newUsername !== user.username) {
      const dupe = await query('SELECT id FROM users WHERE username = $1 AND id <> $2', [
        newUsername,
        user.id,
      ]);
      if (dupe.length > 0) return fail('That username is already in use.', 409);
      await query('UPDATE users SET username = $1 WHERE id = $2', [newUsername, user.id]);
      changed = true;
    }
  }

  if (body.fullName !== undefined) {
    const fullName = str(body.fullName, { max: 80 });
    if (fullName !== null) {
      await query('UPDATE users SET full_name = $1 WHERE id = $2', [fullName, user.id]);
      changed = true;
    }
  }

  if (body.newPassword !== undefined) {
    if (typeof body.newPassword !== 'string' || body.newPassword.length < 6) {
      return fail('New password must be at least 6 characters.');
    }
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      hashPassword(body.newPassword),
      user.id,
    ]);
    changed = true;
  }

  if (!changed) return fail('Nothing to update.');
  return ok(null);
}
