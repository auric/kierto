-- Reply-draft runs (plan replies.md WP17).

ALTER TABLE review_run ADD COLUMN kind TEXT NOT NULL DEFAULT 'review' CHECK (kind IN ('review', 'reply'));

-- SQLite cannot change a CHECK, so review_item is rebuilt. No table references review_item.
-- thread: the root comment ID of a reply item. NULL for findings and questions.
CREATE TABLE review_item_new (
  id INTEGER PRIMARY KEY,
  run INTEGER NOT NULL REFERENCES review_run (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('finding', 'question', 'reply')),
  payload_json TEXT NOT NULL,
  body TEXT NOT NULL,
  path TEXT,
  side TEXT,
  line INTEGER,
  line_end INTEGER,
  anchor_state TEXT,
  excerpt_json TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'discarded', 'posted')),
  revision INTEGER NOT NULL DEFAULT 0,
  edited INTEGER NOT NULL DEFAULT 0,
  thread INTEGER
);

INSERT INTO review_item_new (id, run, kind, payload_json, body, path, side, line, line_end, anchor_state, excerpt_json, status, revision, edited)
  SELECT id, run, kind, payload_json, body, path, side, line, line_end, anchor_state, excerpt_json, status, revision, edited FROM review_item;

DROP TABLE review_item;
ALTER TABLE review_item_new RENAME TO review_item;

CREATE INDEX review_item_run ON review_item (run);
CREATE INDEX review_item_thread ON review_item (thread) WHERE thread IS NOT NULL;
