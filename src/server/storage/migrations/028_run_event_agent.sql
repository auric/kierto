-- The subagent details of an Agent call (src/server/review/stream.ts). model, tokens: NULL when the stream did not give them.
-- builtin 1: the run did not define the agent, so it comes from the CLI or the user's Claude config.
ALTER TABLE run_event ADD COLUMN model TEXT;
ALTER TABLE run_event ADD COLUMN tokens INTEGER;
ALTER TABLE run_event ADD COLUMN builtin INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1));
