-- Nijmegen Duckstad — bestel-/loterijsysteem (D1 / SQLite)
-- Draai met: wrangler d1 migrations apply nijmegenduckstad --remote

CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,                 -- UUID, dient ook als token op de bedankpagina
  created_at      TEXT NOT NULL,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT,
  city            TEXT,
  type            TEXT NOT NULL DEFAULT 'regular',  -- 'regular' | 'business'
  quantity        INTEGER NOT NULL,
  amount_cents    INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | failed | expired | canceled | refunded
  payment_method  TEXT,                             -- 'mollie' | 'manual'
  mollie_payment_id TEXT,
  newsletter      INTEGER NOT NULL DEFAULT 0,       -- 0/1
  note            TEXT,
  paid_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_mollie ON orders(mollie_payment_id);
CREATE INDEX IF NOT EXISTS idx_orders_email  ON orders(email);

-- Eén rij per badeendje. Nummers worden pas toegekend bij een betaalde bestelling.
CREATE TABLE IF NOT EXISTS ducks (
  number     INTEGER NOT NULL,
  type       TEXT NOT NULL DEFAULT 'regular',       -- 'regular' | 'business'
  order_id   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (type, number),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);
CREATE INDEX IF NOT EXISTS idx_ducks_order ON ducks(order_id);

-- Atomische tellers voor opvolgende nummering per serie.
CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  n    INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO counters (name, n) VALUES ('regular', 0), ('business', 0);

-- Instelbare waarden (prijzen, voorraad, verkoop open/dicht).
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('sales_open',          '1'),
  ('max_regular',         '5000'),
  ('price_regular_cents', '500'),
  ('price_business_cents','15000');

-- Trekkingen / winnaars.
CREATE TABLE IF NOT EXISTS draws (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT NOT NULL,
  prize        TEXT NOT NULL,
  duck_type    TEXT NOT NULL,
  duck_number  INTEGER NOT NULL,
  order_id     TEXT,
  winner_name  TEXT,
  winner_email TEXT
);
