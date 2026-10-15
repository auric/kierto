-- Fix runs for review findings (docs/plans/fix-ux.md WP3). SQLite cannot drop NOT NULL or add a CHECK, so fix_edit is rebuilt with its row IDs, as in 014_r3_runs.sql.
-- thread: the root comment ID of a thread edit. item: the review_item ID of a finding edit. Each edit names exactly one of them.
-- No table refers to fix_edit. fix_commit.edits_json holds fix_edit IDs, so the copy keeps them.
CREATE TABLE fix_edit_new (
  id INTEGER PRIMARY KEY,
  run INTEGER NOT NULL REFERENCES review_run (id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  thread INTEGER,
  path TEXT NOT NULL,
  old TEXT NOT NULL,
  new TEXT NOT NULL,
  start INTEGER NOT NULL,
  rows_json TEXT NOT NULL,
  item INTEGER REFERENCES review_item (id) ON DELETE CASCADE,
  CHECK ((thread IS NULL) <> (item IS NULL))
);

INSERT INTO fix_edit_new (id, run, ord, thread, path, old, new, start, rows_json)
  SELECT id, run, ord, thread, path, old, new, start, rows_json FROM fix_edit;

DROP TABLE fix_edit;
ALTER TABLE fix_edit_new RENAME TO fix_edit;

CREATE INDEX fix_edit_run ON fix_edit (run, ord);
