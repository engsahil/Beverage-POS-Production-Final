// Client-side API helper.
// - Predictable error format, expired-session handling.
// - GET responses are cached for a short TTL (8s) and deduped while in flight:
//   revisiting a screen inside the window renders instantly with zero network,
//   and two components asking for the same endpoint at once share one request.
//   The cache stores the parsed payload (callers must treat it as read-only —
//   concurrent callers already shared one object through the in-flight map).
//   It used to store a JSON string, which meant re-serialising the whole
//   catalogue on every fetch and re-parsing it on every hit: ~5 ms of pure
//   CPU per product-list read, on the POS's hottest path.
// - Any successful mutation (POST/PUT/DELETE) clears the whole GET cache, so no
//   screen can show data older than the user's last change (correctness first).
// - Pollers and manual refresh pass { fresh: true } to bypass the cache.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const GET_TTL_MS = 8000;
const getCache = new Map(); // path -> { value, t }
const inflight = new Map(); // path -> Promise

/** Drop all cached GETs (called after mutations; exposed for tests). */
export function clearApiCache() {
  getCache.clear();
}

async function doFetch(path, { method, body }) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  let text = null;
  try {
    text = await res.text();
  } catch {
    // no body
  }
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // not JSON
    }
  }
  if (!res.ok || !data || data.ok === false) {
    const fallback =
      res.status === 401 ? 'Session expired. Please log in again.' : 'Something went wrong. Please try again.';
    throw new ApiError(data?.error || fallback, res.status);
  }
  // Only the inner payload is cached (never the { ok, data } envelope), so a
  // cache hit returns exactly what a fresh fetch returns.
  return data.data;
}

export async function api(path, { method = 'GET', body, fresh = false } = {}) {
  const useCache = method === 'GET' && !fresh;

  if (useCache) {
    const hit = getCache.get(path);
    if (hit && Date.now() - hit.t < GET_TTL_MS) return hit.value;
    const pending = inflight.get(path);
    if (pending) return pending;
  }

  const run = (async () => {
    try {
      const data = await doFetch(path, { method, body });
      if (useCache) {
        getCache.set(path, { value: data, t: Date.now() });
      } else if (method !== 'GET') {
        // A write happened — anything cached may now be stale.
        getCache.clear();
      }
      return data;
    } finally {
      inflight.delete(path);
    }
  })();

  if (useCache) inflight.set(path, run);
  return run;
}

// Build and download a CSV file from { columns, rows }.
// columns: [{ key, label }], rows: [{ key: value }]
export function downloadCsv(filename, columns, rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [
    columns.map((c) => esc(c.label)).join(','),
    ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(',')),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
