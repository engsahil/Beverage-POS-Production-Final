// Pricing modes shared by the POS (client) and the sales API (server).
//
// Modes:
//   retail    -> the product/variant selling price (existing behavior)
//   wholesale -> wholesale_price when configured (> 0), else retail
//   special   -> special_price (Sale / Special) when configured (> 0), else retail
//
// The server is authoritative: the POS only uses this for display and
// instant feedback. The sales endpoint re-derives the price from the
// database with the same function and enforces the cashier's minimum
// prices, so a manipulated client can never change the applied price.
// NOTE: import round2 from format.js (dependency-free, client-safe) —
// never from validate.js, which transitively loads pg (Node-only).
import { round2 } from './format.js';

export const PRICING_MODES = ['retail', 'wholesale', 'special'];

export const PRICING_MODE_LABELS = {
  retail: 'Retail',
  wholesale: 'Wholesale',
  special: 'Sale / Special',
  mixed: 'Mixed', // sale-level summary only (lines may use different modes)
};

/** Sale-level summary for a set of per-line modes. */
export function summarizeModes(modes) {
  if (!modes || modes.length === 0) return 'retail';
  const first = modes[0];
  return modes.every((m) => m === first) ? first : 'mixed';
}

export function normalizePricingMode(mode) {
  return PRICING_MODES.includes(mode) ? mode : 'retail';
}

/**
 * Applied unit price for a line in a pricing mode.
 * row: { price, discount_pct?, wholesale_price?, special_price? }
 * (plain products simply omit discount_pct / wholesale / special).
 * A missing/0 mode price falls back to the retail price so products that
 * only have a retail price keep working in every mode.
 */
export function priceForMode(row, mode) {
  const m = normalizePricingMode(mode);
  const retail = round2(Number(row.price) * (100 - (Number(row.discount_pct) || 0)) / 100);
  if (m === 'wholesale') {
    const w = Number(row.wholesale_price);
    return Number.isFinite(w) && w > 0 ? round2(w) : retail;
  }
  if (m === 'special') {
    const s = Number(row.special_price);
    return Number.isFinite(s) && s > 0 ? round2(s) : retail;
  }
  return retail;
}

/**
 * The admin-configured minimum selling price for a product/variant row in a
 * pricing mode, or null when protection is OFF at that level or no minimum
 * is configured for the mode.
 * row: { min_price_enabled?, min_retail?, min_wholesale?, min_special? }
 */
export function minForMode(row, mode) {
  if (!row || row.min_price_enabled !== true) return null;
  const m = normalizePricingMode(mode);
  const v = row[`min_${m}`];
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? round2(n) : null;
}
