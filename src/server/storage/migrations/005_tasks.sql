-- Task IDs of a PR (plan v3 WP2). ord: the position in the rule union (D9).
CREATE TABLE pr_task (
  pr INTEGER NOT NULL REFERENCES pull_request (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT,
  ord INTEGER NOT NULL,
  PRIMARY KEY (pr, key)
);

-- sha256 of branch, title, description, the active rules, and taskLink. NULL before the first extraction.
ALTER TABLE pull_request ADD COLUMN task_input_hash TEXT;
