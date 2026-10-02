-- =============================================================
-- Beverage POS — schema 010: vendor opening balance (payable & receivable)
-- and vendor-level payment support
-- ADDITIVE ONLY. Safe to re-run. Never destructive.
-- =============================================================

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS opening_balance_type TEXT NOT NULL DEFAULT 'payable' CHECK (opening_balance_type IN ('payable', 'receivable'));
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS opening_balance_note TEXT NOT NULL DEFAULT '';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS opening_balance_date DATE;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS opening_balance_updated_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS opening_balance_updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE purchase_payments ALTER COLUMN purchase_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS vendors_opening_balance_idx ON vendors(opening_balance) WHERE opening_balance > 0;
