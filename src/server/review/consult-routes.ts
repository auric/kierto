// Session consult API (docs/plans/session-consult.md parts A and B): GET /prs/:id/consult, POST /prs/:id/consult/import, and
// POST /prs/:id/consult/:run/undo. Own pull requests only. Nothing goes to the server: the import writes local drafts and marks.
import { Hono } from "hono";
import { validator } from "hono/validator";
import { consultImportInput } from "../../shared/consult";
import type { ApiError } from "../../shared/dto";
import type { Live } from "../live";
import type { Settings } from "../settings";
import { consultData, importAnswer, undoImport } from "./consult";
import type { ReviewJobs } from "./jobs";

const positive = (v: string | undefined) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const prParam = validator("param", (v: Record<string, string>, c) => {
  const id = positive(v.id);
  return id ? { id } : c.json<ApiError>({ error: "Invalid pull request ID." }, 400);
});
const undoParam = validator("param", (v: Record<string, string>, c) => {
  const id = positive(v.id);
  const run = positive(v.run);
  return id && run ? { id, run } : c.json<ApiError>({ error: "Invalid pull request or paste ID." }, 400);
});

const unconfigured = { error: "Configure the Bitbucket URL and token first." } satisfies ApiError;

export function createConsultRoutes(opts: { review: ReviewJobs; settings: Settings; live: Live }) {
  const { review, settings, live } = opts;
  const source = () => {
    const db = review.open();
    const me = settings.config()?.userSlug;
    return db && me ? { db, me, review } : null;
  };
  return new Hono()
    .get("/prs/:id/consult", prParam, async (c) => {
      const s = source();
      if (!s) return c.json(unconfigured, 409);
      const r = await consultData(s, c.req.valid("param").id);
      if ("error" in r) return c.json<ApiError>({ error: r.error }, r.status);
      c.header("Cache-Control", "no-store");
      return c.json(r, 200);
    })
    .post(
      "/prs/:id/consult/import",
      prParam,
      validator("json", (v, c) => {
        const r = consultImportInput.safeParse(v);
        return r.success ? r.data : c.json<ApiError>({ error: "Invalid answer." }, 400);
      }),
      async (c) => {
        const s = source();
        if (!s) return c.json(unconfigured, 409);
        const id = c.req.valid("param").id;
        const r = await importAnswer(s, id, c.req.valid("json"));
        if (r.status !== 200) return c.json<ApiError>({ error: r.error }, r.status);
        live.broadcast("changed", { prs: [id], runs: r.runs });
        return c.json(r.dto, 200);
      },
    )
    .post("/prs/:id/consult/:run/undo", undoParam, (c) => {
      const s = source();
      if (!s) return c.json(unconfigured, 409);
      const { id, run } = c.req.valid("param");
      const r = undoImport(s.db, id, run);
      if (r.status !== 200) return c.json<ApiError>({ error: r.error }, r.status);
      live.broadcast("changed", { prs: [id], runs: r.runs });
      return c.json(r.dto, 200);
    });
}
