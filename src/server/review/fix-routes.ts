// Fix it API (plan r3 S-APPLY): the clone routes, commit, and undo. Git in the user's clone runs no network command.
import { Hono } from "hono";
import type { Settings } from "../settings";
import type { ReviewJobs } from "./jobs";

export function createFixRoutes(_opts: { review: ReviewJobs; settings: Settings }) {
  return new Hono();
}
