// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Publish API (plan v3 WP12, WP13a): the post plan, confirm, replies, and the outbox rows. Nothing posts without confirm or a reply call.
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type ApiError, type ConfirmDto, confirmInput, type PostPlanDto, replyPostInput } from "../../shared/dto";
import { type ItemRow, type ReviewJobs, toItemDto } from "../review/jobs";
import type { Settings } from "../settings";
import { type Outbox, selectPosts } from "./outbox";
import { buildPlan, type PlanComment, type PlanInput, type PlanRun } from "./plan";

const SQL = {
  pr: "SELECT id FROM pull_request WHERE id = $pr",
  runs: `SELECT id, source_head AS sourceHead, target_head AS targetHead, merge_base AS mergeBase,
      (SELECT repo_url FROM pull_request WHERE id = $pr) AS repoUrl FROM review_run
    WHERE pr = $pr AND id IN (SELECT run FROM review_item WHERE status = 'accepted') ORDER BY id`,
  items: `SELECT i.* FROM review_item i JOIN review_run r ON r.id = i.run WHERE r.pr = $pr AND i.status = 'accepted' ORDER BY i.id`,
  comments: `SELECT comment_id AS id, author_slug AS authorSlug, author_login AS authorLogin, author_name AS authorName, anchor_json
    FROM comment WHERE pr = $pr AND parent_id IS NULL AND tombstoned_at IS NULL AND anchor_json IS NOT NULL`,
};

const parse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

// The plan input of a PR, or null for an unknown PR. Confirm builds the same input.
export function planInput(review: ReviewJobs, settings: Settings, pr: number): PlanInput | null {
  const db = review.open();
  if (!db?.query(SQL.pr).get({ pr })) return null;
  type C = Omit<PlanComment, "anchor"> & { anchor_json: string };
  return {
    me: settings.config()?.userSlug ?? null,
    mark: settings.config()?.markAi ?? true,
    severity: settings.config()?.markSeverity ?? true,
    runs: db.query(SQL.runs).all({ pr }) as PlanRun[],
    items: (db.query(SQL.items).all({ pr }) as ItemRow[]).map(toItemDto),
    comments: (db.query(SQL.comments).all({ pr }) as C[]).map(({ anchor_json, ...c }) => ({ ...c, anchor: parse(anchor_json) })),
  };
}

const positiveId = (what: string) =>
  validator("param", (v: Record<string, string>, c) => {
    const id = Number(v.id);
    return Number.isSafeInteger(id) && id > 0 ? { id } : c.json<ApiError>({ error: `Invalid ${what} ID.` }, 400);
  });
const prParam = positiveId("pull request");
const postParam = positiveId("post");

const unconfigured = { error: "Configure the Bitbucket URL and token first." } satisfies ApiError;
const notFound = { error: "Pull request not found." } satisfies ApiError;
const planChanged = { error: "The post plan changed. Check it again." } satisfies ApiError;

export function createPublishRoutes(opts: { review: ReviewJobs; settings: Settings; outbox: Outbox }) {
  const { review, settings, outbox } = opts;
  return new Hono()
    .get("/prs/:id/post-plan", prParam, (c) => {
      const pr = c.req.valid("param").id;
      const input = planInput(review, settings, pr);
      if (!input) return c.json(notFound, 404);
      c.header("Cache-Control", "no-store");
      return c.json({ pr, posts: buildPlan(input) } satisfies PostPlanDto, 200);
    })
    .post(
      "/prs/:id/confirm",
      prParam,
      validator("json", (v, c) => {
        const r = confirmInput.safeParse(v);
        return r.success ? r.data : c.json<ApiError>({ error: "Invalid confirm." }, 400);
      }),
      async (c) => {
        const db = outbox.open();
        if (!db) return c.json(unconfigured, 409);
        const pr = c.req.valid("param").id;
        const { items } = c.req.valid("json");
        const want = new Map(items.map((i) => [i.id, i.revision]));
        if (want.size !== items.length) return c.json<ApiError>({ error: "Each item can appear once." }, 400);
        const input = planInput(review, settings, pr);
        if (!input) return c.json(notFound, 404);
        const done = outbox.existing(db, pr, want);
        if (done) return c.json({ posts: done, warning: null } satisfies ConfirmDto, 200);
        const chosen = selectPosts(buildPlan(input), want);
        if (!chosen) return c.json(planChanged, 409);
        // D14: a reply post checks its parent and the newest message, never the heads.
        const parents = chosen.flatMap((p) => (p.destination.kind === "reply" ? [p.destination.parentId] : []));
        const stale = outbox.replyCheck(db, pr, parents);
        if (stale) return c.json({ error: stale }, 409);
        const replyItems = chosen.flatMap((p) => (p.destination.kind === "reply" ? p.items.map((i) => i.id) : []));
        const unpushed = outbox.fixCheck(db, pr, replyItems);
        if (unpushed) return c.json({ error: unpushed }, 409);
        const runs = [...new Set(chosen.filter((p) => p.destination.kind !== "reply").map((p) => p.run))];
        const heads = runs.length ? await outbox.headCheck(db, pr, runs) : { warning: null };
        if ("error" in heads) return heads.status === 409 ? c.json({ error: heads.error }, 409) : c.json({ error: heads.error }, 502);
        const out = outbox.enqueue(db, pr, chosen, want);
        if (!out) return c.json(planChanged, 409);
        if (out.existing) return c.json({ posts: out.rows, warning: null } satisfies ConfirmDto, 200);
        return c.json({ posts: out.rows, warning: heads.warning } satisfies ConfirmDto, 202);
      },
    )
    .post(
      "/prs/:id/replies",
      prParam,
      validator("json", (v, c) => {
        const r = replyPostInput.safeParse(v);
        return r.success ? r.data : c.json<ApiError>({ error: "Invalid reply." }, 400);
      }),
      (c) => {
        const db = outbox.open();
        if (!db) return c.json(unconfigured, 409);
        const r = outbox.reply(db, c.req.valid("param").id, c.req.valid("json"));
        if ("post" in r) return r.status === 202 ? c.json(r.post, 202) : c.json(r.post, 200);
        if ("conflict" in r) return c.json(r.conflict, 409);
        return r.status === 404 ? c.json({ error: r.error }, 404) : c.json({ error: r.error }, 409);
      },
    )
    .get("/prs/:id/posts", prParam, (c) => {
      const db = outbox.open();
      const posts = db && outbox.posts(db, c.req.valid("param").id);
      if (!posts) return c.json(notFound, 404);
      c.header("Cache-Control", "no-store");
      return c.json(posts, 200);
    })
    .post("/posts/:id/retry", postParam, async (c) => {
      const db = outbox.open();
      if (!db) return c.json(unconfigured, 409);
      const r = await outbox.retry(db, c.req.valid("param").id);
      if ("post" in r) return r.status === 202 ? c.json(r.post, 202) : c.json(r.post, 200);
      if (r.status === 404) return c.json({ error: r.error }, 404);
      return r.status === 409 ? c.json({ error: r.error }, 409) : c.json({ error: r.error }, 502);
    })
    .post(
      "/posts/:id/drop",
      postParam,
      validator("json", (v, c) => {
        // An empty body drops the post. general: true moves the findings of a failed inline post to the general comment.
        const general = (v as { general?: unknown } | null)?.general;
        return general === undefined || typeof general === "boolean"
          ? { general: general === true }
          : c.json<ApiError>({ error: "Invalid drop." }, 400);
      }),
      (c) => {
        const db = outbox.open();
        if (!db) return c.json(unconfigured, 409);
        const r = outbox.drop(db, c.req.valid("param").id, c.req.valid("json").general);
        if (r.status === 200) return c.json({ items: r.items }, 200);
        if (r.status === 404) return c.json({ error: r.error }, 404);
        return r.status === 409 ? c.json({ error: r.error }, 409) : c.json({ error: r.error }, 400);
      },
    );
}
