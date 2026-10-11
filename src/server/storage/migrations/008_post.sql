-- Durable outbox (plan v3 WP13a). One row per comment to send. The row is the approval.

-- run: NULL for a manual reply. items_json: [{id, revision}] of the review items. No foreign key to review_item: WP17 rebuilds that table.
-- destination_json: the PostDestination. idem_key: run:<pr>:<run>:<item@revision,...> or reply:<pr>:<composer key>.
-- remote_id, remote_version: the forge comment of a confirmed row.
CREATE TABLE post (
  id INTEGER PRIMARY KEY,
  pr INTEGER NOT NULL REFERENCES pull_request (id) ON DELETE CASCADE,
  run INTEGER REFERENCES review_run (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('inline', 'general', 'reply')),
  idem_key TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL,
  destination_json TEXT NOT NULL,
  items_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'sent', 'unknown', 'failed', 'confirmed')),
  remote_id INTEGER,
  remote_version INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX post_pr ON post (pr, id);
CREATE INDEX post_state ON post (state) WHERE state IN ('pending', 'sent', 'unknown');
