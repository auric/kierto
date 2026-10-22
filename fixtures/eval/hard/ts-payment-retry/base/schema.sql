CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'capturing', 'paid', 'declined', 'failed')),
  total_cents BIGINT NOT NULL CHECK (total_cents > 0),
  currency CHAR(3) NOT NULL,
  card_token TEXT NOT NULL,
  charge_id TEXT,
  decline_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  price_cents BIGINT NOT NULL CHECK (price_cents > 0),
  currency CHAR(3) NOT NULL,
  card_token TEXT NOT NULL,
  period INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'past_due', 'cancelled'))
);

CREATE TABLE jobs (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'done', 'dead')),
  run_after TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
