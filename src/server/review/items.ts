// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Triage of review items (plan v3 WP12): accept, discard, restore, edit, move, and the resolve tick of a reply draft.
import type { Database } from "bun:sqlite";
import type { ItemActionInput, ItemConflict, ReviewItemDto } from "../../shared/dto";
import {
  type AnchoredFinding,
  type AnchorState,
  diffLine,
  type ExcerptLine,
  type FixedMark,
  moveChoices,
  type ReplyPayload,
  type SessionMark,
} from "../../shared/review";
import { type ItemRow, toItemDto } from "./jobs";

export type TriageResult =
  | { status: 200; item: ReviewItemDto; pr: number }
  | { status: 404 }
  | { status: 400; error: string }
  | { status: 409; conflict: ItemConflict };

const SQL = {
  item: "SELECT i.*, r.pr FROM review_item i JOIN review_run r ON r.id = i.run WHERE i.id = $id",
  // The revision check and the write are one statement, so two pages cannot both win.
  update: `UPDATE review_item SET status = $status, body = $body, edited = $edited, line = $line, line_end = $line_end,
      anchor_state = $anchor_state, payload_json = $payload_json, revision = revision + 1
    WHERE id = $id AND revision = $revision AND status != 'posted'`,
  undone: "SELECT 1 FROM fix_commit WHERE id = $id AND state = 'undone'",
  pushed: "SELECT 1 FROM pr_commit WHERE pr = $pr AND hash = $hash",
  otherOpen: `SELECT 1 FROM review_item i JOIN review_run r ON r.id = i.run
    WHERE r.pr = $pr AND i.kind = 'reply' AND i.thread = $thread AND i.id <> $id AND i.status IN ('new', 'accepted')`,
};

type Row = ItemRow & { pr: number };

export function triage(db: Database, id: number, input: ItemActionInput): TriageResult {
  const row = db.query(SQL.item).get({ id }) as Row | null;
  if (!row) return { status: 404 };
  const conflict = (error: string): TriageResult => ({ status: 409, conflict: { error, item: toItemDto(row) } });
  if (row.status === "posted") return conflict("The item is posted.");
  if (row.revision !== input.revision) return conflict("The item changed on another page. Check it again.");

  // Plan r2 S-RR: a carried finding whose code is gone has no anchor. The post plan cannot place it.
  if (row.kind === "finding" && input.action !== "discard" && (row.path === null || row.side === null || row.line === null))
    return { status: 400, error: "The finding has no place in the code." };
  const next = { ...row };
  const reply = row.kind === "reply" ? (JSON.parse(row.payload_json) as ReplyPayload) : null;
  const ticked = reply?.resolveTick === true;
  // A "Fixed in" draft of an undone commit can never post (outbox.ts fixCheck), so it stays discarded.
  if (reply?.fix && input.action !== "discard" && db.query(SQL.undone).get({ id: reply.fix.id }))
    return conflict("The fix commit was undone, so this draft cannot post. Draft the reply again.");
  // One open draft per thread.
  const opens =
    row.status === "discarded" &&
    (input.action === "accept" || input.action === "restore" || input.action === "edit" || input.action === "plain");
  if (reply && opens && db.query(SQL.otherOpen).get({ pr: row.pr, thread: row.thread, id }))
    return conflict("Another reply draft of this thread is open. Discard it first.");
  switch (input.action) {
    case "accept":
      // A reply draft with action none has no body. A ticked draft without a body only resolves the thread.
      if (row.kind === "reply" && !row.body.trim() && !ticked)
        return { status: 400, error: "Write the reply first, or tick Resolve after posting." };
      next.status = "accepted";
      break;
    case "discard":
      next.status = "discarded";
      break;
    case "restore": {
      // docs/plans/fix-ux.md decision 3: a restore of a finding that a fix commit discarded returns its earlier status. The mark stays.
      // session-consult.md part C: a session reject discards only open findings, so its mark is newer than a fixed mark. The restore
      // returns its status and removes it.
      // A "Don't fix" decline (fix-routes.ts) is newer than a fixed mark: a declined proposal has no commit.
      const p = JSON.parse(row.payload_json) as { fixed?: FixedMark; session?: SessionMark; declined?: { was: ReviewItemDto["status"] } };
      const rejected = row.status === "discarded" && p.session?.verdict === "reject" ? p.session : null;
      next.status = row.status === "discarded" ? (rejected?.was ?? p.declined?.was ?? p.fixed?.was ?? "new") : "new";
      if (rejected) {
        const { session: _, ...rest } = p;
        next.payload_json = JSON.stringify(rest);
      }
      break;
    }
    case "edit":
      next.status = "accepted";
      next.body = input.body;
      next.edited = 1;
      break;
    case "move": {
      if (row.kind !== "finding" || row.side === null || row.excerpt_json === null)
        return { status: 400, error: "Only a finding can move." };
      const excerpt = JSON.parse(row.excerpt_json) as ExcerptLine[];
      if (!moveChoices(excerpt, row.side).includes(input.line)) return { status: 400, error: "The line is not in the code excerpt." };
      const found = (JSON.parse(row.payload_json) as AnchoredFinding).anchor;
      // Back on the validator's line, the validator's state applies again.
      const state: AnchorState =
        input.line === found.line && input.line === found.lineEnd
          ? found.state
          : diffLine(excerpt, row.side, input.line)
            ? "exact"
            : "outside";
      next.line = input.line;
      next.line_end = input.line;
      next.anchor_state = state;
      break;
    }
    case "resolve": {
      if (row.kind !== "reply") return { status: 400, error: "Only a reply draft can resolve its thread." };
      next.payload_json = JSON.stringify({ ...(JSON.parse(row.payload_json) as ReplyPayload), resolveTick: input.resolve });
      // An accepted draft without a body has nothing to post once the tick is off.
      if (!input.resolve && !row.body.trim() && row.status === "accepted") next.status = "new";
      break;
    }
    case "plain": {
      // docs/plans/thread-outcome.md: a rebased or squashed fix commit never reaches the PR. Without the link, the draft posts as a reply.
      if (!reply?.fix) return { status: 400, error: "Only a Fixed in draft can become a plain reply." };
      if (db.query(SQL.pushed).get({ pr: row.pr, hash: reply.fix.commit }))
        return { status: 400, error: "The commit is on the pull request. The draft posts as it is." };
      const { fix: _, ...rest } = reply;
      next.payload_json = JSON.stringify({ ...rest, origin: "user" } satisfies ReplyPayload);
      next.status = "accepted";
      break;
    }
  }
  const done = db.query(SQL.update).run({
    id,
    revision: input.revision,
    status: next.status,
    body: next.body,
    edited: next.edited,
    line: next.line,
    line_end: next.line_end,
    anchor_state: next.anchor_state,
    payload_json: next.payload_json,
  });
  const now = db.query(SQL.item).get({ id }) as Row;
  if (!done.changes) return { status: 409, conflict: { error: "The item changed on another page. Check it again.", item: toItemDto(now) } };
  return { status: 200, item: toItemDto(now), pr: row.pr };
}
