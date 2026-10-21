// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// docs/plans/thread-outcome.md section 11: why a reply draft is stale. The post plan, the outcome markers, the inbox badge, and the
// draft_stale event use these rules. Only out-of-date and resolved-since block a post.
import type { ReviewItemDto } from "./dto";
import type { ReplyPayload } from "./review";

export type StaleReason = "out-of-date" | "resolved-since" | "code-changed";

export type StaleDraft = {
  body: string;
  payload: Pick<ReplyPayload, "replyTo" | "threadOpen" | "touchedAt">;
  drafted?: Pick<NonNullable<ReviewItemDto["drafted"]>, "kind" | "startedAt" | "head">;
};

// newest: the newest live message of the thread (shared/turn.ts newestLive), null when every message is deleted.
// resolved: the thread is resolved now. orphanedAt: comment.orphaned_at of the root, null when not set.
export type StaleThread = { newest: number | null; resolved: boolean; orphanedAt: number | null };

// The reasons in block order. prHead: the source head of the PR now, null when unknown.
export function staleReasons(d: StaleDraft, t: StaleThread, prHead: string | null): StaleReason[] {
  const out: StaleReason[] = [];
  if (t.newest !== d.payload.replyTo) out.push("out-of-date");
  if (d.body.trim() !== "" && d.payload.threadOpen === true && t.resolved) out.push("resolved-since");
  // A draft of a fix run never gets code-changed: its own commits move the code.
  const run = d.drafted;
  if (
    run &&
    run.kind !== "fix" &&
    t.orphanedAt !== null &&
    t.orphanedAt > Math.max(run.startedAt, d.payload.touchedAt ?? 0) &&
    prHead !== null &&
    prHead !== run.head
  )
    out.push("code-changed");
  return out;
}
