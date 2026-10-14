-- Project instructions per repository. target: read CLAUDE.md from the target branch. local_json: the ticked clone files.
CREATE TABLE repo_instructions (
  project TEXT NOT NULL,
  repo TEXT NOT NULL,
  target INTEGER NOT NULL DEFAULT 1,
  local_json TEXT NOT NULL DEFAULT '[]',
  extra TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project, repo)
);

-- The instruction files that a run got, with their sizes. NULL: a run made before it was stored.
ALTER TABLE review_run ADD COLUMN instructions_json TEXT;
