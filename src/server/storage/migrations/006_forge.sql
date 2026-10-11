-- Forge data for the v3 detail (plan v3 WP4). db.ts runs this file after 009_reply.sql.

-- severity, task_state: the raw forge values. A BLOCKER comment is a task. RESOLVED marks it done (Gate v3 U14).
-- excerpt_json: the ExcerptLine[] of an inline root comment, from its activity diff. NULL for other comments.
ALTER TABLE comment ADD COLUMN severity TEXT;
ALTER TABLE comment ADD COLUMN task_state TEXT;
ALTER TABLE comment ADD COLUMN excerpt_json TEXT;

-- meta_head: '<source head>:<target head>' of the stored commits and changes. NULL before the first complete fetch.
-- repo_url: the repository browse link, only when its origin equals the configured origin.
ALTER TABLE pull_request ADD COLUMN meta_head TEXT;
ALTER TABLE pull_request ADD COLUMN repo_url TEXT;

-- ord: 0 is the newest commit. A commit comes before its parents (Gate v3 U15: the server order is not used).
CREATE TABLE pr_commit (
  pr INTEGER NOT NULL REFERENCES pull_request (id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  ord INTEGER NOT NULL,
  message TEXT NOT NULL,
  author_slug TEXT,
  author_name TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (pr, hash)
) WITHOUT ROWID;

-- src_path: the old path of a moved or copied file.
CREATE TABLE pr_change (
  pr INTEGER NOT NULL REFERENCES pull_request (id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  src_path TEXT,
  type TEXT NOT NULL,
  PRIMARY KEY (pr, path)
) WITHOUT ROWID;
