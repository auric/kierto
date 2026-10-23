// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The task API of docs/plans/review-v2/spec.md section 6.11: create, list, read, answers, docs, plan, size, and the repository task
// settings. Every input passes its zod schema. Every mutation checks task.version and gives 409 with the current task on a mismatch.
import { type Context, Hono } from "hono";
import { validator } from "hono/validator";
import type { z } from "zod";
import {
  type ApiError,
  type RepoTaskSettingsDto,
  type RunConflict,
  repoTaskSettingsInput,
  type TaskConflict,
  taskAnswersInput,
  taskCreateInput,
  taskDocInput,
  taskListInput,
  taskPlanInput,
  taskSizeInput,
} from "../../shared/dto";
import type { Live } from "../live";
import type { ReviewJobs } from "../review/jobs";
import type { Settings } from "../settings";
import { createTaskService, repoSettings, saveRepoSettings, type TaskResult } from "./tasks";

const unconfigured = { error: "Configure the Bitbucket URL and token first." } satisfies ApiError;
const NAME = /^[A-Za-z0-9~_][A-Za-z0-9._~-]{0,254}$/;

const idParam = validator("param", (v: Record<string, string>, c) => {
  const id = Number(v.id);
  return Number.isSafeInteger(id) && id > 0 ? { id } : c.json<ApiError>({ error: "Invalid task ID." }, 400);
});
const repoParam = validator("param", (v: Record<string, string>, c) =>
  NAME.test(v.project ?? "") && NAME.test(v.repo ?? "")
    ? { project: v.project as string, repo: v.repo as string }
    : c.json<ApiError>({ error: "Invalid repository." }, 400),
);
const body = <T extends z.ZodType>(schema: T, error: string) =>
  validator("json", (v, c) => {
    const r = schema.safeParse(v);
    return r.success ? (r.data as z.infer<T>) : c.json<ApiError>({ error }, 400);
  });

function answer(c: Context, r: TaskResult) {
  if ("task" in r && r.status !== 409) return c.json(r.task, r.status);
  if (r.status === 409)
    return r.running
      ? c.json<RunConflict>({ error: r.error, running: r.running }, 409)
      : r.task
        ? c.json<TaskConflict>({ error: r.error, task: r.task }, 409)
        : c.json<ApiError>({ error: r.error }, 409);
  if (r.status === 422) return c.json({ error: r.error, line: r.line }, 422);
  return c.json<ApiError>({ error: r.error }, r.status);
}

export function createTaskRoutes(opts: { review: ReviewJobs; settings: Settings; live: Live }) {
  const { review } = opts;
  const tasks = createTaskService({ review, settings: opts.settings, live: opts.live });
  return new Hono()
    .post("/tasks", body(taskCreateInput, "Give a project, a repository, and a Jira key such as ABC-12."), async (c) =>
      answer(c, await tasks.create(c.req.valid("json"))),
    )
    .get(
      "/tasks",
      validator("query", (v, c) => {
        const r = taskListInput.safeParse(v);
        return r.success ? r.data : c.json<ApiError>({ error: "Use state open or all." }, 400);
      }),
      (c) => {
        const db = review.open();
        return c.json(db ? tasks.list(db, c.req.valid("query").state) : [], 200);
      },
    )
    .get("/tasks/:id", idParam, (c) => {
      const db = review.open();
      const t = db && tasks.get(db, c.req.valid("param").id);
      return t ? c.json(t, 200) : c.json<ApiError>({ error: "Task not found." }, 404);
    })
    .post("/tasks/:id/answers", idParam, body(taskAnswersInput, "Invalid answers."), (c) => {
      const db = review.open();
      return db ? answer(c, tasks.answers(db, c.req.valid("param").id, c.req.valid("json"))) : c.json(unconfigured, 409);
    })
    .put("/tasks/:id/docs", idParam, body(taskDocInput, "Invalid plan file."), (c) => {
      const db = review.open();
      return db ? answer(c, tasks.docs(db, c.req.valid("param").id, c.req.valid("json"))) : c.json(unconfigured, 409);
    })
    .post("/tasks/:id/plan", idParam, body(taskPlanInput, "Invalid plan approval."), (c) => {
      const db = review.open();
      return db ? answer(c, tasks.plan(db, c.req.valid("param").id, c.req.valid("json"))) : c.json(unconfigured, 409);
    })
    .post("/tasks/:id/size", idParam, body(taskSizeInput, "Pick small, medium, or large."), (c) => {
      const db = review.open();
      return db ? answer(c, tasks.size(db, c.req.valid("param").id, c.req.valid("json"))) : c.json(unconfigured, 409);
    })
    .get("/repos/:project/:repo/task-settings", repoParam, (c) => {
      const db = review.open();
      if (!db) return c.json(unconfigured, 409);
      const { project, repo } = c.req.valid("param");
      return c.json<RepoTaskSettingsDto>(repoSettings(db, project, repo), 200);
    })
    .put("/repos/:project/:repo/task-settings", repoParam, body(repoTaskSettingsInput, "Invalid task settings."), (c) => {
      const db = review.open();
      if (!db) return c.json(unconfigured, 409);
      const { project, repo } = c.req.valid("param");
      const s = c.req.valid("json");
      if (new Set(s.commands.map((x) => x.id)).size !== s.commands.length)
        return c.json<ApiError>({ error: "Each command needs its own ID." }, 400);
      saveRepoSettings(db, project, repo, s);
      return c.json<RepoTaskSettingsDto>(repoSettings(db, project, repo), 200);
    });
}
