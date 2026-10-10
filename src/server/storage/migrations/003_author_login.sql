-- The username of the comment author. X-AUSERNAME carries the username, which can differ from the slug. NULL for older rows until a newer comment version arrives.
ALTER TABLE comment ADD COLUMN author_login TEXT;
