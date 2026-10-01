// Small shared helpers for API routes: predictable responses,
// input coercion and a typed HTTP error for inside transactions.
import { NextResponse } from 'next/server';
import { gzipSync } from 'node:zlib';

/** 2xx response: { ok: true, data } */
export function ok(data, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

// Payloads below this size are not worth compressing: the ~0.1 ms of CPU and
// the extra header cost more than the bytes saved.
const MIN_GZIP_BYTES = 1024;
const GZIP_LEVEL = 6; // 607 KB catalogue -> 37 KB in ~4 ms (measured)

/**
 * JSON response with gzip applied when the client accepts it.
 *
 * Next.js 15's built-in server no longer compresses route-handler responses
 * (the `compress` option is a no-op there), so without this a deployed
 * instance ships the full product catalogue — ~600 KB for a 800-product
 * store — uncompressed on every POS poll. Measured on this codebase:
 * 607 KB -> 37 KB (-94%) for ~4 ms of CPU, which is a clear win on any real
 * network and roughly break-even on localhost.
 *
 * Pass the route's `req` so the client's Accept-Encoding can be honoured;
 * a response is never compressed for a client that did not ask for it.
 */
export function okGzip(data, req, status = 200) {
  const body = JSON.stringify({ ok: true, data });
  const accepts =
    typeof req?.headers?.get === 'function' ? req.headers.get('accept-encoding') || '' : '';
  if (body.length >= MIN_GZIP_BYTES && /\bgzip\b|\*\s*\/\s*\*/.test(accepts)) {
    return new NextResponse(gzipSync(Buffer.from(body), { level: GZIP_LEVEL }), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        // Required so any shared cache does not hand a gzipped body to a
        // client that cannot read it.
        Vary: 'Accept-Encoding',
      },
    });
  }
  return new NextResponse(body, { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Error response: { ok: false, error: "user friendly message" }
 * An optional data payload (e.g. per-row import errors) is added as `data`.
 */
export function fail(message, status = 400, data) {
  const payload = { ok: false, error: message };
  if (data !== undefined) payload.data = data;
  return NextResponse.json(payload, { status });
}

/**
 * Error thrown inside withTransaction to abort + roll back with a message.
 * An optional data payload can be returned to the client (e.g. row errors).
 */
export class HttpError extends Error {
  constructor(message, status = 400, data) {
    super(message);
    this.status = status;
    if (data !== undefined) this.data = data;
  }
}

/** Parse a JSON request body. Returns null on failure. */
export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** Coerce to a finite number, or null. */
export function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value.trim());
  }
  return null;
}

/** Trimmed string limited to max length, or null. */
export function str(value, { max = 200 } = {}) {
  return typeof value === 'string' ? value.trim().slice(0, max) : null;
}

/** Validate a YYYY-MM-DD date string. */
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Wrap a withTransaction call: convert HttpError into a clean
 * fail() response and unexpected errors into a generic 500.
 */
export async function runTransaction(fn, genericError) {
  try {
    const { withTransaction } = await import('./db.js');
    const result = await withTransaction(fn);
    return { result };
  } catch (err) {
    if (err instanceof HttpError) return { response: fail(err.message, err.status) };
    console.error('[db] transaction failed:', err);
    return { response: fail(genericError || 'Unable to complete the request. Please try again.', 500) };
  }
}
