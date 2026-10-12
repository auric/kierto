-- The --effort value of the run, or "default" for a run without the flag. Runs made before it keep NULL.

ALTER TABLE review_run ADD COLUMN effort TEXT;
