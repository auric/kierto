-- Imported task text (plan r2 S-JIRA). One row per task key of a PR. json: the IssueContext. fetched_at: ms.
CREATE TABLE task_context (
  pr INTEGER NOT NULL REFERENCES pull_request (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('jira')),
  json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (pr, key)
) WITHOUT ROWID;
