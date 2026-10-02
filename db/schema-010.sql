-- =============================================================
-- Beverage POS — schema 010: vendor opening balance
-- ADDITIVE ONLY. Safe to re-run. Never destructive.
--
-- Vendor accounts must support an Opening Balance that:
--   * persists in the Vendors table
--   * appears in the ledger history as a distinct entry
--   * is included in payable / outstanding calculations
--   * participates in running balance
--   * handles decimals, zero (clear), and invalid inputs
--   * respects the existing accounting convention (credit = we owe)
--   * is auditable (note, date, who and when it was set)
--
-- Design: a set of columns on vendors rather than a second ledger
-- table, because the vendor ledger is already a derived view over
-- purchases + purchase_payments + settled claims. Adding a full
-- vendor_transactions table would duplicate the existing financial
-- architecture; a column keeps the single source of truth (the
-- purchases) while making the carried-forward balance explicit and
-- auditable. The columns are all optional (DEFAULT 0 / '' / NULL) so
-- existing rows stay valid and no data is invented.
-- =============================================================

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS opening_balance_note TEXT NOT NULL DEFAULT '';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS opening_balance_date DATE;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS opening_balance_updated_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS opening_balance_updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS vendors_opening_balance_idx ON vendors(opening_balance) WHERE opening_balance > 0;
