// Task context API (plan r2 S-JIRA): GET /prs/:id/task-context, POST and DELETE /prs/:id/task-context/:key, PUT /settings/jira.
// Jira gets a request only on a POST here or on a Jira settings save.
import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type ApiError, type IssueContext, JIRA_KEY, jiraSettingsInput, type TaskContextDto } from "../../shared/dto";
import type { Live } from "../live";
import { log } from "../log";
import type { ReviewJobs } from "../review/jobs";
import type { Settings } from "../settings";
import { ContextError, type ContextErrorKind, type ContextSource } from "./source";

// Fixed texts. A Jira answer body never reaches the client.
const FAILED: Record<ContextErrorKind, string> = {
  auth: "Jira rejected the token. Check the Jira settings.",
  forbidden: "Jira refused access to this issue.",
  not_found: "Jira has no such issue, or the token may not see it.",
  redirect: "Jira answered with a redirect. Check the Jira URL in Settings.",
  rate: "Jira is busy. Try again later.",
  server: "Jira failed to answer.",
  shape: "Jira sent an answer in an unknown format.",
  timeout: "Jira did not answer in time.",
  network: "Cannot reach Jira.",
};

const unconfigured = { error: "Configure the Bitbucket URL and token first." } satisfies ApiError;
const prNotFound = { error: "Pull request not found." } satisfies ApiError;

const params = validator("param", (v: Record<string, string>, c) => {
  const id = Number(v.id);
  if (!Number.isSafeInteger(id) || id <= 0) return c.json<ApiError>({ error: "Invalid pull request ID." }, 400);
  if (v.key !== undefined && !JIRA_KEY.test(v.key)) return c.json<ApiError>({ error: "Invalid task key." }, 400);
  return { id, key: v.key ?? "" };
});

type Row = { key: string; source: "jira"; json: string; fetched_at: number };
const toDto = (r: Row): TaskContextDto => ({ ...(JSON.parse(r.json) as IssueContext), source: r.source, fetchedAt: r.fetched_at });
const hasPr = (db: Database, id: number) => db.query("SELECT 1 FROM pull_request WHERE id = $id").get({ id }) !== null;
const hasTask = (db: Database, pr: number, key: string) =>
  db.query("SELECT 1 FROM pr_task WHERE pr = $pr AND key = $key").get({ pr, key }) !== null;

export function createContextRoutes(opts: { settings: Settings; review: ReviewJobs; live: Live }) {
  const { settings, live } = opts;
  return new Hono()
    .put(
      "/settings/jira",
      validator("json", (v, c) => {
        const r = jiraSettingsInput.safeParse(v);
        return r.success ? r.data : c.json<ApiError>({ error: "Invalid Jira settings." }, 400);
      }),
      async (c) => {
        const r = await settings.saveJira(c.req.valid("json"));
        return "status" in r ? c.json<ApiError>({ error: r.error }, r.status) : c.json(r, 200);
      },
    )
    .get("/prs/:id/task-context", params, (c) => {
      const db = settings.db();
      const { id } = c.req.valid("param");
      if (!db || !hasPr(db, id)) return c.json(prNotFound, 404);
      const rows = db.query("SELECT key, source, json, fetched_at FROM task_context WHERE pr = $id ORDER BY key").all({ id }) as Row[];
      return c.json(rows.map(toDto), 200);
    })
    .post("/prs/:id/task-context/:key", params, async (c) => {
      const db = settings.db();
      if (!db) return c.json(unconfigured, 409);
      const { id, key } = c.req.valid("param");
      if (!hasPr(db, id)) return c.json(prNotFound, 404);
      if (!hasTask(db, id, key)) return c.json<ApiError>({ error: "This pull request does not name that task." }, 404);
      let source: ContextSource | null;
      try {
        source = await settings.jira();
      } catch {
        return c.json<ApiError>({ error: "Cannot read the Jira CA file." }, 502);
      }
      if (!source) return c.json<ApiError>({ error: "Set up Jira in Settings first." }, 409);
      let issue: IssueContext;
      try {
        issue = await source.fetchIssue(key);
      } catch (e) {
        if (!(e instanceof ContextError)) throw e;
        log(`Jira fetch failed: ${e.message}`);
        return c.json<ApiError>({ error: FAILED[e.kind] }, 502);
      }
      const row: Row = { key, source: "jira", json: JSON.stringify(issue), fetched_at: Date.now() };
      // The PR or its task can go away during the request.
      const stored = db.transaction(() => {
        if (!hasTask(db, id, key)) return false;
        db.query(
          `INSERT INTO task_context (pr, key, source, json, fetched_at) VALUES ($pr, $key, $source, $json, $at)
            ON CONFLICT (pr, key) DO UPDATE SET source = excluded.source, json = excluded.json, fetched_at = excluded.fetched_at`,
        ).run({ pr: id, key, source: row.source, json: row.json, at: row.fetched_at });
        return true;
      })();
      if (!stored) return c.json<ApiError>({ error: "This pull request does not name that task." }, 404);
      live.broadcast("changed", { prs: [id] });
      return c.json(toDto(row), 200);
    })
    .delete("/prs/:id/task-context/:key", params, (c) => {
      const db = settings.db();
      if (!db) return c.json(unconfigured, 409);
      const { id, key } = c.req.valid("param");
      const r = db.query("DELETE FROM task_context WHERE pr = $id AND key = $key").run({ id, key });
      if (r.changes) live.broadcast("changed", { prs: [id] });
      return c.body(null, 204);
    });
}
