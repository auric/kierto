-- The skills that a run got, with the always-use mark. NULL: a run made before it was stored.
ALTER TABLE review_run ADD COLUMN skills_json TEXT;
