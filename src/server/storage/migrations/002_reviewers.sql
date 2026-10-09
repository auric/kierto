-- All reviewers of a PR as a JSON array of { slug, name, status, lastReviewedCommit }. NULL until the next PR write.
ALTER TABLE pull_request ADD COLUMN reviewers_json TEXT;
