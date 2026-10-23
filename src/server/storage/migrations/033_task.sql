-- Build a Jira task (docs/plans/review-v2/spec.md sections 6.3 and 8). It takes the number after the newest merged migration
-- (032_ask_parent.sql). A later file renumbers by the list order of db.ts.
-- SQLite cannot change a NOT NULL or a CHECK, so review_run is rebuilt with its column order and row IDs, as in 030_review_v2.sql.
-- db.ts runs migrations with foreign keys off, so DROP TABLE keeps the child rows.
-- review_run.task: the task of a task run. A task run has pr NULL, and no PR read may show it. Rows stored before get NULL.
-- task.state and task_part.state change only through advance() (src/server/tasks/tasks.ts). Every task write checks version.
-- task.stopped_from: the state that Resume returns to. docs_json: the plan before its first push.
-- task_part.pushed: the lease of the next push. commands_json: argv lists only, never a shell string.
CREATE TABLE task (
  id INTEGER PRIMARY KEY,
  project TEXT NOT NULL, repo TEXT NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL,
  origin_pr INTEGER REFERENCES pull_request (id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN ('interview','spec_draft','spec_pr_open','spec_approved','implementing','ready','done','failed','stopped')),
  stopped_from TEXT,
  size TEXT CHECK (size IN ('small','medium','large')),
  size_by TEXT CHECK (size_by IN ('claude','rule','user')),
  target_branch TEXT NOT NULL, base_commit TEXT,
  spec_dir TEXT NOT NULL, spec_branch TEXT,
  issue_json TEXT,
  docs_json TEXT,
  estimate_json TEXT, settings_json TEXT NOT NULL DEFAULT '{}', blocked_json TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER
);
CREATE UNIQUE INDEX task_open ON task (project, repo, key) WHERE state NOT IN ('done','failed');

CREATE TABLE review_run_new (
  id INTEGER PRIMARY KEY,
  pr INTEGER REFERENCES pull_request (id) ON DELETE CASCADE,
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
  kind TEXT NOT NULL DEFAULT 'review'
    CHECK (kind IN ('review', 'reply', 'ask', 'fix', 'consult', 'session', 'explain', 'discuss', 'interview', 'spec', 'implement')),
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
  consult_json TEXT,
  prompt_version TEXT,
  item INTEGER REFERENCES review_item (id) ON DELETE SET NULL,
  discuss_json TEXT,
  explain_json TEXT,
  parent_run INTEGER REFERENCES review_run (id) ON DELETE SET NULL,
  task INTEGER REFERENCES task (id) ON DELETE CASCADE,
  CHECK (pr IS NOT NULL OR task IS NOT NULL)
);

INSERT INTO review_run_new (id, pr, profile, note, idem_key, source_head, target_head, merge_base, fetch_via, status, error_kind, error_text,
    session_id, cli_version, model, usage_json, summary_json, raw_output, started_at, finished_at, kind, profile_name, profile_revision, explain,
    since_head, range_base, question, answer, fix_json, tasks_json, effort, effort_default, instructions_json, skills_json, consult_json,
    prompt_version, item, discuss_json, explain_json, parent_run)
  SELECT id, pr, profile, note, idem_key, source_head, target_head, merge_base, fetch_via, status, error_kind, error_text,
    session_id, cli_version, model, usage_json, summary_json, raw_output, started_at, finished_at, kind, profile_name, profile_revision, explain,
    since_head, range_base, question, answer, fix_json, tasks_json, effort, effort_default, instructions_json, skills_json, consult_json,
    prompt_version, item, discuss_json, explain_json, parent_run
  FROM review_run;

DROP TABLE review_run;
ALTER TABLE review_run_new RENAME TO review_run;

-- A14: one running run per key. An ended run frees its key for a rerun.
CREATE UNIQUE INDEX review_run_running ON review_run (idem_key) WHERE status = 'running';
CREATE INDEX review_run_pr ON review_run (pr, id);
CREATE INDEX review_run_item ON review_run (item) WHERE item IS NOT NULL;
CREATE UNIQUE INDEX review_run_parent ON review_run (parent_run) WHERE parent_run IS NOT NULL;
-- The runs of a task, and the child key of its cascade.
CREATE INDEX review_run_task ON review_run (task, id) WHERE task IS NOT NULL;

CREATE TABLE task_question (
  id INTEGER PRIMARY KEY, task INTEGER NOT NULL REFERENCES task (id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('interview','loop')), round INTEGER NOT NULL, ord INTEGER NOT NULL,
  text TEXT NOT NULL, why TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('choice','text')),
  options_json TEXT NOT NULL DEFAULT '[]', recommended INTEGER,
  answer_json TEXT, step INTEGER, asked_at INTEGER NOT NULL, answered_at INTEGER
);

CREATE TABLE task_part (
  id INTEGER PRIMARY KEY, task INTEGER NOT NULL REFERENCES task (id) ON DELETE CASCADE, ord INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('spec','contract','part','cleanup','spike','single')),
  title TEXT NOT NULL, branch TEXT NOT NULL, base_branch TEXT NOT NULL,
  pr INTEGER REFERENCES pull_request (id) ON DELETE SET NULL, remote_pr INTEGER,
  state TEXT NOT NULL CHECK (state IN ('planned','implementing','self_reviewed','pr_open','changes_requested','approved','merged','declined','abandoned')),
  head TEXT, pushed TEXT, lines INTEGER, usage_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (task, ord)
);

CREATE TABLE task_step (
  id INTEGER PRIMARY KEY, task INTEGER NOT NULL REFERENCES task (id) ON DELETE CASCADE,
  part INTEGER REFERENCES task_part (id) ON DELETE CASCADE, ord INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('interview','spec','tests','implement','check','fix','review','commit','push','pr','retarget','rebase','replan','question','spec_change','size')),
  run INTEGER REFERENCES review_run (id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN ('waiting','running','ok','failed','cancelled','skipped')),
  attempt INTEGER NOT NULL DEFAULT 1, item TEXT, detail_json TEXT NOT NULL DEFAULT '{}',
  started_at INTEGER NOT NULL, ended_at INTEGER
);

CREATE TABLE task_event (
  id INTEGER PRIMARY KEY, task INTEGER NOT NULL REFERENCES task (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('needs_you','part_ready','spec_approved')),
  ref TEXT NOT NULL, created_at INTEGER NOT NULL, claimed_at INTEGER, UNIQUE (task, kind, ref)
);

CREATE TABLE repo_task_settings (
  project TEXT NOT NULL, repo TEXT NOT NULL,
  spec_dir TEXT NOT NULL DEFAULT 'specs/{key}/', branch_prefix TEXT NOT NULL DEFAULT 'feature/',
  line_budget INTEGER NOT NULL DEFAULT 400, max_open INTEGER NOT NULL DEFAULT 2, approvals INTEGER NOT NULL DEFAULT 1,
  commands_json TEXT NOT NULL DEFAULT '[]', test_globs_json TEXT, exclude_globs_json TEXT,
  isolate_home INTEGER NOT NULL DEFAULT 1, warned_at INTEGER, updated_at INTEGER NOT NULL,
  PRIMARY KEY (project, repo)
);
