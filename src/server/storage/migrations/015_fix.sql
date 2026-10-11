-- Fix it (plan r3 WP0).

-- The user's own clone of one repository. path: absolute, checked on save. updated_at: ms.
CREATE TABLE repo_clone (
  project TEXT NOT NULL,
  repo TEXT NOT NULL,
  path TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project, repo)
) WITHOUT ROWID;

-- One edit of a fix run. ord: the order in the result. start: the offset of old in the decoded file at the source head of the run.
-- rows_json: the DiffRowDto[] of the edit.
CREATE TABLE fix_edit (
  id INTEGER PRIMARY KEY,
  run INTEGER NOT NULL REFERENCES review_run (id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  thread INTEGER NOT NULL,
  path TEXT NOT NULL,
  old TEXT NOT NULL,
  new TEXT NOT NULL,
  start INTEGER NOT NULL,
  rows_json TEXT NOT NULL
);

CREATE INDEX fix_edit_run ON fix_edit (run, ord);

-- One apply of a set of edits. idem_key: <run>:<mode>:<sorted edit IDs>. edits_json: the fix_edit IDs.
-- before_head: the clone HEAD before the apply, or the parent commit in cache mode. clone_path, branch: clone mode only.
CREATE TABLE fix_commit (
  id INTEGER PRIMARY KEY,
  pr INTEGER NOT NULL REFERENCES pull_request (id) ON DELETE CASCADE,
  run INTEGER NOT NULL REFERENCES review_run (id) ON DELETE CASCADE,
  idem_key TEXT NOT NULL,
  edits_json TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('clone', 'cache')),
  clone_path TEXT,
  branch TEXT,
  before_head TEXT NOT NULL,
  commit_hash TEXT,
  short_hash TEXT,
  state TEXT NOT NULL CHECK (state IN ('committed', 'staged', 'undone')),
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- An undone row frees its key, so the same edits can apply again.
CREATE UNIQUE INDEX fix_commit_idem ON fix_commit (idem_key) WHERE state <> 'undone';
CREATE INDEX fix_commit_pr ON fix_commit (pr, id);
