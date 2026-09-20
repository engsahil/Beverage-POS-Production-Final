-- 008_product_variant_min_prices (additive, non-destructive)
--
-- Admin-configurable minimum selling price per pricing mode (retail /
-- wholesale / special) for each product AND each of its variants, with an
-- ON/OFF protection switch.
--
-- Semantics (enforced server-side in /api/sales):
--   * min_price_enabled = FALSE (default) -> the three minimums are ignored
--     (no protection at this level); all other rules are unchanged.
--   * min_price_enabled = TRUE and a mode minimum is set -> that value is a
--     HARD floor for that mode: no sale line (with or without a discount)
--     may be priced below it. NULL = no minimum configured for that mode.
--   * The effective floor of a line is the MAXIMUM of every configured,
--     enabled restriction that applies to it:
--       - the cashier's user-level minimum for the mode (cashier_price_limits)
--       - the product's minimum for the mode (this table)
--       - the line's variant's minimum for the mode (product_variants)
--     so enabling one level never weakens another.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS min_price_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS min_retail    NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS min_wholesale NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS min_special   NUMERIC(12,2);

ALTER TABLE products
  ADD CONSTRAINT products_min_retail_chk    CHECK (min_retail    IS NULL OR min_retail    >= 0),
  ADD CONSTRAINT products_min_wholesale_chk CHECK (min_wholesale IS NULL OR min_wholesale >= 0),
  ADD CONSTRAINT products_min_special_chk   CHECK (min_special   IS NULL OR min_special   >= 0);

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS min_price_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS min_retail    NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS min_wholesale NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS min_special   NUMERIC(12,2);

ALTER TABLE product_variants
  ADD CONSTRAINT product_variants_min_retail_chk    CHECK (min_retail    IS NULL OR min_retail    >= 0),
  ADD CONSTRAINT product_variants_min_wholesale_chk CHECK (min_wholesale IS NULL OR min_wholesale >= 0),
  ADD CONSTRAINT product_variants_min_special_chk   CHECK (min_special   IS NULL OR min_special   >= 0);
