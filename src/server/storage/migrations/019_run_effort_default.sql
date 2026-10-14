-- The effort that the user settings gave a run without --effort. NULL: unknown, or a run made before it was stored.

ALTER TABLE review_run ADD COLUMN effort_default TEXT;
