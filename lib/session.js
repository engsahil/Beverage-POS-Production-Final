// Session + authentication helpers.
// Sessions are random tokens stored in the database and sent as an
// httpOnly cookie. Simple, stateless on the server, no JWT needed.
import { cache } from 'react';
import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { query } from './db.js';

export const SESSION_COOKIE = 'bevsp_session';
export const SESSION_TTL_DAYS = 7;

export function sessionCookieOptions(token) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  };
}

export function clearSessionCookieOptions() {
  return {
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  };
}

/** Create a new session row for a user. Returns the token. */
export async function createSession(userId) {
  const token = randomBytes(24).toString('hex');
  // Opportunistically purge expired sessions (tiny table, keeps it clean).
  await query('DELETE FROM sessions WHERE expires_at < now()');
  await query(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))',
    [token, userId, SESSION_TTL_DAYS]
  );
  return token;
}

/**
 * The current user for this request, or null.
 * Wrapped in React cache() so a request only queries once.
 */
export const getSessionUser = cache(async () => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await query(
    `SELECT u.id, u.username, u.full_name, u.role,
            COALESCE(array_agg(DISTINCT up.permission) FILTER (WHERE up.permission IS NOT NULL), '{}')::text[] AS permissions
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN user_permissions up ON up.user_id = u.id
      WHERE s.token = $1 AND s.expires_at > now() AND u.active
      GROUP BY u.id`,
    [token]
  );
  return rows[0] || null;
});

/** Delete the caller's session (logout). */
export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await query('DELETE FROM sessions WHERE token = $1', [token]);
    } catch (err) {
      console.error('[auth] failed to delete session:', err.message);
    }
  }
}
