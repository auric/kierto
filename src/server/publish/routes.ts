// Publish API (plan v3 WP12): the post plan. WP13 adds confirm and the outbox.
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { ApiError, PostPlanDto } from "../../shared/dto";
import { type ItemRow, type ReviewJobs, toItemDto } from "../review/jobs";
import type { Settings } from "../settings";
import { buildPlan, type PlanComment, type PlanInput, type PlanRun } from "./plan";

const SQL = {
  pr: "SELECT id FROM pull_request WHERE id = $pr",
  runs: `SELECT id, source_head AS sourceHead, target_head AS targetHead, merge_base AS mergeBase FROM review_run
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

// The plan input of a PR, or null for an unknown PR. WP13 confirm builds the same input.
export function planInput(review: ReviewJobs, settings: Settings, pr: number): PlanInput | null {
  const db = review.open();
  if (!db?.query(SQL.pr).get({ pr })) return null;
  type C = Omit<PlanComment, "anchor"> & { anchor_json: string };
  return {
    me: settings.config()?.userSlug ?? null,
    runs: db.query(SQL.runs).all({ pr }) as PlanRun[],
    items: (db.query(SQL.items).all({ pr }) as ItemRow[]).map(toItemDto),
    comments: (db.query(SQL.comments).all({ pr }) as C[]).map(({ anchor_json, ...c }) => ({ ...c, anchor: parse(anchor_json) })),
  };
}

export function createPublishRoutes(opts: { review: ReviewJobs; settings: Settings }) {
  return new Hono().get(
    "/prs/:id/post-plan",
    validator("param", (v: Record<string, string>, c) => {
      const id = Number(v.id);
      return Number.isSafeInteger(id) && id > 0 ? { id } : c.json<ApiError>({ error: "Invalid pull request ID." }, 400);
    }),
    (c) => {
      const pr = c.req.valid("param").id;
      const input = planInput(opts.review, opts.settings, pr);
      if (!input) return c.json<ApiError>({ error: "Pull request not found." }, 404);
      c.header("Cache-Control", "no-store");
      return c.json({ pr, posts: buildPlan(input) } satisfies PostPlanDto, 200);
    },
  );
}
