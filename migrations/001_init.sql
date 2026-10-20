-- Initial schema for the Order Management API.
-- gen_random_uuid() is built into Postgres 13+.

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  created_at    TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

-- Money is stored as integer cents: no floating-point rounding errors,
-- and pg returns INTEGER columns to Node as plain numbers.
CREATE TABLE products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  -- The CHECK is a last line of defence: even if application code had a bug,
  -- the database refuses to let stock go negative (no overselling).
  stock       INTEGER NOT NULL CHECK (stock >= 0),
  created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE INDEX products_created_idx ON products (created_at DESC, id DESC);

-- One cart per user: the cart is simply the set of rows for that user.
CREATE TABLE cart_items (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  added_at   TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'placed' CHECK (status IN ('placed', 'cancelled')),
  total_cents     INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  -- Client-supplied key that makes POST /orders safe to retry.
  idempotency_key TEXT NOT NULL,
  -- Millisecond precision (3) so the value round-trips exactly through a
  -- JavaScript Date. With microseconds, a cursor built from a JS Date would be
  -- slightly earlier than the real value and pagination could skip rows.
  created_at      TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  -- The same key from the same user can only ever create ONE order.
  CONSTRAINT orders_user_idempotency_key UNIQUE (user_id, idempotency_key)
);

-- Supports "my orders, newest first" with cursor pagination.
CREATE INDEX orders_user_created_idx ON orders (user_id, created_at DESC, id DESC);

CREATE TABLE order_items (
  order_id         UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       UUID NOT NULL REFERENCES products(id),
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  -- Price is copied at purchase time, so later price changes don't rewrite history.
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  PRIMARY KEY (order_id, product_id)
);
