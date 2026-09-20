// Small shared helpers for API routes: predictable responses,
// input coercion and a typed HTTP error for inside transactions.
import { NextResponse } from 'next/server';

/** 2xx response: { ok: true, data } */
export function ok(data, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
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
