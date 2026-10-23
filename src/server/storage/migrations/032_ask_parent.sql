-- Ask follow-ups (docs/plans/review-v2/spec.md sections 2.15 and 8). No rebuild. It takes the number after the newest merged migration
-- (031_pr_notes.sql). A later file renumbers by the list order of db.ts.
-- parent_run: the ask run that this ask run follows. Only ask runs set it. The unique index keeps a conversation one straight chain.
ALTER TABLE review_run ADD COLUMN parent_run INTEGER REFERENCES review_run (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX review_run_parent ON review_run (parent_run) WHERE parent_run IS NOT NULL;
