// Inventory valuation — the single authoritative definition of "stock value
// at cost" for the whole application.
//
// The catalogue is a hierarchy:
//     category  ->  product  ->  variant (size: 500 ml, 1000 ml, ...)
//
// A variant row owns its OWN stock and its OWN cost. For a sized product
// `products.stock` is only a mirror of SUM(variant.stock) (kept in sync by
// every write path) and `products.cost` is a single product-level figure that
// says nothing about the individual sizes — it is frequently 0 for products
// that were created with sizes, because the real costs live on the sizes.
//
// Therefore the value at cost of one product is:
//   * SUM(variant.stock * variant.cost) over its variant rows  — when it has any
//   * products.stock * products.cost                           — when it has none
// and NEVER both: for a sized product the mirror column already contains the
// sizes' stock, so adding the product-level figure would count the same
// physical stock twice.
//
// Every screen that shows a stock value (dashboard, inventory, reports,
// balance sheet) must use these helpers so the numbers can never disagree.
// All arithmetic stays in SQL on NUMERIC columns — money never travels as a
// float until the response boundary converts it with Number().
//
// NOTE: round2 comes from format.js (dependency-free, client-safe) — never
// from validate.js, which transitively loads pg (Node-only). This module is
// imported by both the API routes and the browser bundle.
import { round2 } from './format.js';

/**
 * LATERAL aggregate over a product's variant rows.
 * Join it once per product query; it is index-backed by
 * product_variants_product_idx and replaces the per-row correlated subqueries
 * the callers used to issue.
 *
 * @param {string} alias products table alias, e.g. 'p'
 * @param {string} out   alias for the aggregate, e.g. 'v'
 */
export function variantAggregate(alias = 'p', out = 'v') {
  return `LEFT JOIN LATERAL (
            SELECT COUNT(*)::int               AS variant_count,
                   COUNT(*) FILTER (WHERE v.active)::int AS active_variants,
                   COALESCE(SUM(v.stock), 0)   AS variant_stock,
                   COALESCE(SUM(v.stock * v.cost), 0) AS variant_value
              FROM product_variants v
             WHERE v.product_id = ${alias}.id
          ) ${out} ON TRUE`;
}

/**
 * SQL expression: value at cost of one product row (variant aware).
 * Requires the LATERAL from variantAggregate() with the same aliases.
 */
export function stockValueExpr(alias = 'p', out = 'v') {
  return `CASE WHEN ${out}.variant_count > 0 THEN ${out}.variant_value
               ELSE ${alias}.stock * ${alias}.cost END`;
}

/**
 * SQL expression: effective unit cost of one product row.
 * For a sized product this is the stock-weighted average of its sizes
 * (unit cost x stock = value, up to rounding); for a plain product it is the
 * product's own cost. Zero stock yields 0 rather than a division by zero.
 */
export function unitCostExpr(alias = 'p', out = 'v') {
  return `CASE WHEN ${out}.variant_count > 0
               THEN CASE WHEN ${out}.variant_stock > 0
                         THEN ROUND(${out}.variant_value / ${out}.variant_stock, 2)
                         ELSE 0 END
               ELSE ${alias}.cost END`;
}

/**
 * Total inventory value at cost across a set of products, in one pass.
 * `where` is an optional WHERE clause WITHOUT the leading keyword
 * (e.g. "p.active"). NULL/zero costs are handled by COALESCE/SUM.
 *
 * @returns {{ sql: string, params: unknown[] }}
 */
export function inventoryValueQuery({ where = '', params = [] } = {}) {
  return {
    sql: `SELECT COUNT(*)::int                                          AS products,
                 COUNT(*) FILTER (WHERE ${stockValueExpr('p', 'v')} = 0)::int AS zero_value,
                 COALESCE(SUM(${stockValueExpr('p', 'v')}), 0)          AS stock_value
            FROM products p
            ${variantAggregate('p', 'v')}
            ${where ? `WHERE ${where}` : ''}`,
    params,
  };
}

/**
 * Client-side counterpart: value at cost of one product object as returned by
 * GET /api/products. Used for filtered/scope subtotals in the UI so a
 * filtered view always matches the same rule the server applies.
 * Accepts null/undefined/blank cost and stock safely; zero costs count as 0.
 */
export function productStockValue(p) {
  if (!p) return 0;
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const variants = Array.isArray(p.variants) ? p.variants : [];
  if (variants.length > 0) {
    return round2(variants.reduce((s, v) => s + num(v.stock) * num(v.cost), 0));
  }
  return round2(num(p.stock) * num(p.cost));
}
