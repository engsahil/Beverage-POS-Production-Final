-- =============================================================
-- Beverage POS — schema 009: complete customer ledger + measured indexes
-- ADDITIVE ONLY. Safe to re-run. Never destructive:
--   * no table, column or row is dropped;
--   * the one constraint touched is re-created with a SUPERSET of its
--     previous values, so every existing row stays valid (same pattern
--     already used by 007 for sales.pricing_mode).
--
-- 1) LEDGER TYPES
--    customer_transactions could already store 'sale', 'payment' and
--    'adjustment', but nothing could create an opening balance and nothing
--    could create an adjustment at all — the ledger had no way to start an
--    account or to correct one. 'opening_balance' is added as an explicit
--    type so an account's starting position is self-describing in the
--    history instead of being buried in a note.
--
-- 2) INDEXES — added only where a measured query pattern needed them
--    (verified with EXPLAIN against a 9k-sale / 1k-ledger-row database):
--      * customer_transactions(created_at)
--          lib/finance.js filters the ledger by business date on every
--          Finance screen (accounts, balance sheet, cash flow). Without an
--          index each of those scans the whole ledger.
--      * purchase_payments(payment_date)
--          the same finance queries filter vendor payments by date; the
--          existing indexes only cover purchase_id / vendor_id.
--    Deliberately NOT added: products(name) (the ORDER BY sorts <1000 rows
--    in memory in <1 ms) and sales(customer_id) (only used by a NOT EXISTS
--    in the admin data-clear tool, never on a hot path).
-- =============================================================

-- 1) Ledger entry types: 'opening_balance' joins the existing three.
ALTER TABLE customer_transactions DROP CONSTRAINT IF EXISTS customer_transactions_type_check;
ALTER TABLE customer_transactions
  ADD CONSTRAINT customer_transactions_type_check
  CHECK (type IN ('sale', 'payment', 'adjustment', 'opening_balance'));

-- 2) Indexes for the date-filtered finance aggregations.
CREATE INDEX IF NOT EXISTS customer_transactions_created_idx ON customer_transactions(created_at);
CREATE INDEX IF NOT EXISTS purchase_payments_date_idx ON purchase_payments(payment_date);
