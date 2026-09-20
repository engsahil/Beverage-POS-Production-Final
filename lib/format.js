// Small formatting helpers for the client. No dependencies.

export function formatMoney(value, currency = 'Rs') {
  const n = Number(value || 0);
  const abs = Math.abs(n).toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? '-' : ''}${currency} ${abs}`;
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** 3 -> "3", 1.5 -> "1.5", 1.50 -> "1.5" */
export function formatQty(n) {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

export function formatDate(iso, tz) {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: tz,
    });
  } catch {
    return String(iso || '').slice(0, 10);
  }
}

export function formatTime(iso, tz) {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: tz,
    });
  } catch {
    return String(iso || '').slice(11, 16);
  }
}

/** Local date as YYYY-MM-DD (browser timezone). */
export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateStr(d);
}

/**
 * Business date (YYYY-MM-DD) in the STORE's timezone, optionally shifted by
 * offsetDays. Server-side date filters use the store timezone, so default
 * filter ranges must too — otherwise "today's" sales can be out of range.
 */
export function storeDateStr(tz, offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  try {
    return d.toLocaleDateString('en-CA', { timeZone: tz });
  } catch {
    return localDateStr(d);
  }
}
