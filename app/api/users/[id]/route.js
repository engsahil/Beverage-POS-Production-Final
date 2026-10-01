// PUT /api/users/:id  -> update name / role / active / reset password (admin)
import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { hashPassword } from '@/lib/password';
import { PERMISSIONS } from '@/lib/permissions';
import { readJson, str, fail, ok } from '@/lib/validate';

async function countActiveAdmins() {
  const rows = await query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND active");
  return rows[0].n;
}

export async function PUT(req, { params }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId)) return fail('Invalid user id.', 404);

  const rows = await query('SELECT * FROM users WHERE id = $1', [targetId]);
  const target = rows[0];
  if (!target) return fail('User not found.', 404);

  const body = await readJson(req);
  if (!body) return fail('Invalid request.');
  const isSelf = target.id === auth.user.id;

  // Role changes
  if (body.role !== undefined && body.role !== target.role) {
    if (isSelf) return fail('You cannot change your own role.');
    const newRole = body.role === 'admin' ? 'admin' : 'cashier';
    if (target.role === 'admin' && newRole !== 'admin' && (await countActiveAdmins()) <= 1) {
      return fail('At least one active admin is required.');
    }
    await query('UPDATE users SET role = $1 WHERE id = $2', [newRole, target.id]);
  }

  // Active toggle
  if (typeof body.active === 'boolean' && body.active !== target.active) {
    if (!body.active) {
      if (isSelf) return fail('You cannot deactivate your own account.');
      if (target.role === 'admin' && (await countActiveAdmins()) <= 1) {
        return fail('At least one active admin is required.');
      }
    }
    await query('UPDATE users SET active = $1 WHERE id = $2', [body.active, target.id]);
  }

  // Name
  if (body.fullName !== undefined) {
    const fullName = str(body.fullName, { max: 80 });
    if (fullName !== null) {
      await query('UPDATE users SET full_name = $1 WHERE id = $2', [fullName, target.id]);
    }
  }

  // Password reset (admin sets a new one)
  if (body.newPassword !== undefined) {
    if (typeof body.newPassword !== 'string' || body.newPassword.length < 6) {
      return fail('New password must be at least 6 characters.');
    }
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      hashPassword(body.newPassword),
      target.id,
    ]);
  }

  // Explicit permissions (cashiers only; admins always have all)
  if (Array.isArray(body.permissions)) {
    for (const perm of body.permissions) {
      if (typeof perm !== 'string' || !PERMISSIONS.includes(perm)) return fail('Unknown permission.');
    }
    const list = [...new Set(body.permissions)];
    await query('DELETE FROM user_permissions WHERE user_id = $1', [target.id]);
    // ONE multi-row insert (was one round trip per permission).
    if (list.length) {
      const params = [];
      const ph = [];
      for (const perm of list) {
        params.push(target.id, perm);
        ph.push(`($${params.length - 1}, $${params.length})`);
      }
      await query(
        `INSERT INTO user_permissions (user_id, permission) VALUES ${ph.join(', ')}`,
        params
      );
    }
  }

  return ok(null);
}
