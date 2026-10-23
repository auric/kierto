-- docs/plans/review-v2/spec.md section 6.16.9: the last base branch pick of a repository. branch_prefix stays, and no code reads it.
ALTER TABLE repo_task_settings ADD COLUMN last_base TEXT;
