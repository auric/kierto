CREATE TABLE webhook_events (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

CREATE TABLE jobs (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued'
);
