// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Discuss a finding (docs/plans/review-v2/spec.md sections 2.2 to 2.5): the turns of a finding, the thread of a posted finding, and the
// apply of a discuss result at the run end. jobs.ts runs each turn as one run in the run slot. Nothing here posts.
import type { Database } from "bun:sqlite";
import type { DiscussTurnDto, ItemStatus } from "../../shared/dto";
import { isMe } from "../../shared/me";
import type { DiscussRecord, DiscussResult, FindingPayload, ReplyPayload, WithdrawnMark } from "../../shared/review";
import { newestLive, type TurnMsg } from "../../shared/turn";
import type { DiscussTurnRow } from "./context-files";
import { checkCites, liveThreads, type NoteRow, toNoteDto } from "./notes";
import type { ReplyThread } from "./prompt";
import { type ItemRow, type NewItem, NO_ANCHOR } from "./run-rows";

const SQL = {
  turns: `SELECT id, status, source_head, question, answer, discuss_json, error_text, started_at FROM review_run
    WHERE item = $item AND kind = 'discuss' ORDER BY id`,
  count: "SELECT COUNT(*) AS n FROM review_run WHERE item = $item AND kind = 'discuss'",
  // A finding of a task run (pr NULL) takes no talk.
  item: "SELECT i.*, r.pr FROM review_item i JOIN review_run r ON r.id = i.run WHERE i.id = $id AND r.pr IS NOT NULL",
  // The newest confirmed post that holds the finding. Its remote comment starts the thread. A general post holds many items.
  post: `SELECT p.remote_id AS root FROM post p, json_each(p.items_json) j
    WHERE p.pr = $pr AND p.state = 'confirmed' AND p.remote_id IS NOT NULL AND p.kind IN ('inline', 'general')
      AND json_extract(j.value, '$.id') = $item ORDER BY p.id DESC LIMIT 1`,
  thread: `SELECT comment_id AS id, root_id AS rootId, author_slug AS authorSlug, author_login AS authorLogin, created_at AS createdAt,
      tombstoned_at IS NOT NULL AS deleted, thread_resolved AS threadResolved FROM comment WHERE pr = $pr AND root_id = $root`,
  notes: "SELECT * FROM pr_note WHERE run = $run AND deleted_at IS NULL AND state = 'proposed' ORDER BY created_at, id",
  // A newer revision of a finding ends the wait of the older ones. shared/review.ts says why the rows stay.
  dropRevisions: `UPDATE review_item SET payload_json = json_set(payload_json, '$.dropped', json('true')), revision = revision + 1
    WHERE kind = 'finding' AND status = 'discarded' AND json_extract(payload_json, '$.revises') = $finding
      AND json_extract(payload_json, '$.dropped') IS NULL`,
  revision: `INSERT INTO review_item (run, kind, payload_json, body, path, side, line, line_end, anchor_state, excerpt_json, status, thread, edited)
    VALUES ($run, 'finding', $payload, $body, $path, $side, $line, $line_end, $anchor_state, $excerpt_json, 'discarded', NULL, 0) RETURNING id`,
  withdraw: `UPDATE review_item SET status = 'discarded', payload_json = $payload, revision = revision + 1
    WHERE id = $id AND revision = $revision AND status = $status`,
  draft: "SELECT id FROM review_item WHERE run = $run AND kind = 'reply' AND thread = $thread ORDER BY id DESC LIMIT 1",
  record: "UPDATE review_run SET discuss_json = $json WHERE id = $id",
};

export type FindingItem = ItemRow & { pr: number };
type TurnRow = DiscussTurnRow & { error_text: string | null; started_at: number };

export const findingItem = (db: Database, id: number) => db.query(SQL.item).get({ id }) as FindingItem | null;
export const turnCount = (db: Database, item: number) => (db.query(SQL.count).get({ item }) as { n: number }).n;
// The earlier turns of a run: the turns of its finding before it, oldest first.
export const earlierTurns = (db: Database, item: number, run: number) =>
  (db.query(SQL.turns).all({ item }) as TurnRow[]).filter((t) => t.id < run);

// item: the finding. run: the run of the finding. revision, status: the finding at the start. thread: the thread of a posted finding
// with a live message, else null. paths: the path and the old path of the finding, for the sort of ./context/pr-context.md.
export type DiscussStart = {
  item: number;
  run: number;
  revision: number;
  status: ItemStatus;
  message: string;
  thread: ReplyThread | null;
  paths: string[];
};

// The thread of a posted finding. null: no confirmed post holds it, or the thread has no live message.
export function postedThread(db: Database, pr: number, item: number, me: string | null): ReplyThread | null {
  const post = db.query(SQL.post).get({ pr, item }) as { root: number } | null;
  if (!post) return null;
  type Row = Omit<TurnMsg, "deleted" | "threadResolved"> & { deleted: number; threadResolved: number };
  const msgs = (db.query(SQL.thread).all({ pr, root: post.root }) as Row[]).map((m) => ({
    ...m,
    deleted: m.deleted === 1,
    threadResolved: m.threadResolved === 1,
  }));
  const last = newestLive(msgs);
  if (!last) return null;
  const mine = (m: TurnMsg) => isMe({ slug: m.authorSlug, login: m.authorLogin }, me);
  const root = msgs.find((m) => m.id === post.root);
  return { thread: post.root, replyTo: last.id, mine: !!root && mine(root), joined: msgs.some((m) => !m.deleted && mine(m)) };
}

// GET /api/items/:id/discuss.
export function discussTurns(db: Database, item: number): DiscussTurnDto[] {
  return (db.query(SQL.turns).all({ item }) as TurnRow[]).map((t) => {
    const d = t.discuss_json ? (JSON.parse(t.discuss_json) as DiscussRecord) : null;
    return {
      run: t.id,
      status: t.status,
      message: t.question ?? "",
      answer: t.answer,
      verdict: d?.verdict ?? null,
      reason: d?.reason ?? null,
      revision: d?.revision ?? null,
      at: t.started_at,
      error: t.status === "failed" ? t.error_text : null,
      cites: d?.cites ?? [],
      notes: (db.query(SQL.notes).all({ run: t.id }) as NoteRow[]).map(toNoteDto),
      applied: d?.applied ?? {},
      changed: d?.changed === true,
    };
  });
}

// The writes of applyDiscuss. items: the reply draft for the thread of a posted finding; jobs.ts end() stores it with the writer rules
// of a reply run (drafts.ts replyOutcome and placeReplies). skipped: the coverage lines.
export type DiscussPlan = {
  record: Omit<DiscussRecord, "notes" | "applied">;
  items: NewItem[];
  revision: { run: number; item: NewItem } | null;
  withdraw: { payload: string; revision: number; status: ItemStatus } | null;
  skipped: string[];
};

const sameText = (a: string | undefined, b: string | undefined) => (a ?? "").trim() === (b ?? "").trim();

// spec.md section 2.5. Reads only. A finding that changed during the run (an edit, an accept, a discard, a post) gets nothing.
export function planDiscuss(db: Database, run: { id: number; pr: number }, s: DiscussStart, r: DiscussResult): DiscussPlan {
  const cited = checkCites(r.cites, s.thread?.thread ?? null, new Set(liveThreads(db, run.pr, null).keys()), "the answer");
  const record = { verdict: r.verdict, reason: r.reason, revision: r.revision, reply: r.reply, cites: cited.cites };
  const plan: DiscussPlan = { record, items: [], revision: null, withdraw: null, skipped: [...cited.skipped] };
  const cur = findingItem(db, s.item);
  if (!cur || cur.revision !== s.revision || cur.status !== s.status) return { ...plan, record: { ...record, changed: true } };
  const p = JSON.parse(cur.payload_json) as FindingPayload;
  const withdrawn = r.verdict === "withdrawn";
  if (s.status === "posted") {
    const body = r.reply.trim();
    if (!body) return plan;
    const t = s.thread;
    if (!t) return { ...plan, skipped: [...plan.skipped, "No reply draft: the thread of the posted finding has no live message."] };
    // validate.ts validateReplies: a resolve proposal has the settled judgement, and only a thread that the user started is ticked.
    const payload: ReplyPayload = {
      thread: t.thread,
      action: "reply",
      body,
      reason: r.reason,
      evidenceStatus: "unverified",
      judgement: withdrawn ? "settled" : null,
      resolve: withdrawn,
      resolveEvidence: withdrawn ? r.reason.trim() : "",
      resolveTick: withdrawn && t.mine === true,
      cites: cited.cites,
      replyTo: t.replyTo,
      origin: "discuss",
    };
    plan.items.push({
      kind: "reply",
      payload_json: JSON.stringify(payload),
      body,
      ...NO_ANCHOR,
      status: "new",
      thread: t.thread,
      edited: 0,
    });
    return plan;
  }
  if (s.status !== "new" && s.status !== "accepted") return plan;
  if (withdrawn) {
    const { discardReason: _, ...rest } = p as FindingPayload & { discardReason?: unknown };
    const mark: WithdrawnMark = { run: run.id, reason: r.reason, was: s.status };
    plan.withdraw = { payload: JSON.stringify({ ...rest, withdrawn: mark }), revision: s.revision, status: s.status };
    return plan;
  }
  if (r.verdict !== "revised") return plan;
  const rev = r.revision;
  if (!rev) return { ...plan, skipped: [...plan.skipped, "The answer changed the point but gave no new text. Nothing was stored."] };
  // The current text is the user's text when the user edited the finding.
  if (rev.severity === p.severity && sameText(rev.title, p.title) && sameText(rev.body, cur.body)) return plan;
  const payload: FindingPayload = { ...p, severity: rev.severity, title: rev.title, body: rev.body, revises: cur.id, discussedIn: run.id };
  plan.revision = {
    run: cur.run,
    item: {
      kind: "finding",
      payload_json: JSON.stringify(payload),
      body: rev.body,
      path: cur.path,
      side: cur.side,
      line: cur.line,
      line_end: cur.line_end,
      anchor_state: cur.anchor_state,
      excerpt_json: cur.excerpt_json,
      status: "discarded",
      thread: null,
      edited: 0,
    },
  };
  return plan;
}

// The writes of a plan, in the transaction of the run end, after the reply draft and the note suggestions. notes: their IDs.
// Returns the stored record.
export function applyDiscuss(db: Database, run: number, s: DiscussStart, plan: DiscussPlan, notes: number[]): DiscussRecord {
  const applied: DiscussRecord["applied"] = {};
  if (plan.items.length && s.thread) {
    const d = db.query(SQL.draft).get({ run, thread: s.thread.thread }) as { id: number } | null;
    if (d) applied.draft = d.id;
  }
  if (plan.revision) {
    db.query(SQL.dropRevisions).run({ finding: s.item });
    const it = plan.revision.item;
    const r = db.query(SQL.revision).get({
      run: plan.revision.run,
      payload: it.payload_json,
      body: it.body,
      path: it.path,
      side: it.side,
      line: it.line,
      line_end: it.line_end,
      anchor_state: it.anchor_state,
      excerpt_json: it.excerpt_json,
    }) as { id: number };
    applied.revision = r.id;
  }
  if (plan.withdraw && db.query(SQL.withdraw).run({ id: s.item, ...plan.withdraw }).changes) applied.discarded = true;
  const record: DiscussRecord = { ...plan.record, notes, applied };
  db.query(SQL.record).run({ id: run, json: JSON.stringify(record) });
  return record;
}
