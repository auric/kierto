-- M1 schema. Later M1 groups add no migration.

CREATE TABLE pull_request (
  id INTEGER PRIMARY KEY,
  project TEXT NOT NULL,
  repo TEXT NOT NULL,
  pr_id INTEGER NOT NULL,
  title TEXT,
  description TEXT,
  author_slug TEXT,
  author_name TEXT,
  my_role TEXT,
  my_status TEXT,
  last_reviewed_commit TEXT,
  state TEXT,
  pr_version INTEGER,
  source_head TEXT,
  target_head TEXT,
  source_branch TEXT,
  target_branch TEXT,
  web_url TEXT,
  updated_date INTEGER,
  on_dashboard INTEGER NOT NULL DEFAULT 0,
  followed INTEGER NOT NULL DEFAULT 1,
  archived_at INTEGER,
  initialized_at INTEGER,
  UNIQUE (project, repo, pr_id)
);

-- A root comment has root_id = comment_id. Unread: ack_version IS NULL OR ack_version < version.
CREATE TABLE comment (
  pr INTEGER NOT NULL REFERENCES pull_request (id) ON DELETE CASCADE,
  comment_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  parent_id INTEGER,
  root_id INTEGER NOT NULL,
  author_slug TEXT NOT NULL,
  author_name TEXT,
  text TEXT NOT NULL,
  anchor_json TEXT,
  thread_resolved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ack_version INTEGER,
  tombstoned_at INTEGER,
  PRIMARY KEY (pr, comment_id)
) WITHOUT ROWID;

CREATE INDEX comment_thread ON comment (pr, root_id);

-- Scopes: 'dashboard' and 'pr:<id>'.
CREATE TABLE sync_checkpoint (
  scope TEXT PRIMARY KEY,
  last_complete_at INTEGER,
  incomplete_reason TEXT,
  last_error TEXT,
  updated_at INTEGER NOT NULL
);

-- ref: comment ID (comment_new), source head (commits_pushed), PR version (reviewer_added).
CREATE TABLE event (
  id INTEGER PRIMARY KEY,
  pr INTEGER NOT NULL REFERENCES pull_request (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('comment_new', 'commits_pushed', 'reviewer_added')),
  ref TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  digest INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER,
  UNIQUE (pr, kind, ref)
);

CREATE INDEX event_unclaimed ON event (id) WHERE claimed_at IS NULL;
