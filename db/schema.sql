-- =============================================================
-- Beverage POS — initial schema
-- This file is ADDITIVE ONLY. It is safe to run on an empty
-- database and safe to re-run (IF NOT EXISTS everywhere).
-- Never run destructive migrations against production data.
-- =============================================================

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'cashier' CHECK (role IN ('admin', 'cashier')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  barcode     TEXT UNIQUE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  price       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  cost        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  stock       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (stock >= 0),
  min_stock   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_category_idx ON products(category_id);

CREATE TABLE IF NOT EXISTS vendors (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchases (
  id            SERIAL PRIMARY KEY,
  vendor_id     INTEGER NOT NULL REFERENCES vendors(id),
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  notes         TEXT NOT NULL DEFAULT '',
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchases_vendor_idx ON purchases(vendor_id);
CREATE INDEX IF NOT EXISTS purchases_date_idx ON purchases(purchase_date);

CREATE TABLE IF NOT EXISTS purchase_items (
  id          SERIAL PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  qty         NUMERIC(12,2) NOT NULL CHECK (qty > 0),
  cost        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost >= 0)
);
CREATE INDEX IF NOT EXISTS purchase_items_purchase_idx ON purchase_items(purchase_id);

CREATE TABLE IF NOT EXISTS sales (
  id             SERIAL PRIMARY KEY,
  sale_no        TEXT NOT NULL UNIQUE,
  cashier_id     INTEGER NOT NULL REFERENCES users(id),
  customer_name  TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  subtotal       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'other')),
  paid           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (paid >= 0),
  change_due     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (change_due >= 0),
  status         TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'refunded')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_cashier_idx ON sales(cashier_id);
CREATE INDEX IF NOT EXISTS sales_created_idx ON sales(created_at);

CREATE TABLE IF NOT EXISTS sale_items (
  id         SERIAL PRIMARY KEY,
  sale_id    INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  name       TEXT NOT NULL,
  qty        NUMERIC(12,2) NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0)
);
CREATE INDEX IF NOT EXISTS sale_items_sale_idx ON sale_items(sale_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id         SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  change     NUMERIC(12,2) NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN ('sale', 'purchase', 'adjustment')),
  ref_id     INTEGER,
  note       TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON stock_movements(product_id, id DESC);

-- Single-row settings table (id is always 1).
CREATE TABLE IF NOT EXISTS business_settings (
  id             INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_name  TEXT NOT NULL DEFAULT 'Beverage Store',
  currency       TEXT NOT NULL DEFAULT 'Rs',
  timezone       TEXT NOT NULL DEFAULT 'Asia/Karachi',
  receipt_footer TEXT NOT NULL DEFAULT 'Thank you for your business.',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO business_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
