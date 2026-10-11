-- Review brief, runs, run log, and drafts (plan v3 WP10).

-- The stored brief of a PR. POST /api/prs/:id/review runs it.
CREATE TABLE pr_brief (
  pr INTEGER PRIMARY KEY REFERENCES pull_request (id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  profile TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- idem_key: PR, source head, target head, profile, and the note hash. fetch_via: the workspace fetch path.
-- raw_output: the result text, structured_output, and the stderr tail, at most 2 MB.
CREATE TABLE review_run (
  id INTEGER PRIMARY KEY,
  pr INTEGER NOT NULL REFERENCES pull_request (id) ON DELETE CASCADE,
  profile TEXT NOT NULL,
  note TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  source_head TEXT NOT NULL,
  target_head TEXT NOT NULL,
  merge_base TEXT,
  fetch_via TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'incomplete', 'failed', 'cancelled')),
  error_kind TEXT CHECK (error_kind IN ('usage_limit', 'auth', 'max_turns', 'schema', 'tool_check', 'workspace', 'process', 'restart')),
  error_text TEXT,
  session_id TEXT,
  cli_version TEXT,
  model TEXT,
  usage_json TEXT,
  summary_json TEXT,
  raw_output TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);

-- A14: one running run per key. An ended run frees its key for a rerun.
CREATE UNIQUE INDEX review_run_running ON review_run (idem_key) WHERE status = 'running';
CREATE INDEX review_run_pr ON review_run (pr, id);

-- id: the tool_use id. parent: the id of the Agent call that made it.
CREATE TABLE run_event (
  run INTEGER NOT NULL REFERENCES review_run (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  parent TEXT,
  tool TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  agent TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  PRIMARY KEY (run, id)
) WITHOUT ROWID;

-- payload_json: the validated finding or the question. The anchor columns hold the current anchor of a finding.
CREATE TABLE review_item (
  id INTEGER PRIMARY KEY,
  run INTEGER NOT NULL REFERENCES review_run (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('finding', 'question')),
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
  edited INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX review_item_run ON review_item (run);
