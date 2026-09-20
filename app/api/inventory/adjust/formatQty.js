// Small formatting helper for server-side messages.
export function formatQtySafe(n) {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}
