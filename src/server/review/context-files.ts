// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The context files that a run reads from ./context (jobs.ts): findings.md, history.md, fix-state.md, and questions.md.
import type { Database } from "bun:sqlite";
import { indentBlock } from "../../shared/consult";
import type { RunSummary } from "../../shared/dto";
import { isMe } from "../../shared/me";
import {
  type AnchoredFinding,
  type Carried,
  type Finding,
  MAX_ANSWERED,
  parseFixNotes,
  type ReplyPayload,
  severities,
} from "../../shared/review";
import { byThread, newestLive, type TurnMsg } from "../../shared/turn";
import { currentDrafts, touched } from "./drafts";
import { type ItemRow, type RunRow, SQL } from "./run-rows";
import { type AskedThread, type EarlierItem, oneLine } from "./validate";
import type { ContextFile } from "./workspace";

// An earlier finding at the current place of its item. A user move changes the line.
export function earlierItem(r: ItemRow): EarlierItem {
  const { anchor: _anchor, carried: _carried, ...f } = JSON.parse(r.payload_json) as AnchoredFinding & { carried?: Carried };
  const at = r.path !== null && r.side !== null && r.line !== null;
  return {
    id: r.id,
    finding: at ? { ...f, path: r.path as string, side: r.side as Finding["side"], line: r.line as number, lineEnd: r.line_end } : f,
  };
}

const indent = (s: string) =>
  s
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");

// context/findings.md of a re-review or a fix run. Indented blocks, so no stored text can start a heading.
// at: the commit that the lines of the finding count on.
export function findingsFile<R extends ItemRow>(rows: R[], at: (r: R, side: Finding["side"]) => string): ContextFile {
  const out = rows.flatMap((r) => {
    const { finding: f } = earlierItem(r);
    const end = f.lineEnd !== null && f.lineEnd !== f.line ? `-${f.lineEnd}` : "";
    return [
      `## Finding ${r.id}`,
      "",
      `- Path: ${oneLine(f.path)}`,
      `- Side: ${f.side}`,
      `- Lines: ${f.line}${end} at ${at(r, f.side)}`,
      `- Severity: ${f.severity}`,
      "",
      "Code at the finding:",
      "",
      indent(f.anchorText),
      "",
      "Text:",
      "",
      indent(r.body),
      "",
    ];
  });
  return { name: "findings.md", text: out.join("\n") };
}

// Byte caps of the context/history.md sections. The cut drops the blocks after the first block that does not fit.
export const HISTORY_FINDING_BYTES = 60 * 1024;
export const HISTORY_ASK_BYTES = 40 * 1024;

function capped(blocks: string[][], max: number, left: (n: number) => string): string[] {
  const out: string[] = [];
  let used = 0;
  for (const [i, b] of blocks.entries()) {
    const size = Buffer.byteLength(b.join("\n"));
    if (used + size > max) return [...out, left(blocks.length - i), ""];
    used += size;
    out.push(...b);
  }
  return out;
}

// context/history.md of an ask, reply, fix, or plain review run: the newest finished review with its findings, and the earlier answers.
// head: the current source head. null when no earlier result exists. review: null also when no earlier review exists.
export function historyFile(db: Database, pr: number, head: string, review = false): ContextFile | null {
  const run = db.query(`${SQL.run} ${SQL.baseRun}`).get({ pr }) as RunRow | null;
  const asks = db.query(`${SQL.run} ${SQL.historyAsks}`).all({ pr }) as RunRow[];
  if (!run && (review || !asks.length)) return null;
  const out: string[] = [];
  if (run) {
    const summary = run.summary_json ? (JSON.parse(run.summary_json) as RunSummary).summary : "";
    const rank = (r: ItemRow) => severities.indexOf(earlierItem(r).finding.severity);
    const rows = (db.query(SQL.historyItems).all({ run: run.id }) as ItemRow[]).sort((a, b) => rank(a) - rank(b) || a.id - b.id);
    const findings = rows.map((r) => {
      const { finding: f } = earlierItem(r);
      const end = f.lineEnd !== null && f.lineEnd !== f.line ? `-${f.lineEnd}` : "";
      const at = f.side === "new" ? run.source_head : (run.merge_base ?? "the merge base of that run");
      return [
        `### Finding ${r.id}`,
        "",
        `- Path: ${oneLine(f.path)}`,
        `- Side: ${f.side}`,
        `- Lines: ${f.line}${end} at ${at}`,
        `- Severity: ${f.severity}`,
        `- Category: ${oneLine(f.category)}`,
        `- State: ${r.status}`,
        "",
        "Text:",
        "",
        indent(r.body),
        "",
      ];
    });
    out.push(
      "## Latest review",
      "",
      `- Run: ${run.id}`,
      `- Profile: ${oneLine(run.profile_name ?? run.profile)}`,
      `- Status: ${run.status}`,
      `- Reviewed head: ${run.source_head}${run.source_head === head ? "" : ` (the current head is ${head})`}`,
      "",
      "Summary:",
      "",
      indent(summary || "(none)"),
      "",
      ...(findings.length ? capped(findings, HISTORY_FINDING_BYTES, (n) => `${n} more findings left out.`) : ["No findings.", ""]),
    );
  }
  if (asks.length) {
    const blocks = asks.map((r) => [
      `## Ask run ${r.id}`,
      "",
      `- Head: ${r.source_head}`,
      "",
      "Question:",
      "",
      indent(r.question ?? ""),
      "",
      "Answer:",
      "",
      indent(r.answer ?? ""),
      "",
    ]);
    out.push(...capped(blocks, HISTORY_ASK_BYTES, (n) => `${n} earlier ask runs left out.`));
  }
  return { name: "history.md", text: out.join("\n") };
}

const FIX_STATE = {
  notes: "SELECT id, fix_json FROM review_run WHERE pr = $pr AND kind = 'fix' AND fix_json IS NOT NULL ORDER BY id DESC",
  // The newest fix commit that holds an edit of the thread and is not undone. held of total: its share of the edits of its run.
  commit: `SELECT c.short_hash AS short,
      EXISTS (SELECT 1 FROM pr_commit k WHERE k.pr = c.pr AND k.hash = c.commit_hash) AS pushed,
      (SELECT COUNT(*) FROM fix_edit e WHERE e.run = c.run AND e.thread = $thread) AS total,
      (SELECT COUNT(*) FROM fix_edit e WHERE e.run = c.run AND e.thread = $thread AND e.id IN (SELECT value FROM json_each(c.edits_json))) AS held
    FROM fix_commit c WHERE c.pr = $pr AND c.state <> 'undone' ORDER BY c.id DESC`,
};

// context/fix-state.md of a reply run (docs/plans/thread-outcome.md WP-S4): per thread, the newest fix note, the fix commit, and the
// current open draft. null when no thread has any of them. Free text goes in indented blocks.
export function fixStateFile(db: Database, pr: number, threads: number[]): ContextFile | null {
  const runs = (db.query(FIX_STATE.notes).all({ pr }) as { id: number; fix_json: string }[]).map((r) => ({
    id: r.id,
    notes: parseFixNotes(r.fix_json),
  }));
  const drafts = currentDrafts(db, pr);
  const out: string[] = [];
  for (const thread of threads) {
    const found = runs.flatMap((r) => r.notes.filter((n) => n.thread === thread).map((n) => ({ run: r.id, n })))[0];
    type C = { short: string | null; pushed: number; total: number; held: number };
    const commit = (db.query(FIX_STATE.commit).all({ pr, thread }) as C[]).find((c) => c.held > 0);
    const cur = drafts.get(thread);
    const draft = cur && (cur.status === "new" || cur.status === "accepted") ? cur : null;
    if (!found && !commit && !draft) continue;
    out.push(`## Thread ${thread}`, "");
    if (found) {
      const { n } = found;
      out.push(
        `- Fix note of fix run ${found.run}: ${n.fixed ? "fixed" : "no fix"}${n.why ? `, why ${n.why}` : ""}${n.declined ? ", declined by the user" : ""}`,
        "",
        "Note reason:",
        "",
        indentBlock(n.reason || "(none)"),
        "",
        "Note reply:",
        "",
        indentBlock(n.reply || "(none)"),
        "",
        ...(n.declined ? ["Decline reason:", "", indentBlock(n.declined.reason), ""] : []),
      );
    } else out.push("- Fix note: none");
    if (!commit) out.push("- Fix commit: none");
    else if (!commit.short) out.push("- Fix commit: staged in the clone, not committed");
    else
      out.push(
        `- Fix commit: ${commit.held < commit.total ? "Partly fixed" : "Fixed"} in ${commit.short} (${commit.pushed ? "on the pull request" : "not on the pull request yet"})`,
      );
    if (!draft) out.push("- Current draft: none", "");
    else {
      const p = JSON.parse(draft.payload_json) as ReplyPayload;
      const state = draft.status === "accepted" ? "accepted by the user" : draft.edited ? "edited by the user" : "not accepted";
      out.push(
        `- Current draft: ${state}, origin ${p.origin ?? (p.fix ? "fix" : "unknown")}${p.declined ? `, declines the fix of run ${p.declined.run}` : ""}`,
        "",
        "Draft text:",
        "",
        indentBlock(draft.body || "(empty)"),
        "",
      );
    }
  }
  return out.length ? { name: "fix-state.md", text: out.join("\n") } : null;
}

// docs/plans/thread-outcome.md section 9. posts: the confirmed general and inline posts of review items in open threads.
const ASKED = {
  posts: `SELECT p.remote_id AS root, p.kind, p.items_json FROM post p
    JOIN comment c ON c.pr = p.pr AND c.comment_id = p.remote_id AND c.parent_id IS NULL AND c.tombstoned_at IS NULL AND c.thread_resolved = 0
    WHERE p.pr = $pr AND p.run IS NOT NULL AND p.kind IN ('general', 'inline') AND p.state = 'confirmed' ORDER BY p.remote_id`,
  messages: `SELECT comment_id AS id, root_id AS rootId, author_slug AS authorSlug, author_login AS authorLogin, created_at AS createdAt, text,
      thread_resolved AS threadResolved FROM comment WHERE pr = $pr AND tombstoned_at IS NULL ORDER BY created_at, comment_id`,
};
// The byte cap of context/questions.md. The cut drops the threads after the first thread that does not fit.
export const QUESTIONS_BYTES = 60 * 1024;

// context/questions.md of a review or re-review run: each open thread that holds items that the user posted from earlier runs, when
// another person wrote its newest live message. A general comment holds its questions and outside findings, an inline comment one finding.
// Each item is one question, numbered in post order. A touched out-of-date draft of the thread is revised (ReplyThread.revise).
// me: null gives no file, because no message can count as the user's. left: the threads that the byte cap or MAX_ANSWERED left out.
export function questionsFile(
  db: Database,
  pr: number,
  me: string | null,
): { threads: AskedThread[]; file: ContextFile | null; left: number } {
  const none = { threads: [], file: null, left: 0 };
  if (me === null) return none;
  type Msg = TurnMsg & { text: string };
  const rows = db.query(ASKED.messages).all({ pr }) as (Omit<Msg, "deleted" | "threadResolved"> & { threadResolved: number })[];
  const threads = byThread(rows.map((m): Msg => ({ ...m, deleted: false, threadResolved: m.threadResolved === 1 })));
  const drafts = currentDrafts(db, pr);
  const mineMsg = (m: TurnMsg) => isMe({ slug: m.authorSlug, login: m.authorLogin }, me);
  const blocks: { thread: AskedThread; lines: string[] }[] = [];
  for (const p of db.query(ASKED.posts).all({ pr }) as { root: number; kind: "general" | "inline"; items_json: string }[]) {
    const items = (JSON.parse(p.items_json) as { id: number }[]).flatMap((x) => {
      const r = db.query(SQL.itemById).get({ id: x.id }) as ItemRow | null;
      return r && r.status === "posted" && (r.kind === "question" || r.kind === "finding") ? [r] : [];
    });
    const msgs = threads.get(p.root) ?? [];
    const root = msgs.find((m) => m.id === p.root);
    const last = newestLive(msgs);
    if (!items.length || !root || !last || last.id === p.root || mineMsg(last)) continue;
    const cur = drafts.get(p.root);
    const stale = !!cur && touched(cur) && (JSON.parse(cur.payload_json) as ReplyPayload).replyTo !== last.id;
    const at = (r: ItemRow) => (r.path === null ? "" : ` on ${oneLine(r.path)}${r.line === null ? "" : ` line ${r.line}`}`);
    const first = items[0] as ItemRow;
    const lines = [
      `## Thread ${p.root}`,
      "",
      `- Place: ${p.kind === "general" ? "the general comment of a review" : `an inline comment${at(first)}`}`,
      `- The user started the thread in message ${p.root}. The newest message is ${last.id}.`,
      "",
      ...items.flatMap((r, i) => [
        `### Question ${i + 1}`,
        "",
        `- Asked by the user: ${r.kind === "question" ? "a question" : `a finding${at(r)}`}`,
        "",
        indentBlock(r.body),
        "",
      ]),
      ...msgs
        .filter((m) => m.id !== p.root)
        .flatMap((m) => [`### Message ${m.id} by ${mineMsg(m) ? "the user" : "another person"}`, "", indentBlock(m.text), ""]),
      ...(stale && cur
        ? [`### Draft of the user, ${cur.status === "accepted" ? "accepted" : "edited"}`, "", indentBlock(cur.body || "(empty)"), ""]
        : []),
    ];
    blocks.push({
      thread: {
        thread: p.root,
        replyTo: last.id,
        mine: mineMsg(root),
        questions: items.length,
        ...(stale && cur && { revise: cur.id }),
      },
      lines,
    });
  }
  const kept: AskedThread[] = [];
  const out: string[] = [];
  let used = 0;
  let count = 0;
  for (const [i, b] of blocks.entries()) {
    const size = Buffer.byteLength(b.lines.join("\n"));
    if (used + size > QUESTIONS_BYTES || count + b.thread.questions > MAX_ANSWERED) {
      out.push(`${blocks.length - i} more threads left out.`, "");
      return { threads: kept, file: kept.length ? { name: "questions.md", text: out.join("\n") } : null, left: blocks.length - i };
    }
    used += size;
    count += b.thread.questions;
    out.push(...b.lines);
    kept.push(b.thread);
  }
  return kept.length ? { threads: kept, file: { name: "questions.md", text: out.join("\n") }, left: 0 } : none;
}
