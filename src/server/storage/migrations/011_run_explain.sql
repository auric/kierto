-- The explain flag of the profile at the start of the run (1 or 0). Runs made before it keep NULL.

ALTER TABLE review_run ADD COLUMN explain INTEGER;
