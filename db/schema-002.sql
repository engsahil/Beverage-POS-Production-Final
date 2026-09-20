-- =============================================================
-- 002_features — ADDITIVE ONLY migration.
-- Extends products (min price, expiry, image), adds customers,
-- customer ledger, shifts, vendor claims, expenses and user
-- permissions. Existing data is never modified or removed.
-- =============================================================

-- Products: minimum selling price, expiry, stored image
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (min_price >= 0);
ALTER TABLE products ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_data BYTEA;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_mime TEXT;
CREATE INDEX IF NOT EXISTS products_expiry_idx ON products(expiry_date);

-- Customers (lightweight, no CRM)
CREATE TABLE IF NOT EXISTS customers (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  phone               TEXT NOT NULL DEFAULT '',
  address             TEXT NOT NULL DEFAULT '',
  notes               TEXT NOT NULL DEFAULT '',
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  outstanding_balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (outstanding_balance >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customers_name_idx ON customers(name);
CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers(phone);

-- Customer ledger (credit / recovery history, server authoritative)
CREATE TABLE IF NOT EXISTS customer_transactions (
  id            SERIAL PRIMARY KEY,
  customer_id   INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('sale', 'payment', 'adjustment')),
  amount        NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  ref_id        INTEGER,
  note          TEXT NOT NULL DEFAULT '',
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_transactions_customer_idx ON customer_transactions(customer_id, id DESC);

-- Sales can reference a customer (walk-in = NULL)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;

-- Cashier shifts
CREATE TABLE IF NOT EXISTS shifts (
  id            SERIAL PRIMARY KEY,
  cashier_id    INTEGER NOT NULL REFERENCES users(id),
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_cash  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
  closed_at     TIMESTAMPTZ,
  closing_cash  NUMERIC(12,2) CHECK (closing_cash >= 0),
  expected_cash NUMERIC(12,2),
  difference    NUMERIC(12,2),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  note          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS shifts_cashier_idx ON shifts(cashier_id, opened_at DESC);

-- Simple vendor claims (internal record + status workflow, no settlement APIs)
CREATE TABLE IF NOT EXISTS vendor_claims (
  id             SERIAL PRIMARY KEY,
  vendor_id      INTEGER NOT NULL REFERENCES vendors(id),
  product_id     INTEGER REFERENCES products(id) ON DELETE SET NULL,
  qty            NUMERIC(12,2) CHECK (qty >= 0),
  amount         NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  reason         TEXT NOT NULL,
  claim_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'settled')),
  adjustment_ref TEXT NOT NULL DEFAULT '',
  note           TEXT NOT NULL DEFAULT '',
  created_by     INTEGER REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS vendor_claims_status_idx ON vendor_claims(status);

-- Simple expense tracking
CREATE TABLE IF NOT EXISTS expenses (
  id           SERIAL PRIMARY KEY,
  category     TEXT NOT NULL,
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  note         TEXT NOT NULL DEFAULT '',
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses(expense_date);

-- Explicit cashier permissions (admins implicitly hold all of them)
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (user_id, permission)
);
