// Diff API (plan r2 S-DIFF): GET /prs/:id/diff, POST /prs/:id/diff/fetch, GET /prs/:id/diff/file. WP0 adds the empty module.
import { Hono } from "hono";
import type { ReviewJobs } from "./jobs";

export function createDiffRoutes(_opts: { review: ReviewJobs }) {
  return new Hono();
}
