// Diff API (plan r2 S-DIFF): GET /prs/:id/diff, POST /prs/:id/diff/fetch, GET /prs/:id/diff/file.
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { ApiError } from "../../shared/dto";
import { fetchDiff, readDiff, readDiffPage } from "./diff";
import type { ReviewJobs } from "./jobs";

const prParam = validator("param", (v: Record<string, string>, c) => {
  const id = Number(v.id);
  return Number.isSafeInteger(id) && id > 0 ? { id } : c.json<ApiError>({ error: "Invalid pull request ID." }, 400);
});
const pageQuery = validator("query", (v: Record<string, string | string[]>, c) => {
  const start = v.start === undefined ? 0 : Number(v.start);
  return typeof v.path === "string" && v.path && Number.isSafeInteger(start) && start >= 0
    ? { path: v.path, start }
    : c.json<ApiError>({ error: "Invalid file or start row." }, 400);
});

const unconfigured = { error: "Configure the Bitbucket URL and token first." } satisfies ApiError;

export function createDiffRoutes(opts: { review: ReviewJobs }) {
  const { review } = opts;
  return new Hono()
    .get("/prs/:id/diff", prParam, async (c) => {
      const db = review.open();
      if (!db) return c.json(unconfigured, 409);
      const r = await readDiff(db, review.dataDir, c.req.valid("param").id);
      return c.json(r.body, r.status);
    })
    .post("/prs/:id/diff/fetch", prParam, async (c) => {
      const db = review.open();
      if (!db) return c.json(unconfigured, 409);
      const r = await fetchDiff(db, review.dataDir, review.remote, c.req.valid("param").id);
      return c.json(r.body, r.status);
    })
    .get("/prs/:id/diff/file", prParam, pageQuery, async (c) => {
      const db = review.open();
      if (!db) return c.json(unconfigured, 409);
      const { path, start } = c.req.valid("query");
      const r = await readDiffPage(db, review.dataDir, c.req.valid("param").id, path, start);
      return c.json(r.body, r.status);
    });
}
