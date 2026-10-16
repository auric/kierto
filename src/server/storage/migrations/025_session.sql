-- Ask your session (docs/plans/session-consult.md part C). SQLite cannot change a CHECK, so review_run is rebuilt with its column order
-- and row IDs, as in 024_consult.sql. db.ts runs migrations with foreign keys off, so DROP TABLE keeps the child rows.
-- A session run forks the user's own session. consult_json holds the session ID, title, size, the item count and keys of the text,
-- and never transcript text. answer holds the raw entries of its structured output.
CREATE TABLE review_run_new (
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
  finished_at INTEGER,
  kind TEXT NOT NULL DEFAULT 'review' CHECK (kind IN ('review', 'reply', 'ask', 'fix', 'consult', 'session')),
  profile_name TEXT,
  profile_revision TEXT,
  explain INTEGER,
  since_head TEXT,
  range_base TEXT,
  question TEXT,
  answer TEXT,
  fix_json TEXT,
  tasks_json TEXT,
  effort TEXT,
  effort_default TEXT,
  instructions_json TEXT,
  skills_json TEXT,
  consult_json TEXT
);

INSERT INTO review_run_new (id, pr, profile, note, idem_key, source_head, target_head, merge_base, fetch_via, status, error_kind, error_text,
    session_id, cli_version, model, usage_json, summary_json, raw_output, started_at, finished_at, kind, profile_name, profile_revision, explain,
    since_head, range_base, question, answer, fix_json, tasks_json, effort, effort_default, instructions_json, skills_json)
  SELECT id, pr, profile, note, idem_key, source_head, target_head, merge_base, fetch_via, status, error_kind, error_text,
    session_id, cli_version, model, usage_json, summary_json, raw_output, started_at, finished_at, kind, profile_name, profile_revision, explain,
    since_head, range_base, question, answer, fix_json, tasks_json, effort, effort_default, instructions_json, skills_json
  FROM review_run;

DROP TABLE review_run;
ALTER TABLE review_run_new RENAME TO review_run;

-- A14: one running run per key. An ended run frees its key for a rerun.
CREATE UNIQUE INDEX review_run_running ON review_run (idem_key) WHERE status = 'running';
CREATE INDEX review_run_pr ON review_run (pr, id);
