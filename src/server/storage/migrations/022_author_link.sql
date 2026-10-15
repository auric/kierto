-- The user page of the PR author, only when the link has the configured origin. pr_branch_link holds the server links of a PR.
ALTER TABLE pr_branch_link ADD COLUMN author_url TEXT;
