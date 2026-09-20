-- =============================================================
-- 004_full_variants — ADDITIVE ONLY migration.
-- Promotes product size/variant options from the lightweight
-- Phase-4 JSONB (name + price) to first-class rows where each
-- variant independently owns price, cost, stock, SKU, barcode,
-- tax, discount, min/reorder, expiry, batch, supplier, image
-- and status.
--
-- Legacy data is preserved:
--   * products.variants JSONB rows are copied into
--     product_variants (name + price, plus the product's
--     cost/expiry as sensible starting values).
--   * the legacy single stock pool of a variant product is
--     carried by its FIRST variant (the pool cannot be split
--     per size); other migrated variants start at stock 0 and
--     can be redistributed via stock adjustments.
--   * products.variants JSONB is kept (read-only legacy copy)
--     so nothing existing is removed.
-- =============================================================

CREATE TABLE IF NOT EXISTS product_variants (
  id              SERIAL PRIMARY KEY,
  product_id      INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  unit            TEXT NOT NULL DEFAULT '',
  sku             TEXT NOT NULL DEFAULT '',
  barcode         TEXT NOT NULL DEFAULT '',
  price           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  wholesale_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (wholesale_price >= 0),
  retail_price    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (retail_price >= 0),
  cost            NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  tax_rate        NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  discount_pct    NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  stock           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (stock >= 0),
  min_stock       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  reorder_level   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  expiry_date     DATE,
  batch_no        TEXT NOT NULL DEFAULT '',
  supplier_id     INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  image_data      BYTEA,
  image_mime      TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, name)
);
CREATE INDEX IF NOT EXISTS product_variants_product_idx ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS product_variants_expiry_idx ON product_variants(expiry_date);
CREATE INDEX IF NOT EXISTS product_variants_barcode_idx ON product_variants(barcode);

-- Sale items: which variant row was sold (label + price already
-- snapshot the display name and charged price for receipts).
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sale_items_variant_idx ON sale_items(variant_id);

-- Stock movements: optional variant-level traceability.
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL;

-- Purchase lines can receive stock into a specific variant, with
-- per-batch expiry + batch number (batch tracking stays optional).
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS batch_no TEXT NOT NULL DEFAULT '';

-- ---- One-time data migration (idempotent) ---------------------
-- Copy existing JSONB variants into product_variants for products
-- that do not have variants yet. Duplicate names (case-insensitive,
-- which Phase-4 validation prevented) are collapsed to the first.
INSERT INTO product_variants
  (product_id, name, price, cost, expiry_date, stock, sort_order)
SELECT DISTINCT ON (p.id, lower(g.name))
  p.id,
  g.name,
  g.price,
  p.cost,
  p.expiry_date,
  -- legacy shared pool: first variant carries the pool, rest start at 0
  CASE WHEN g.rownum = 1 THEN p.stock ELSE 0 END,
  g.rownum - 1
FROM products p
CROSS JOIN LATERAL (
  SELECT v.el->>'name' AS name, COALESCE((v.el->>'price')::numeric, p.price) AS price, v.rownum
  FROM jsonb_array_elements(p.variants) WITH ORDINALITY AS v(el, rownum)
) g
WHERE p.variants IS NOT NULL
  AND g.name IS NOT NULL AND g.name <> ''
  AND NOT EXISTS (SELECT 1 FROM product_variants x WHERE x.product_id = p.id)
ORDER BY p.id, lower(g.name), g.rownum;
