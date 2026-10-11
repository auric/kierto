-- Review profiles (M4). Runs made before M4 keep NULL in both columns.
-- profile_revision: the sha256 of the profile at the start of the run.

ALTER TABLE review_run ADD COLUMN profile_name TEXT;
ALTER TABLE review_run ADD COLUMN profile_revision TEXT;
