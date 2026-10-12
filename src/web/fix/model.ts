// Pure Fix it rules (plan r3 UI-FIX). No DOM access, so bun test runs them directly.
import type { CommitDto, FixCommitDto, FixDto, FixEditDto, ReviewItemDto, RunDto } from "../../shared/dto";
import { type Judgement, MAX_REPLY_THREADS, type ReplyPayload } from "../../shared/review";
import { plural, shortHash } from "../review/model";

// Judgement null means "no action": no chip and no Fix.
export const JUDGEMENT: Record<Judgement, string> = {
  valid: "Valid",
  partly: "Partly valid",
  invalid: "Not valid",
  question: "Question",
};

// Plan r3 section 1: only valid and partly offer Fix, and only on the user's own pull request.
export const canFix = (p: ReplyPayload, author: boolean) => author && (p.judgement === "valid" || p.judgement === "partly");

// jobs.ts fixThreads without a list: each thread whose newest unposted reply draft finds the comment valid or partly valid,
// and that has a live message. drafts: GET /api/prs/:id/reply-drafts. live: the threads with a live message.
export function fixThreads(drafts: ReviewItemDto[] | undefined, live: ReadonlySet<number>): number[] {
  return (drafts ?? []).flatMap((it) => {
    const p = it.payload as ReplyPayload;
    return it.kind === "reply" && (p.judgement === "valid" || p.judgement === "partly") && live.has(p.thread) ? [p.thread] : [];
  });
}

// The "Fix all valid" button. The server refuses more than MAX_REPLY_THREADS threads in one run.
export function fixAllButton(n: number, profile: string): { disabled: boolean; hint: string } {
  if (!n) return { disabled: true, hint: "No reply draft finds a comment valid or partly valid. Draft replies first." };
  if (n > MAX_REPLY_THREADS)
    return {
      disabled: true,
      hint: `${n} threads have a valid reply draft. Fix at most ${MAX_REPLY_THREADS} at a time: use Fix in each reply draft.`,
    };
  const which = n === 1 ? "the comment" : `each of the ${n} comments`;
  return {
    disabled: false,
    hint: `Propose code edits for ${which} that the reply drafts find valid or partly valid. Profile: ${profile}.`,
  };
}

// ---------- Edits and their selection ----------

// The edits of a run that no commit holds. An undone commit frees its edits.
export function freeEdits(f: FixDto): FixEditDto[] {
  const used = new Set(f.commits.filter((c) => c.state !== "undone").flatMap((c) => c.edits));
  return f.edits.filter((e) => !used.has(e.id));
}

// ticks: the choice of the user per edit ID. Without a choice, the edits of the newest run are ticked and older ones are not.
export function selection(f: FixDto, newest: boolean, ticks: ReadonlyMap<number, boolean>) {
  const edits = freeEdits(f).filter((e) => ticks.get(e.id) ?? newest);
  return { edits: edits.map((e) => e.id), threads: [...new Set(edits.map((e) => e.thread))] };
}

export const applyText = (edits: number, threads: number) => `Apply ${plural(edits, "edit")} from ${plural(threads, "comment")}`;

// Plan r3: the default first line names the comment or the comment count. The body has one line per thread with its reason,
// cut at 200 characters. White space becomes one space, and control characters go.
export function defaultMessage(prId: number, threads: number[], notes: FixDto["threads"]): string {
  const head =
    threads.length === 1 ? `Fix review comment ${threads[0]} on PR ${prId}` : `Fix ${threads.length} review comments on PR ${prId}`;
  const body = threads.map((t) => {
    const raw = notes.find((n) => n.thread === t)?.reason ?? "";
    const reason = [
      ...raw
        .replace(/\s+/gu, " ")
        .replace(/\p{Cc}/gu, "")
        .trim(),
    ]
      .slice(0, 200)
      .join("");
    return reason ? `- Comment ${t}: ${reason}` : `- Comment ${t}`;
  });
  return [head, "", ...body].join("\n");
}

// clone.ts fixRef without the commit row ID, which exists only after the commit. prId: the PR number on the forge.
export const appRefPrefix = (prId: number) => `refs/rl/${prId}/fix-commit/`;

// Cache mode: the fast-forward keeps the hash, so the "Fixed in" reply rule still holds.
export const fetchCommands = (f: { cache: string; ref: string }) => [`git fetch "${f.cache}" ${f.ref}`, "git merge --ff-only FETCH_HEAD"];

export function commitText(c: FixCommitDto): string {
  const short = c.short ?? (c.commit ? shortHash(c.commit) : "");
  if (c.state === "undone") return `You undid the fix commit${short ? ` ${short}` : ""}.`;
  if (c.state === "staged")
    return "The edits are staged in your clone, but the commit did not finish. Fix the problem, then commit in your clone, or Undo.";
  return c.mode === "clone"
    ? `Committed ${short} on ${c.branch ?? "the branch"} in your clone. Push it when you are ready.`
    : `Committed ${short} to an app branch. Run these commands in your clone:`;
}

// ---------- One thread ----------

export type FixNote = FixDto["threads"][number];

// running: a fix run that this page started for the thread runs now. failed: that run failed or was cancelled.
// none: that run ended without a note or an edit for the thread. done: the newest run with a note or an edit for the thread.
// commit: the newest commit of that run that holds an edit of the thread and is not undone.
export type FixState =
  | { kind: "running" }
  | { kind: "failed"; run: RunDto }
  | { kind: "none"; run: RunDto }
  | { kind: "done"; fix: FixDto; newest: boolean; note: FixNote | null; edits: FixEditDto[]; commit: FixCommitDto | null };

// fixes: GET /api/prs/:id/fixes, newest first. asked: the run that this page started, with its threads.
export function fixState(fixes: FixDto[] | undefined, thread: number, asked: { run: number; threads: number[] } | null): FixState | null {
  const list = fixes ?? [];
  const touches = (f: FixDto) => f.threads.some((n) => n.thread === thread) || f.edits.some((e) => e.thread === thread);
  if (asked?.threads.includes(thread)) {
    const own = list.find((f) => f.run.id === asked.run);
    if (!own || own.run.status === "running") return { kind: "running" };
    if (own.run.status === "failed" || own.run.status === "cancelled") return { kind: "failed", run: own.run };
    if (!touches(own)) return { kind: "none", run: own.run };
  }
  const i = list.findIndex(touches);
  const fix = list[i];
  if (!fix) return null;
  const edits = fix.edits.filter((e) => e.thread === thread);
  const ids = new Set(edits.map((e) => e.id));
  const commit = fix.commits.find((c) => c.state !== "undone" && c.edits.some((id) => ids.has(id))) ?? null;
  return { kind: "done", fix, newest: i === 0, note: fix.threads.find((n) => n.thread === thread) ?? null, edits, commit };
}

// The "Fixed in" reply posts only when the PR commits hold its commit (outbox.ts fixCheck). Returns the short hash to wait for.
export function fixWaiting(p: ReplyPayload, commits: CommitDto[] | undefined, fixes: FixDto[] | undefined): string | null {
  const fix = p.fix;
  if (!fix || commits?.some((c) => c.hash === fix.commit)) return null;
  const row = fixes?.flatMap((f) => f.commits).find((c) => c.id === fix.id);
  return row?.short ?? shortHash(fix.commit);
}
