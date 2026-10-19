// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Session consult API (docs/plans/session-consult.md parts A, B, and C): GET /prs/:id/consult, POST /prs/:id/consult/import,
// POST /prs/:id/consult/:run/undo, GET /prs/:id/consult/sessions, POST /prs/:id/consult/session, and GET /prs/:id/consult/session/:run.
// Own pull requests only. Nothing goes to the server: the import writes local drafts and marks, and a session run only proposes.
import { Hono } from "hono";
import { validator } from "hono/validator";
import { consultImportInput, sessionStartInput } from "../../shared/consult";
import type { ApiError } from "../../shared/dto";
import type { Live } from "../live";
import type { Settings } from "../settings";
import { consultData, type FindSessions, importAnswer, listSessions, SESSIONS_OFF, startSession, undoImport } from "./consult";
import type { ReviewJobs } from "./jobs";
import { findSessions } from "./sessions";

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
const runParam = validator("param", (v: Record<string, string>, c) => {
  const id = positive(v.id);
  const run = positive(v.run);
  return id && run ? { id, run } : c.json<ApiError>({ error: "Invalid pull request or run ID." }, 400);
});

const unconfigured = { error: "Configure the Bitbucket URL and token first." } satisfies ApiError;

// find: the session finder. Tests pass a spy. In part C, the opt-in gates every read of the transcript folder.
export function createConsultRoutes(opts: { review: ReviewJobs; settings: Settings; live: Live; find?: FindSessions }) {
  const { review, settings, live } = opts;
  const find = opts.find ?? findSessions;
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
    })
    .get("/prs/:id/consult/sessions", prParam, async (c) => {
      const s = source();
      if (!s) return c.json(unconfigured, 409);
      if (!settings.sessions()) return c.json<ApiError>({ error: SESSIONS_OFF }, 409);
      const r = await listSessions(s, c.req.valid("param").id, find);
      if ("error" in r) return c.json<ApiError>({ error: r.error }, r.status);
      c.header("Cache-Control", "no-store");
      return c.json(r, 200);
    })
    .post(
      "/prs/:id/consult/session",
      prParam,
      validator("json", (v, c) => {
        const r = sessionStartInput.safeParse(v);
        return r.success ? r.data : c.json<ApiError>({ error: "Invalid session or groups." }, 400);
      }),
      async (c) => {
        const s = source();
        if (!s) return c.json(unconfigured, 409);
        if (!settings.sessions()) return c.json<ApiError>({ error: SESSIONS_OFF }, 409);
        const r = await startSession(s, c.req.valid("param").id, c.req.valid("json"), find);
        if ("run" in r) return r.status === 202 ? c.json(r.run, 202) : c.json(r.run, 200);
        if ("conflict" in r) return c.json(r.conflict, 409);
        return c.json<ApiError>({ error: r.error }, r.status);
      },
    )
    .get("/prs/:id/consult/session/:run", runParam, (c) => {
      const s = source();
      if (!s) return c.json(unconfigured, 409);
      const { id, run } = c.req.valid("param");
      const r = review.sessionAnswer(s.db, id, run);
      if (!r) return c.json<ApiError>({ error: "Answer not found." }, 404);
      c.header("Cache-Control", "no-store");
      return c.json(r, 200);
    });
}
