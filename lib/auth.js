// Authorization guards for API routes.
import { getSessionUser } from './session.js';
import { fail } from './validate.js';

const SESSION_EXPIRED = 'Session expired. Please log in again.';
const FORBIDDEN = 'You do not have permission to do this.';

/** Require any logged-in user. Returns { user } or { error: Response }. */
export async function requireUser() {
  const user = await getSessionUser();
  if (!user) return { error: fail(SESSION_EXPIRED, 401) };
  return { user };
}

/** Require an admin. Returns { user } or { error: Response }. */
export async function requireAdmin() {
  const auth = await requireUser();
  if (auth.error) return auth;
  if (auth.user.role !== 'admin') return { error: fail(FORBIDDEN, 403) };
  return { user: auth.user };
}
