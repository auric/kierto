// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Stale reply drafts for the inbox badge and the draft_stale event (docs/plans/thread-outcome.md section 11).
import type { Database } from "bun:sqlite";
import { isMe } from "../../shared/me";
import type { ReplyPayload } from "../../shared/review";
import { staleReasons } from "../../shared/stale";
import { byThread, newestLive, type TurnMsg } from "../../shared/turn";
import type { User } from "../../shared/types";
import { touched, UNDONE } from "../review/drafts";
import type { ItemRow } from "../review/run-rows";

export type OpenDraft = ItemRow & { pr: number };
// resolver, resolvedAt: the root comment of a resolved thread only.
type Msg = TurnMsg & { resolver: User | null; resolvedAt: number | null };

const SQL = {
  // A waiting revision, a discarded or posted draft, and a draft of an undone fix never count. $pr null: every PR, without task runs.
  open: `SELECT i.*, r.pr FROM review_item i JOIN review_run r ON r.id = i.run
    WHERE r.pr IS NOT NULL AND ($pr IS NULL OR r.pr = $pr) AND i.kind = 'reply' AND i.thread IS NOT NULL AND i.status IN ('new', 'accepted')
      AND json_extract(i.payload_json, '$.revises') IS NULL AND NOT ${UNDONE} ORDER BY i.id`,
  thread: `SELECT comment_id AS id, root_id AS rootId, author_slug AS authorSlug, author_login AS authorLogin, created_at AS createdAt,
      tombstoned_at IS NOT NULL AS deleted, thread_resolved AS threadResolved, thread_resolver_json, thread_resolved_at
    FROM comment WHERE pr = $pr`,
};

// The current open reply draft of each thread that would post (text or a resolve tick), by PR.
export function openDrafts(db: Database, pr: number | null): Map<number, OpenDraft[]> {
  const current = new Map<string, OpenDraft>();
  for (const r of db.query(SQL.open).all({ pr }) as OpenDraft[]) current.set(`${r.pr}:${r.thread}`, r);
  const posts = (d: OpenDraft) => d.body.trim() !== "" || (JSON.parse(d.payload_json) as ReplyPayload).resolveTick === true;
  return Map.groupBy([...current.values()].filter(posts), (d) => d.pr);
}

// msgs: the messages of the draft's thread. orphanedAt and prHead null: code changed never counts here.
function stale<T extends TurnMsg>(d: OpenDraft, msgs: T[]) {
  const newest = newestLive(msgs);
  const root = msgs.find((m) => m.id === d.thread);
  const payload = JSON.parse(d.payload_json) as ReplyPayload;
  const thread = { newest: newest?.id ?? null, resolved: !!root?.threadResolved, orphanedAt: null };
  return { newest, root, reasons: staleReasons({ body: d.body, payload }, thread, null) };
}

// PrRow.staleDrafts. msgs: every message of the PR.
export function staleCount(drafts: OpenDraft[], msgs: TurnMsg[]): number {
  const threads = byThread(msgs);
  return drafts.filter((d) => stale(d, threads.get(d.thread as number) ?? []).reasons.length > 0).length;
}

// The stale drafts of a PR by `<item>:<reason>`. The value is the draft_stale ref, or null when the draft must not notify:
// the user did not accept or edit it, wrote the newest message, or resolved the thread.
export function staleKeys(db: Database, pr: number, me: string): Map<string, string | null> {
  type Raw = Omit<Msg, "deleted" | "threadResolved" | "resolver" | "resolvedAt"> & {
    deleted: number;
    threadResolved: number;
    thread_resolver_json: string | null;
    thread_resolved_at: number | null;
  };
  const msgs = (db.query(SQL.thread).all({ pr }) as Raw[]).map(
    ({ thread_resolver_json, thread_resolved_at, ...m }): Msg => ({
      ...m,
      deleted: m.deleted === 1,
      threadResolved: m.threadResolved === 1,
      resolver: m.threadResolved === 1 && thread_resolver_json !== null ? (JSON.parse(thread_resolver_json) as User) : null,
      resolvedAt: m.threadResolved === 1 ? thread_resolved_at : null,
    }),
  );
  const threads = byThread(msgs);
  const out = new Map<string, string | null>();
  for (const d of openDrafts(db, pr).get(pr) ?? []) {
    const { newest, root, reasons } = stale(d, threads.get(d.thread as number) ?? []);
    for (const reason of reasons) {
      const own =
        reason === "out-of-date"
          ? newest !== null && isMe({ slug: newest.authorSlug, login: newest.authorLogin }, me)
          : !!root?.resolver && isMe(root.resolver, me);
      const at = reason === "out-of-date" ? newest?.id : root?.resolvedAt;
      out.set(`${d.id}:${reason}`, touched(d) && !own ? `${d.id}:${reason}:${at ?? "none"}` : null);
    }
  }
  return out;
}
