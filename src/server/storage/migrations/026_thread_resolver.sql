-- Who resolved a comment thread, and when (Bitbucket threadResolver and threadResolvedDate). Root comments of resolved threads only.
-- NULL: an open thread, a row before the next sync, or a server that sends no such field (integration-check.md U56).
-- thread_resolver_json holds the slug, the display name, and the username, as reviewers_json does. It never holds an email address.
ALTER TABLE comment ADD COLUMN thread_resolver_json TEXT;
ALTER TABLE comment ADD COLUMN thread_resolved_at INTEGER;
