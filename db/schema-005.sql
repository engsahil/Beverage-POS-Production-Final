-- 005: Phase 5 — vendor invoice payments, payment methods on customer payments
-- and expenses, attachments, branding (logo), license state, sales goals.
-- ADDITIVE ONLY. No column is dropped or renamed; existing data is preserved.
--
-- Design notes:
--   * Legacy expense rows have method = NULL ("not recorded"). New rows
--     always carry a method. Reports show NULL as "unspecified" instead of
--     guessing — no fabricated values.
--   * Legacy customer payment rows have method = NULL for the same reason.
--   * Purchases gain an explicit due_date (purchase_date + 30 for existing
--     rows) so the Overdue status is honest per invoice.

BEGIN;

-- 1) Vendor invoice payments: multiple partial payments per purchase.
CREATE TABLE purchase_payments (
  id SERIAL PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','bank','card')),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_purchase_payments_purchase ON purchase_payments(purchase_id);
CREATE INDEX idx_purchase_payments_vendor ON purchase_payments(vendor_id);

-- 2) Purchase due date (for the Overdue status).
ALTER TABLE purchases ADD COLUMN due_date DATE;
UPDATE purchases SET due_date = purchase_date + 30;
ALTER TABLE purchases ALTER COLUMN due_date SET NOT NULL;
ALTER TABLE purchases ALTER COLUMN due_date SET DEFAULT CURRENT_DATE;

-- 3) Expense detail: payment method/account, payee, reference, attachment.
ALTER TABLE expenses ADD COLUMN method TEXT CHECK (method IN ('cash','bank','card'));
ALTER TABLE expenses ADD COLUMN payee TEXT NOT NULL DEFAULT '';
ALTER TABLE expenses ADD COLUMN reference TEXT NOT NULL DEFAULT '';
ALTER TABLE expenses ADD COLUMN attachment_name TEXT;
ALTER TABLE expenses ADD COLUMN attachment_data BYTEA;
ALTER TABLE expenses ADD COLUMN attachment_mime TEXT;

-- 4) Customer payment method (which account a recovery hits).
ALTER TABLE customer_transactions ADD COLUMN method TEXT CHECK (method IN ('cash','bank','card'));

-- 5) Purchase invoice attachment (survives payment edits).
ALTER TABLE purchases ADD COLUMN attachment_name TEXT;
ALTER TABLE purchases ADD COLUMN attachment_data BYTEA;
ALTER TABLE purchases ADD COLUMN attachment_mime TEXT;

-- 6) Branding (logo), license state, sales goals (Today / Streak / Monthly).
ALTER TABLE business_settings ADD COLUMN logo_data BYTEA;
ALTER TABLE business_settings ADD COLUMN logo_mime TEXT;
ALTER TABLE business_settings ADD COLUMN logo_updated_at TIMESTAMPTZ;
ALTER TABLE business_settings ADD COLUMN license_activated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE business_settings ADD COLUMN license_name TEXT;
ALTER TABLE business_settings ADD COLUMN daily_sales_goal NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE business_settings ADD COLUMN monthly_sales_goal NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMIT;
