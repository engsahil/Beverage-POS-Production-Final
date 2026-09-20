// Password hashing using Node's built-in scrypt.
// No external dependency. Stored format: "scrypt:<salt hex>:<hash hex>"
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split(':');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const check = scryptSync(String(password), salt, 64);
    return timingSafeEqual(Buffer.from(hash, 'hex'), check);
  } catch {
    return false;
  }
}
