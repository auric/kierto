-- Out-of-date draft alerts (docs/plans/thread-outcome.md section 11).
-- orphaned_at: ms of the sync that saw the root anchor turn orphaned. NULL: not orphaned, or orphaned at first sight.
ALTER TABLE comment ADD COLUMN orphaned_at INTEGER;

-- SQLite cannot change a CHECK, so event is rebuilt with its column order and row IDs. No table refers to event.
-- ref: comment ID (comment_new), source head (commits_pushed), PR version (reviewer_added),
-- <item>:out-of-date:<newest id> or <item>:resolved-since:<resolved at> (draft_stale).
CREATE TABLE event_new (
  id INTEGER PRIMARY KEY,
  pr INTEGER NOT NULL REFERENCES pull_request (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('comment_new', 'commits_pushed', 'reviewer_added', 'draft_stale')),
  ref TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  digest INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER,
  UNIQUE (pr, kind, ref)
);

INSERT INTO event_new (id, pr, kind, ref, created_at, digest, claimed_at) SELECT id, pr, kind, ref, created_at, digest, claimed_at FROM event;

DROP TABLE event;
ALTER TABLE event_new RENAME TO event;

CREATE INDEX event_unclaimed ON event (id) WHERE claimed_at IS NULL;
