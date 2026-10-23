// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// docs/plans/thread-outcome.md sections 3 and 4: the outcome line of a thread, its markers, and the conflict note when the reply
// draft and the fix result disagree. The UI and the PR context file (docs/plans/review-v2/spec.md section 2.8) use the same words.
// Pure functions only, so the server and bun test run them directly.
import type { CommitDto, FixCommitDto, FixDto, FixEditDto, ReviewItemDto, RunDto } from "./dto";
import type { FixWhy, ReplyPayload } from "./review";
import { staleReasons } from "./stale";
import type { Turn } from "./turn";

// ---------- Helpers (also re-exported by the web modules) ----------

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const shortHash = (h: string) => h.slice(0, 7);

// One line of plain text, cut at n characters.
export function snippet(text: string | null, n: number): string {
  const t = (text ?? "").replace(/`/g, "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

// An open draft that you edited or accepted. A reply run revises it and never replaces it (docs/plans/thread-outcome.md).
export const touchedDraft = (it: ReviewItemDto) => it.status === "accepted" || (it.status === "new" && it.edited);

// A point that a fix run can take: a thread, or a review finding that is not posted.
export type FixTarget = { kind: "thread" | "finding"; id: number };
// FixDto notes and edits name exactly one of thread and finding.
export const names = (x: { thread?: number; finding?: number }, t: FixTarget) =>
  t.kind === "thread" ? x.thread === t.id : x.finding === t.id;

export type FixNote = FixDto["threads"][number];

// The fix run that this page started, with its threads and findings.
export type Asked = { run: number; threads: number[]; findings: number[] };

// running: a fix run that this page started for the target runs now. failed: that run failed or was cancelled.
// none: that run ended without a note or an edit for the target. done: the newest run with a note or an edit for the target.
// commit: the newest commit of that run that holds an edit of the target and is not undone.
export type FixState =
  | { kind: "running" }
  | { kind: "failed"; run: RunDto }
  | { kind: "none"; run: RunDto }
  | { kind: "done"; fix: FixDto; newest: boolean; note: FixNote | null; edits: FixEditDto[]; commit: FixCommitDto | null };

// fixes: GET /api/prs/:id/fixes, newest first.
export function fixState(fixes: FixDto[] | undefined, target: FixTarget, asked: Asked | null): FixState | null {
  const list = fixes ?? [];
  const touches = (f: FixDto) => f.threads.some((n) => names(n, target)) || f.edits.some((e) => names(e, target));
  if (asked && (target.kind === "thread" ? asked.threads : asked.findings).includes(target.id)) {
    const own = list.find((f) => f.run.id === asked.run);
    if (!own || own.run.status === "running") return { kind: "running" };
    if (own.run.status === "failed" || own.run.status === "cancelled") return { kind: "failed", run: own.run };
    if (!touches(own)) return { kind: "none", run: own.run };
  }
  const i = list.findIndex(touches);
  const fix = list[i];
  if (!fix) return null;
  const edits = fix.edits.filter((e) => names(e, target));
  const ids = new Set(edits.map((e) => e.id));
  const commit = fix.commits.find((c) => c.state !== "undone" && c.edits.some((id) => ids.has(id))) ?? null;
  return { kind: "done", fix, newest: i === 0, note: fix.threads.find((n) => names(n, target)) ?? null, edits, commit };
}

// docs/plans/thread-outcome.md: the label of a fix card for each why of a note without a fix.
export const WHY: Record<FixWhy, string> = {
  already: "Already done",
  invalid: "Not valid",
  scope: "Out of scope",
  unclear: "Unclear",
  decision: "Needs your decision",
  risk: "Risky",
  dropped: "Edits could not be applied",
};

// The "Fixed in" reply posts only when the PR commits hold its commit (outbox.ts fixCheck). Returns the short hash to wait for.
export function fixWaiting(p: ReplyPayload, commits: CommitDto[] | undefined, fixes: FixDto[] | undefined): string | null {
  const fix = p.fix;
  if (!fix || commits?.some((c) => c.hash === fix.commit)) return null;
  const row = fixes?.flatMap((f) => f.commits).find((c) => c.id === fix.id);
  return row?.short ?? shortHash(fix.commit);
}

// ---------- The outcome of a thread ----------

export type OutcomeKind =
  | "open"
  | "answered"
  | "to-fix"
  | "proposed"
  | "fixed"
  | "partly"
  | "already"
  | "wont"
  | "decide"
  | "followup"
  | "settled"
  | "waiting"
  | "resolved";

// stale, resolved-since, code: the out-of-date, resolved-since, and code-changed rules of shared/stale.ts. push: the "Fixed in" commit
// is not on the PR yet. revision: a revision of your draft waits for Use revision or Keep mine.
export type Marker = "stale" | "resolved-since" | "code" | "push" | "revision";

export const MARKER: Record<Marker, string> = {
  stale: "Out of date",
  "resolved-since": "Resolved since the draft",
  code: "Code changed",
  push: "Waiting for push",
  revision: "Revision waiting",
};

// label: the outcome in words. commit: the short hash after the label, or null. detail: the text after "label: ", or null.
// needsReply: Draft replies would write a new draft for the thread, and no current draft answers its newest message.
export type Outcome = {
  kind: OutcomeKind;
  label: string;
  commit: string | null;
  detail: string | null;
  markers: Marker[];
  needsReply: boolean;
};

type Base = Pick<Outcome, "kind" | "label"> & Partial<Pick<Outcome, "commit" | "detail">>;

// no: the reply judges the comment not valid, while edits of the thread are ticked for Apply. edits: those edit IDs.
// yes: the untouched reply asks for a fix, while the newest fix note gives none. run: the fix run of that note. text: the reply has a body.
// session: the reply comes from your session.
export type Conflict =
  | { kind: "no"; reply: ReviewItemDto; edits: number[]; session: boolean }
  | { kind: "yes"; reply: ReviewItemDto; why: "already" | "invalid" | "scope"; run: number; text: boolean; session: boolean };

// thread: newest is the ID of the newest live message, null when every message is deleted. orphanedAt: CommentDto.orphanedAt of the
// root. draft: the current reply draft of the thread (replyMap). fixes: GET /api/prs/:id/fixes. commits: the PR commits.
// ticks: the choice of the user per free edit (FixUi.ticks). author: the user's own pull request. prHead: PrDetail.sourceHead.
export type OutcomeInput = {
  thread: { id: number; turn: Turn; newest: number | null; orphanedAt?: number | null };
  draft: ReviewItemDto | undefined;
  fixes: FixDto[] | undefined;
  commits: CommitDto[] | undefined;
  ticks: ReadonlyMap<number, boolean>;
  author: boolean;
  prHead?: string | null;
};

const replyOf = (it: ReviewItemDto) => it.payload as ReplyPayload;
const isOpen = (it: ReviewItemDto) => it.status === "new" || it.status === "accepted";
// replyCard: a draft has a body, or it proposes or ticks a resolve. Else it says that no reply is needed.
const posts = (it: ReviewItemDto) => {
  const p = replyOf(it);
  return it.body.trim() !== "" || !!p.resolve || !!p.resolveTick;
};

// P8: a session accept asks for a fix, also without a reply. On the own PR, a valid or partly valid judgement asks for one too.
export function asksFix(it: ReviewItemDto, author: boolean): boolean {
  const j = replyOf(it).judgement;
  return it.payload.session?.verdict === "accept" || (author && (j === "valid" || j === "partly"));
}

const WHY_OUTCOME: Record<FixWhy, Base> = {
  already: { kind: "already", label: "Already done" },
  invalid: { kind: "wont", label: "Won't fix", detail: WHY.invalid },
  scope: { kind: "wont", label: "Won't fix", detail: WHY.scope },
  unclear: { kind: "followup", label: "Follow-up asked" },
  decision: { kind: "decide", label: "Needs your decision" },
  risk: { kind: "decide", label: "Needs your decision", detail: WHY.risk },
  dropped: { kind: "decide", label: "Needs your decision", detail: WHY.dropped },
};

const SETTLED: Base = { kind: "settled", label: "Settled" };
const FOLLOWUP: Base = { kind: "followup", label: "Follow-up asked" };

// The outcome that a reply draft states. nofix: the why of the fix note that made it.
function fromDraft(it: ReviewItemDto, nofix: FixWhy | null, author: boolean): Base {
  const p = replyOf(it);
  if (p.origin === "nofix" && nofix) return WHY_OUTCOME[nofix];
  if (asksFix(it, author)) return { kind: "to-fix", label: "To fix" };
  if (p.judgement === "settled") return SETTLED;
  if (p.judgement === "unsettled" || p.judgement === "followup") return FOLLOWUP;
  if (it.body.trim()) return { kind: "answered", label: "Answered" };
  return p.resolve || p.resolveTick ? SETTLED : { kind: "settled", label: "No reply needed" };
}

// fix-routes.ts: the body of a "Won't fix" draft is "Won't fix: <reason>".
const wontReason = (body: string) => body.replace(/^Won't fix:\s*/, "").trim() || null;

type Done = Extract<FixState, { kind: "done" }>;

// The edits of the target that no commit holds, and the ones of them that Apply takes. A declined note frees none (freeEdits).
function freeOf(done: Done | null, ticks: ReadonlyMap<number, boolean>): { free: FixEditDto[]; ticked: FixEditDto[] } {
  if (!done || done.note?.declined) return { free: [], ticked: [] };
  const held = new Set(done.fix.commits.filter((c) => c.state !== "undone").flatMap((c) => c.edits));
  const free = done.edits.filter((e) => !held.has(e.id));
  return { free, ticked: free.filter((e) => ticks.get(e.id) ?? done.newest) };
}

const doneOf = (fixes: FixDto[] | undefined, target: FixTarget) => {
  const s = fixState(fixes, target, null);
  return s?.kind === "done" ? s : null;
};

// Section 4 decides between the writers of the draft. The line then follows this order, first match wins:
// resolved without an open draft, your decline, a fix commit, your own draft, the newest fix result, an AI draft, the turn.
export function threadOutcome(i: OutcomeInput): { outcome: Outcome; conflict: Conflict | null } {
  const { thread: t, draft: cur } = i;
  const p = cur ? replyOf(cur) : null;
  const live = cur && isOpen(cur) && posts(cur) ? cur : null;
  // validate.ts stores a reply-run draft with action none as discarded. A session accept without a reply stays new. Both show.
  const none = cur && !posts(cur) ? cur : null;
  const shown = live ?? none;
  const done = doneOf(i.fixes, { kind: "thread", id: t.id });
  const note = done?.note ?? null;
  const { free, ticked } = freeOf(done, i.ticks);
  const committed = done?.commit?.state === "committed" ? done.commit : null;
  const reasons =
    cur && p
      ? staleReasons(
          { body: cur.body, payload: p, drafted: cur.drafted },
          { newest: t.newest, resolved: t.turn === "resolved", orphanedAt: t.orphanedAt ?? null },
          i.prHead ?? null,
        )
      : [];
  const stale = reasons.includes("out-of-date");
  // The why of the note that made the current nofix draft.
  const nofix = done && cur && cur.run === done.fix.run.id ? (note?.why ?? null) : null;

  const pick = (): Base => {
    if (t.turn === "resolved" && !live) return { kind: "resolved", label: "Resolved" };
    if (note?.declined) return { kind: "wont", label: "Won't fix", detail: snippet(note.declined.reason, 120) || null };
    if (live && p?.declined) return { kind: "wont", label: "Won't fix", detail: wontReason(snippet(live.body, 120)) };
    if (done && committed) {
      // BRIEF "Fixed in" text: the commits of the run that are not undone hold every edit of the thread, or only a part.
      const all = free.length === 0;
      return {
        kind: all ? "fixed" : "partly",
        label: all ? "Fixed in" : "Partly fixed in",
        commit: committed.short ?? shortHash(committed.commit ?? ""),
      };
    }
    if (live && p?.fix) return { kind: "fixed", label: "Fixed in", commit: shortHash(p.fix.commit) };
    if (live && (live.status === "accepted" || live.edited || p?.origin === "user")) return fromDraft(live, nofix, i.author);
    if (done) {
      // An untick of every free edit is your choice, so an open draft then states the outcome.
      const unticked = free.length > 0 && free.every((e) => i.ticks.get(e.id) === false);
      if ((free.length > 0 && !(unticked && shown)) || done.commit?.state === "staged") return { kind: "proposed", label: "Fix proposed" };
      if (note?.why) return WHY_OUTCOME[note.why];
      if (note && !note.fixed) return { kind: "decide", label: "No fix proposed" };
    }
    if (shown) return fromDraft(shown, nofix, i.author);
    return t.turn === "wait" ? { kind: "waiting", label: "Waiting on them" } : { kind: "open", label: "Open" };
  };
  const base = pick();

  const markers: Marker[] = [];
  if (shown && stale) markers.push("stale");
  if (live && reasons.includes("resolved-since")) markers.push("resolved-since");
  if (shown && reasons.includes("code-changed")) markers.push("code");
  if (live && p?.fix && fixWaiting(p, i.commits, i.fixes)) markers.push("push");
  if (live?.revised) markers.push("revision");

  // drafts.ts writer priority: Draft replies replaces only an open, untouched draft of a reply, review, session, or resolve writer, and
  // a draft that a reply run discarded as "No reply needed". It revises an open draft that you edited or accepted, unless a waiting
  // revision answers the newest message already.
  const replaceable =
    !!cur &&
    ((cur.status === "new" && !cur.edited && !p?.fix && !p?.declined && p?.origin !== "nofix" && p?.origin !== "user") ||
      (cur.status === "discarded" && p?.discardedBy === "ai"));
  const revisable = !!cur && touchedDraft(cur) && !(cur.revised && replyOf(cur.revised).replyTo === t.newest);
  const needsReply = t.turn === "your" && t.newest !== null && ((!cur && base.kind === "open") || (stale && (replaceable || revisable)));

  const outcome: Outcome = { commit: null, detail: null, ...base, markers, needsReply };
  return { outcome, conflict: conflictOf() };

  // Each action of the note changes an open draft, so a discarded one gives no note.
  function conflictOf(): Conflict | null {
    if (!shown || !isOpen(shown) || !p || p.fix || p.declined || p.origin === "nofix") return null;
    const session = !!shown.payload.session;
    if (p.judgement === "invalid" && ticked.length) return { kind: "no", reply: shown, edits: ticked.map((e) => e.id), session };
    const why = note?.declined || committed ? null : note?.why;
    if (
      done &&
      shown.status === "new" &&
      !shown.edited &&
      asksFix(shown, i.author) &&
      (why === "already" || why === "invalid" || why === "scope")
    )
      return { kind: "yes", reply: shown, why, run: done.fix.run.id, text: shown.body.trim() !== "", session };
    return null;
  }
}

// session-consult.md part C: a session reject discards a finding. Ticked edits for it contradict the reject. Returns their IDs.
export function findingConflict(it: ReviewItemDto, fixes: FixDto[] | undefined, ticks: ReadonlyMap<number, boolean>): number[] | null {
  if (it.kind !== "finding" || it.status !== "discarded" || it.payload.session?.verdict !== "reject") return null;
  const { ticked } = freeOf(doneOf(fixes, { kind: "finding", id: it.id }), ticks);
  return ticked.length ? ticked.map((e) => e.id) : null;
}

export const outcomeText = (o: Pick<Outcome, "label" | "commit" | "detail">) =>
  `${o.label}${o.commit ? ` ${o.commit}` : ""}${o.detail ? `: ${o.detail}` : ""}`;

// docs/plans/review-v2/spec.md section 2.8: the State line of a thread in context/pr-context.md. The marker words follow after "; ".
export const stateText = (o: Pick<Outcome, "label" | "commit" | "detail" | "markers">) =>
  [outcomeText(o), ...o.markers.map((m) => MARKER[m])].join("; ");

// The words of a conflict note. keep: the reply or reject side, fix: the fix side. does: what the button does, after its label.
export type ConflictText = { title: string; text: string; keep: { label: string; does: string }; fix: { label: string; does: string } };

const are = (n: number) => (n === 1 ? "is" : "are");
const untick = (n: number) => `unticks ${n === 1 ? "the edit" : `the ${n} edits`}, so Apply leaves ${n === 1 ? "it" : "them"} out`;

export function conflictText(c: Conflict): ConflictText {
  const who = c.session ? "Your session" : "The reply draft";
  const title = "The reply and the fix disagree";
  if (c.kind === "no")
    return {
      title,
      text: `${who} says the comment is not valid, but ${plural(c.edits.length, "edit")} ${are(c.edits.length)} ticked for Apply.`,
      keep: { label: "Keep the reply", does: untick(c.edits.length) },
      fix: { label: "Keep the fix", does: "discards the reply draft" },
    };
  return {
    title,
    text: `${who} says the comment is valid, but the fix run says: ${WHY[c.why]}.`,
    keep: c.text
      ? { label: "Keep the reply", does: "accepts the reply draft" }
      : { label: "Fix anyway", does: "runs the fix again and asks for edits despite the note" },
    fix: { label: "Keep the fix", does: "discards the reply draft and brings back the answer of the fix run" },
  };
}

export function findingConflictText(edits: number[]): ConflictText {
  return {
    title: "The reject and the fix disagree",
    text: `Your session rejected this finding, but ${plural(edits.length, "edit")} for it ${are(edits.length)} ticked for Apply.`,
    keep: { label: "Keep the reject", does: untick(edits.length) },
    fix: { label: "Keep the fix", does: "restores the finding" },
  };
}
