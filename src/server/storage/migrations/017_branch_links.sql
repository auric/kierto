-- The branch pages of a PR on the forge, only when the repository link has the configured origin.
-- source_url: in the fork for a PR from a fork. A table of its own: an ALTER of pull_request makes the migration check
-- every child table of pull_request, so an old orphan row there would block the upgrade (db.ts touched).
CREATE TABLE pr_branch_link (
  pr INTEGER PRIMARY KEY REFERENCES pull_request (id) ON DELETE CASCADE,
  source_url TEXT,
  target_url TEXT
);
