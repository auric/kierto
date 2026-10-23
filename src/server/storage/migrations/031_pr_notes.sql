-- PR notes (docs/plans/review-v2/spec.md section 2.9). No rebuild. The plan reserved 032 for this file. db.ts sets the version
-- by list order, and this file merged before 031_task.sql (spec.md section 8), so it takes 031.
-- source user: the user wrote it. source claude: a reply or discuss run proposed it. Only state kept reaches a run (context/notes.md).
-- thread: the thread that shows the agreement. run: the run that proposed it. item: the reply draft that the same run made for that thread.
-- ref_*: the PR that this PR waits for. ref_state MISSING: Bitbucket gave 404. ref_checked_at: ms of the last read of the link.
-- version: raised by every change. deleted_at: Delete sets it, Undo clears it. A dismissed row stays, so the same text is never proposed again.
CREATE TABLE pr_note (
  id INTEGER PRIMARY KEY,
  pr INTEGER NOT NULL REFERENCES pull_request (id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
  source TEXT NOT NULL CHECK (source IN ('user','claude')),
  state TEXT NOT NULL CHECK (state IN ('kept','proposed','dismissed')),
  thread INTEGER,
  run INTEGER REFERENCES review_run (id) ON DELETE SET NULL,
  item INTEGER REFERENCES review_item (id) ON DELETE SET NULL,
  ref_project TEXT, ref_repo TEXT, ref_pr INTEGER, ref_title TEXT,
  ref_state TEXT CHECK (ref_state IN ('OPEN','MERGED','DECLINED','MISSING')),
  ref_checked_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  CHECK (source = 'claude' OR state = 'kept'),
  CHECK ((ref_pr IS NULL) = (ref_project IS NULL) AND (ref_pr IS NULL) = (ref_repo IS NULL))
);
CREATE INDEX pr_note_pr ON pr_note (pr, created_at) WHERE deleted_at IS NULL;
