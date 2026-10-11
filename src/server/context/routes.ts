// Task context API (plan r2 S-JIRA): GET /prs/:id/task-context, POST and DELETE /prs/:id/task-context/:key, PUT /settings/jira.
// WP0 adds the empty module.
import { Hono } from "hono";
import type { Live } from "../live";
import type { ReviewJobs } from "../review/jobs";
import type { Settings } from "../settings";

export function createContextRoutes(_opts: { settings: Settings; review: ReviewJobs; live: Live }) {
  return new Hono();
}
