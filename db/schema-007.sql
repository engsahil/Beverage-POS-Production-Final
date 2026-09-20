-- =============================================================
-- Beverage POS — schema 007: per-line pricing modes
--
-- The POS now applies a pricing mode per cart line (each line of a
-- sale may use a different mode). sale_items.pricing_mode already
-- records the mode per line; this migration only widens the
-- SALE-LEVEL summary column so a heterogeneous sale can be stored
-- as 'mixed' (the per-line values remain the source of truth).
--
-- Non-destructive: constraint is re-added with a superset of values;
-- no data is touched. Existing 'retail'/'wholesale'/'special' rows
-- are unchanged and remain valid.
-- =============================================================

ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_pricing_mode_check;
ALTER TABLE sales ADD CONSTRAINT sales_pricing_mode_check
  CHECK (pricing_mode IN ('retail', 'wholesale', 'special', 'mixed'));
