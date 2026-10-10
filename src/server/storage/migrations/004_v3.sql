-- ms: the last time the user opened the PR. NULL before the first visit.
ALTER TABLE pull_request ADD COLUMN seen_at INTEGER;
