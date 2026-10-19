-- Resolve after posting. resolve_root: the root comment of the thread that the row resolves after its comment step. NULL: no resolve step.
-- resolve_state: pending (waits for the comment step, then runs), done, or failed. resolve_error: the reason of a failed step.
-- A row with an empty body posts no comment and only resolves.
ALTER TABLE post ADD COLUMN resolve_root INTEGER;
ALTER TABLE post ADD COLUMN resolve_state TEXT CHECK (resolve_state IN ('pending', 'done', 'failed'));
ALTER TABLE post ADD COLUMN resolve_error TEXT;
CREATE INDEX post_resolve ON post (resolve_state) WHERE resolve_state = 'pending';
