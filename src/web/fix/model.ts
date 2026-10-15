// Pure Fix it rules (plan r3 UI-FIX, docs/plans/fix-ux.md). No DOM access, so bun test runs them directly.
import type { CommitDto, FixCommitDto, FixDto, FixEditDto, ReviewItemDto, RunDto } from "../../shared/dto";
import { type Judgement, MAX_REPLY_THREADS, type ReplyPayload } from "../../shared/review";
import { ordered, snippet, type ThreadModel } from "../pr/threads";
import { lineText, plural, shortHash } from "../review/model";

// Judgement null means "no action": no chip, and no tick at the start of the Fix list.
export const JUDGEMENT: Record<Judgement, string> = {
  valid: "Valid",
  partly: "Partly valid",
  invalid: "Not valid",
  question: "Question",
};

// ---------- The Fix list (plan pr-view-v4 2.12, fix-ux Option A) ----------

// One open, unresolved thread with a live message. badge: own for your comment, posted for a finding that the app posted.
// judgement: the newest unposted reply draft. fixed: the short hash of a fix commit that holds an edit of the thread.
// tick: the tick at the start.
export type FixRow = {
  thread: number;
  who: string;
  place: string;
  badge: "own" | "posted" | null;
  judgement: Judgement | null;
  fixed: string | null;
  text: string;
  tick: boolean;
};

// resolved, deleted: the threads that the list leaves out. A deleted thread has no live message.
export type FixTargets = { rows: FixRow[]; resolved: number; deleted: number };

const placeText = (t: ThreadModel) => {
  const a = t.anchor;
  if (!a) return "General comment";
  return a.line === undefined ? a.path : `${a.path}:${lineText({ line: a.line, lineEnd: a.lineEnd ?? a.line })}`;
};

// threads: in any order; the rows come in screen order. replies: GET /api/prs/:id/reply-drafts. fixes: GET /api/prs/:id/fixes.
// Decision D6: your own comments and posted findings start unticked. Valid and partly valid start ticked, unless a commit fixed them.
export function fixTargets(threads: ThreadModel[], replies: ReviewItemDto[] | undefined, fixes: FixDto[] | undefined): FixTargets {
  const judged = new Map<number, Judgement | null>();
  for (const it of replies ?? [])
    if (it.kind === "reply") judged.set((it.payload as ReplyPayload).thread, (it.payload as ReplyPayload).judgement ?? null);
  const fixedIn = new Map<number, string>();
  for (const f of fixes ?? [])
    for (const c of f.commits) {
      if (c.state !== "committed") continue;
      for (const e of f.edits)
        if (e.thread !== undefined && c.edits.includes(e.id) && !fixedIn.has(e.thread))
          fixedIn.set(e.thread, c.short ?? shortHash(c.commit ?? ""));
    }
  const out: FixTargets = { rows: [], resolved: 0, deleted: 0 };
  for (const t of ordered(threads, false)) {
    if (!t.last) {
      out.deleted++;
      continue;
    }
    if (t.turn === "resolved") {
      out.resolved++;
      continue;
    }
    const head = t.root.deleted ? t.last : t.root;
    const badge = t.root.posted === "run" ? "posted" : t.root.who.me ? "own" : null;
    const judgement = judged.get(t.id) ?? null;
    const fixed = fixedIn.get(t.id) ?? null;
    out.rows.push({
      thread: t.id,
      who: head.who.me ? "You" : head.who.name,
      place: placeText(t),
      badge,
      judgement,
      fixed,
      text: snippet(head.text, 160),
      tick: badge === null && fixed === null && (judgement === "valid" || judgement === "partly"),
    });
  }
  return out;
}

// The f key on one thread. null: the Fix list can tick it. Else the reason, as a toast.
export function threadFixWhy(t: ThreadModel | undefined): string | null {
  if (!t) return "Move to a thread first. F opens the Fix list.";
  if (!t.last) return "Every message of this thread is deleted. Fix needs a live message.";
  if (t.turn === "resolved") return "This thread is resolved. Fix works only on open threads.";
  return null;
}

export const NOTHING_TO_FIX = { title: "Nothing to fix.", text: "No open thread and no open finding. Press r to review." };

// The text under the buttons of the Fix list. Only "ok" lets Propose start a run.
// rows: the row count. ticked: the ticked rows. synced: the server has both heads (jobs.ts fix). busy: busyText of the active run.
export type FixReason = { kind: "nothing" | "sync" | "explain" | "busy" | "none" | "many" | "ok"; text: string };
export function fixReason(o: {
  rows: number;
  ticked: number;
  synced: boolean;
  profile: { name: string; explain: boolean };
  busy: string | null;
}): FixReason {
  if (!o.rows) return { kind: "nothing", text: `${NOTHING_TO_FIX.title} ${NOTHING_TO_FIX.text}` };
  if (!o.synced) return { kind: "sync", text: "Sync the pull request first. Wait for the next sync, or click Check now." };
  if (o.profile.explain)
    return {
      kind: "explain",
      text: `The brief uses the ${o.profile.name} profile, which proposes no fixes. Press r and pick a review profile.`,
    };
  if (o.busy) return { kind: "busy", text: `${o.busy} Propose fixes when it ends.` };
  if (!o.ticked) return { kind: "none", text: "Tick at least one thread." };
  if (o.ticked > MAX_REPLY_THREADS)
    return { kind: "many", text: `Tick at most ${MAX_REPLY_THREADS} threads for one run. Now ${o.ticked} are ticked.` };
  return {
    kind: "ok",
    text: `A read-only run checks each point first, then proposes exact edits. You review each edit before Apply. Nothing posts. Profile: ${o.profile.name}.`,
  };
}

// "Not in the list: 2 resolved threads, 1 deleted thread." Empty when the list leaves out nothing.
export function leftOutText(t: Pick<FixTargets, "resolved" | "deleted">): string {
  const parts = [t.resolved && plural(t.resolved, "resolved thread"), t.deleted && plural(t.deleted, "deleted thread")].filter(Boolean);
  return parts.length ? `Not in the list: ${parts.join(", ")}.` : "";
}

export const OWN_ONLY = "Fix works only on your own pull requests.";

// ---------- Edits and their selection ----------

// The edits of a run that no commit holds. An undone commit frees its edits.
export function freeEdits(f: FixDto): FixEditDto[] {
  const used = new Set(f.commits.filter((c) => c.state !== "undone").flatMap((c) => c.edits));
  return f.edits.filter((e) => !used.has(e.id));
}

// ticks: the choice of the user per edit ID. Without a choice, the edits of the newest run are ticked and older ones are not.
export function selection(f: FixDto, newest: boolean, ticks: ReadonlyMap<number, boolean>) {
  const edits = freeEdits(f).filter((e) => ticks.get(e.id) ?? newest);
  return { edits: edits.map((e) => e.id), threads: [...new Set(edits.flatMap((e) => (e.thread === undefined ? [] : [e.thread])))] };
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
