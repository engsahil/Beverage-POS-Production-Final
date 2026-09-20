-- =============================================================
-- 003_dual_receipt_variants — ADDITIVE ONLY migration.
-- Supports: (a) dual receipt printing (customer + kitchen KOT)
-- by recording the table number and kitchen notes on the sale,
-- and (b) product size/variant options (name + price, stored as
-- a JSONB array on the product).
-- Existing data is never modified or removed.
-- =============================================================

-- Sales: table number (dining) + kitchen/order notes.
-- Both are optional; receipts show real values only (no defaults
-- that could look like real table numbers).
ALTER TABLE sales ADD COLUMN IF NOT EXISTS table_no TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';

-- Sale items: size/variant label as sold (e.g. "100 ml", "Large").
-- NULL/'' for products without variants.
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS variant TEXT;

-- Products: optional size/variant options, e.g.
--   [{"name": "50 ml", "price": 50}, {"name": "100 ml", "price": 80}]
-- NULL = product has no variants (legacy behaviour unchanged).
-- Kept as JSONB (validated server-side) so the POS already has the
-- data in the product list — no extra queries or joins.
ALTER TABLE products ADD COLUMN IF NOT EXISTS variants JSONB;
