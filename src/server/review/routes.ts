// Review API (plan v3 WP10): brief, start, cancel, run, raw output. Every mutation broadcasts `changed`.
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type ApiError, briefInput } from "../../shared/dto";
import type { Live } from "../live";
import type { ReviewJobs } from "./jobs";

const positiveId = (what: string) =>
  validator("param", (v: Record<string, string>, c) => {
    const id = Number(v.id);
    return Number.isSafeInteger(id) && id > 0 ? { id } : c.json<ApiError>({ error: `Invalid ${what} ID.` }, 400);
  });
const prParam = positiveId("pull request");
const runParam = positiveId("run");

const unconfigured = { error: "Configure the Bitbucket URL and token first." } satisfies ApiError;
const notFound = (what: string) => ({ error: `${what} not found.` }) satisfies ApiError;

export function createReviewRoutes(opts: { review: ReviewJobs; live: Live }) {
  const { review, live } = opts;
  return new Hono()
    .get("/prs/:id/brief", prParam, (c) => {
      const db = review.open();
      const brief = db && review.brief(db, c.req.valid("param").id);
      return brief ? c.json(brief, 200) : c.json(notFound("Pull request"), 404);
    })
    .put(
      "/prs/:id/brief",
      prParam,
      validator("json", (v, c) => {
        const r = briefInput.safeParse(v);
        return r.success ? r.data : c.json<ApiError>({ error: "Invalid brief." }, 400);
      }),
      (c) => {
        const db = review.open();
        if (!db) return c.json(unconfigured, 409);
        const id = c.req.valid("param").id;
        const brief = review.saveBrief(db, id, c.req.valid("json"));
        if (!brief) return c.json(notFound("Pull request"), 404);
        live.broadcast("changed", { prs: [id] });
        return c.json(brief, 200);
      },
    )
    .post("/prs/:id/review", prParam, (c) => {
      const db = review.open();
      if (!db) return c.json(unconfigured, 409);
      const r = review.review(db, c.req.valid("param").id);
      if ("run" in r) return r.status === 202 ? c.json(r.run, 202) : c.json(r.run, 200);
      if ("conflict" in r) return c.json(r.conflict, 409);
      return r.status === 404 ? c.json({ error: r.error }, 404) : c.json({ error: r.error }, 409);
    })
    .get("/prs/:id/runs", prParam, (c) => {
      const db = review.open();
      return c.json(db ? review.runs(db, c.req.valid("param").id, 20) : [], 200);
    })
    .get("/runs", (c) => {
      const db = review.open();
      return c.json(db ? review.runs(db, null, 50) : [], 200);
    })
    .get("/runs/:id", runParam, (c) => {
      const db = review.open();
      const run = db && review.run(db, c.req.valid("param").id);
      return run ? c.json(run, 200) : c.json(notFound("Run"), 404);
    })
    .get("/runs/:id/raw", runParam, (c) => {
      const db = review.open();
      const raw = db && review.raw(db, c.req.valid("param").id);
      if (typeof raw !== "string") return c.json(notFound("Raw output"), 404);
      c.header("Cache-Control", "no-store");
      return c.text(raw, 200);
    })
    .post("/runs/:id/cancel", runParam, (c) => {
      const db = review.open();
      if (!db) return c.json(unconfigured, 409);
      const r = review.cancel(db, c.req.valid("param").id);
      if (r === null) return c.json(notFound("Run"), 404);
      if (r === "not_running") return c.json({ error: "The run is not running." }, 409);
      return c.json({ cancelling: true }, 202);
    });
}
