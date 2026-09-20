-- =============================================================
-- Beverage POS — schema 006: pricing modes + cashier price limits
-- ADDITIVE ONLY. Safe to re-run (IF NOT EXISTS everywhere).
-- Never destructive: no DROP/ALTER of existing columns.
--
-- Pricing model:
--   retail    = products.price / product_variants.price (existing)
--   wholesale = products.wholesale_price / product_variants.wholesale_price
--   special   = products.special_price / product_variants.special_price
-- A NULL / 0 mode price means "not configured" and falls back to the
-- retail price, so existing data and behavior are unchanged.
--
-- cashier_price_limits: admin-configured minimum selling prices per
-- cashier and per pricing mode. NULL = no limit for that mode.
-- Admins are never limited (enforced in the sales API).
--
-- sales.pricing_mode / sale_items.pricing_mode: the mode actually used
-- when the sale happened. Existing rows default to 'retail', which is
-- historically correct (the mode did not exist before this migration).
-- sale_items.unit_price already snapshots the applied price, so history
-- stays accurate when product prices change later.
-- =============================================================

-- 1) Product-level mode prices (plain products). Nullable = optional.
ALTER TABLE products ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(12,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS special_price   NUMERIC(12,2);

-- 2) Variant-level special price (wholesale_price already exists on
--    product_variants and is reused as-is; 0 = not configured).
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS special_price NUMERIC(12,2);

-- 3) Per-cashier minimum prices per mode (admin-only configuration).
CREATE TABLE IF NOT EXISTS cashier_price_limits (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  retail_min    NUMERIC(12,2),
  wholesale_min NUMERIC(12,2),
  special_min   NUMERIC(12,2),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4) Record the applied pricing mode on the sale and on each line.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS pricing_mode TEXT NOT NULL DEFAULT 'retail'
  CHECK (pricing_mode IN ('retail', 'wholesale', 'special'));
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS pricing_mode TEXT NOT NULL DEFAULT 'retail'
  CHECK (pricing_mode IN ('retail', 'wholesale', 'special'));
