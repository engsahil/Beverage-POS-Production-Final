// POST /api/auth/logout
import { destroySession, clearSessionCookieOptions } from '@/lib/session';
import { ok } from '@/lib/validate';

export async function POST() {
  await destroySession();
  const res = ok(null);
  res.cookies.set(clearSessionCookieOptions());
  return res;
}
