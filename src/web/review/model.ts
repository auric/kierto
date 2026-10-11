// Pure review UI rules (plan v3 WP11, prototype/v3, replies.md step 6). No DOM access, so bun test runs them directly.
import type {
  BriefDto,
  CommitDto,
  ExcerptLine,
  ItemActionInput,
  ProfileDto,
  PrRow,
  ReviewItemDto,
  RunDetail,
  RunDto,
  RunKind,
  RunUsage,
} from "../../shared/dto";
import {
  type Anchor,
  type AnchoredFinding,
  type Coverage,
  type DropReason,
  MAX_REPLY_THREADS,
  type ReplyPayload,
  type Side,
} from "../../shared/review";
import type { RunEvent } from "../../shared/run-log";
import { matches } from "../shell/model";

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const base = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const shortHash = (h: string) => h.slice(0, 7);
export const lineText = (a: { line: number; lineEnd: number }) => (a.lineEnd > a.line ? `${a.line}–${a.lineEnd}` : `${a.line}`);

// run-log.ts: the agent tool is always "Agent".
export const AGENT = "Agent";

// ---------- Run log ----------

export type LogNode = { e: RunEvent; kids: LogNode[] };

// The tree comes from parent alone. An event with an unknown parent, or one that a parent cycle hides, shows at the top level.
export function logTree(events: RunEvent[]): LogNode[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const ids = new Set(sorted.map((e) => e.id));
  const kids = new Map<string | null, RunEvent[]>();
  for (const e of sorted) {
    const p = e.parent !== null && e.parent !== e.id && ids.has(e.parent) ? e.parent : null;
    const list = kids.get(p);
    if (list) list.push(e);
    else kids.set(p, [e]);
  }
  const seen = new Set<string>();
  const build = (p: string | null): LogNode[] =>
    (kids.get(p) ?? []).flatMap((e) => {
      if (seen.has(e.id)) return [];
      seen.add(e.id);
      return [{ e, kids: build(e.id) }];
    });
  const roots = build(null);
  for (const e of sorted) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    roots.push({ e, kids: build(e.id) });
  }
  return roots;
}

// Finished tool calls of all agents. Agent calls count as agents (prototype/v3 toolCalls, agentCount).
export const toolCalls = (events: RunEvent[]) => events.filter((e) => e.tool !== AGENT && e.status !== "running").length;
export const agentCount = (events: RunEvent[]) => events.filter((e) => e.tool === AGENT).length;

export function agentInfo(n: LogNode) {
  const calls = n.kids.filter((k) => k.e.tool !== AGENT && k.e.status !== "running").length;
  return { calls, words: `${plural(calls, "tool call")}${n.e.status === "running" ? " so far" : ""}` };
}

// The first Agent call with this subagent name, then its ancestors.
export function agentPath(events: RunEvent[], name: string): string[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  const out: string[] = [];
  let e = [...events].sort((a, b) => a.seq - b.seq).find((x) => x.tool === AGENT && x.agent === name);
  while (e && !out.includes(e.id)) {
    out.push(e.id);
    e = e.parent === null ? undefined : byId.get(e.parent);
  }
  return out;
}

export const seconds = (e: RunEvent) => (e.endedAt === null ? null : Math.max(0, e.endedAt - e.startedAt) / 1000);
// prototype/v3 dur: "52s", "2m 05s".
export const clockDur = (s: number) => {
  const r = Math.round(s);
  return r < 60 ? `${r}s` : `${Math.floor(r / 60)}m ${String(r % 60).padStart(2, "0")}s`;
};
export const callDur = (s: number) => (s < 60 ? `${s.toFixed(1)} s` : clockDur(s));
export function durLong(s: number) {
  const r = Math.round(s);
  const m = Math.floor(r / 60);
  return [m ? plural(m, "minute") : "", r % 60 || !m ? plural(r % 60, "second") : ""].filter(Boolean).join(" ");
}

// ---------- Run line ----------

// The token counters of the result event usage. Their sum is all tokens that the run read or wrote.
const TOKEN_FIELDS = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"];
export function tokenTotal(u: RunUsage | null): number | null {
  if (!u) return null;
  const ns = TOKEN_FIELDS.map((k) => u.tokens[k]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return ns.length ? ns.reduce((a, b) => a + b, 0) : null;
}
export const tokenText = (n: number) => (n < 1000 ? `${n} tokens` : `${Math.round(n / 1000)}k tokens`);

// Plan v3 section 7: an incomplete run says "No findings in what it read", never "No issues".
// A reply run counts its drafts and the threads where it found no reply needed.
export function countText(items: ReviewItemDto[], incomplete: boolean, kind: RunKind = "review") {
  // An ask run has no items. Its answer shows in the Ask panel.
  if (kind === "ask") return "";
  if (kind === "reply") {
    const none = items.filter((i) => (i.payload as ReplyPayload).action === "none").length;
    const r = items.length - none;
    return [
      r ? plural(r, "reply draft") : "No reply drafts",
      none ? `${plural(none, "thread")} ${none === 1 ? "needs" : "need"} no reply` : "",
    ]
      .filter(Boolean)
      .join(", ");
  }
  const f = items.filter((i) => i.kind === "finding").length;
  const q = items.length - f;
  const none = incomplete ? "No findings in what it read" : q ? "" : "No findings";
  return [f ? plural(f, "finding") : none, q ? plural(q, "question") : ""].filter(Boolean).join(", ");
}

// Plan r2 UI-RR: "N new, M carried, K fixed or outdated". The server copies each carried finding with the verdict of the run.
export function rereviewCount(items: ReviewItemDto[]): string {
  let fresh = 0;
  let open = 0;
  let closed = 0;
  let q = 0;
  for (const i of items) {
    if (i.kind === "question") q++;
    else if (i.kind !== "finding") continue;
    else if (!i.payload.carried) fresh++;
    else if (i.payload.carried.verdict === "open") open++;
    else closed++;
  }
  return [`${fresh} new, ${open} carried, ${closed} fixed or outdated`, q ? plural(q, "question") : ""].filter(Boolean).join(", ");
}

export type RunLineState =
  | { kind: "running"; agents: number; calls: number; startedAt: number }
  | {
      kind: "done";
      verb: "reviewed" | "explained" | "drafted replies on" | "answered a question on";
      head: string;
      at: number;
      count: string;
      tokens: number | null;
      gaps: boolean;
      since: string | null;
      // A re-review: from is the short head of its base run. full: the range fell back to the full change.
      changes: { from: string; full: boolean } | null;
    }
  | { kind: "failed"; text: string; raw: boolean }
  | { kind: "limit"; text: string }
  | { kind: "cancelled"; calls: number };

// Plan v3 section 7, Stale: "Reviewed <hash>. N commits since." commits: newest first.
function staleText(r: RunDto, commits: CommitDto[] | undefined): string | null {
  if (!r.stale) return null;
  if (!r.stale.source) return "The target branch moved since";
  const i = commits?.findIndex((c) => c.hash === r.sourceHead) ?? -1;
  return i > 0 ? `${plural(i, "commit")} since` : "New commits since";
}

export function runLine(d: RunDetail, profiles: ProfileDto[], commits?: CommitDto[]): RunLineState {
  const r = d.run;
  switch (r.status) {
    case "running":
      return { kind: "running", agents: agentCount(d.events), calls: toolCalls(d.events), startedAt: r.startedAt };
    case "cancelled":
      return { kind: "cancelled", calls: toolCalls(d.events) };
    case "failed":
      if (r.errorKind === "usage_limit") return { kind: "limit", text: r.errorText ?? "" };
      return { kind: "failed", text: r.errorText ?? "No reason was recorded.", raw: r.hasRaw };
    default: {
      const gaps = r.status === "incomplete";
      return {
        kind: "done",
        verb:
          r.kind === "reply"
            ? "drafted replies on"
            : r.kind === "ask"
              ? "answered a question on"
              : (r.explain ?? profiles.find((p) => p.id === r.profile)?.explain)
                ? "explained"
                : "reviewed",
        head: shortHash(r.sourceHead),
        at: r.finishedAt ?? r.startedAt,
        count: r.since ? rereviewCount(d.items) : countText(d.items, gaps, r.kind),
        tokens: tokenTotal(r.usage),
        gaps,
        since: staleText(r, commits),
        changes: r.since && { from: shortHash(r.since.head), full: !r.since.incremental },
      };
    }
  }
}

// The kind label of the run line (R14): the newest run of any kind shows there.
export const RUN_TEXT: Record<RunKind, { running: string; failed: string; cancelled: string }> = {
  review: { running: "Reviewing…", failed: "Review failed.", cancelled: "the review" },
  reply: { running: "Drafting replies…", failed: "Reply drafts failed.", cancelled: "the reply drafts" },
  ask: { running: "Answering…", failed: "The question failed.", cancelled: "the question" },
};

// R14: GET /api/prs/:id/runs mixes the kinds, newest first. The newest review run drives the drafts, the summary, and the brief.
export const latestReview = (runs: RunDto[] | undefined) => runs?.find((r) => r.kind === "review") ?? null;

// Plan r2 UI-RR, jobs.ts rereview(): the server takes a re-review of the newest review run only when that run ended with a result,
// was no Explain run, and the source head moved since. The stored brief must not use the Explain profile.
// since: the short head of that run. why: the reason for the key c when no re-review is possible.
export function rereviewState(
  latest: RunDto | null,
  brief: BriefDto | undefined,
  profiles: ProfileDto[],
): { since: string } | { why: string } {
  if (!latest) return { why: "No review has run on this pull request yet. Press r to start one." };
  if (latest.status === "running") return { why: "The review is still running." };
  if (!latest.summary) return { why: "The last review has no result. Press r to review again." };
  if (latest.explain ?? latest.profile === "explain")
    return { why: "The last run explained the change and gave no findings. Press r to review it." };
  if (!latest.stale?.source) return { why: "The source branch has no new commits since the last review." };
  if (!brief) return { why: "The review brief is still loading." };
  if (profileOf(profiles, brief.profile)?.explain) return { why: "The Explain profile gives no findings. Pick a review profile first." };
  return { since: shortHash(latest.sourceHead) };
}

// Plan v3 section 7, Usage limit: one line with the CLI message. No automatic retry.
export const limitText = (runner: string, text: string | null) =>
  `${text?.trim() ? `${runner}: ${text.trim()}` : `${runner} usage limit reached.`} Review Loop does not retry by itself.`;

// ---------- Brief ----------

export const profileOf = (profiles: ProfileDto[], id: string) => profiles.find((p) => p.id === id) ?? profiles[0];

export type BriefState = {
  profile: string;
  name: string;
  // r: "start" runs the stored brief. "compose" opens the composer first (prototype/v3 rerun).
  rerun: "start" | "compose";
  // A running review on any PR. One review runs at a time (A14).
  busy: { pr: number; same: boolean } | null;
  hint: string;
};

export function briefState(
  brief: BriefDto | undefined,
  latest: RunDto | null,
  active: RunDto | null,
  pr: number,
  profiles: ProfileDto[],
): BriefState {
  const p = profileOf(profiles, brief?.profile ?? "general");
  const rerun = latest || (brief && brief.updatedAt !== null) ? "start" : "compose";
  const open = "Open the review brief: task, your note, and profile. Key: Shift+R.";
  const again = rerun === "start" ? ` Key r runs the brief: ${p?.name ?? ""}${brief?.note.trim() ? " with your note" : ""}.` : "";
  return {
    profile: p?.id ?? "general",
    name: p?.name ?? "",
    rerun,
    busy: active ? { pr: active.pr, same: active.pr === pr } : null,
    hint: open + again,
  };
}

// ---------- Drafts and summary ----------

export const SEVERITY: Record<AnchoredFinding["severity"], string> = { blocker: "Blocker", major: "Major", minor: "Minor", nit: "Nit" };
export const EVIDENCE: Record<AnchoredFinding["evidenceStatus"], string> = {
  code: "Shown in code",
  reproduced: "Reproduced",
  unverified: "Unverified",
};
// review.ts DropReason.
export const DROP_REASON: Record<DropReason, string> = {
  path: "The path is outside the snapshot.",
  file: "The snapshot has no such file on that side.",
  match: "The snapshot of that file does not have this code.",
  size: "The file or the range is above the scan limits.",
};

export const drafts = (items: ReviewItemDto[]) => items.filter((i) => i.kind === "finding" && i.status !== "posted");
export const questions = (items: ReviewItemDto[]) => items.filter((i) => i.kind === "question" && i.status !== "posted");

// The anchored lines are the range lines that exist on the finding's side.
export function draftExcerpt(a: Anchor & { side: Side }): ExcerptLine[] {
  const other = a.side === "new" ? "del" : "add";
  return a.excerpt.map((l) => ({ ...l, hit: l.kind !== other && l.n >= a.line && l.n <= a.lineEnd }));
}

// How the app resolved the line against the snapshot. An exact match shows nothing.
// payload.anchor is the validator's anchor. A different current anchor is a move by the user (WP12).
export function anchorNote(it: ReviewItemDto): string | null {
  const a = it.anchor;
  if (!a || it.kind !== "finding") return null;
  const p = it.payload as AnchoredFinding;
  if (a.state === "outside") return `Outside the diff. Posts as a general comment with a link to ${base(a.path)}:${lineText(a)}.`;
  if (a.line !== p.anchor.line || a.lineEnd !== p.anchor.lineEnd) return `You moved it from line ${lineText(p.anchor)}.`;
  if (a.state === "moved") return `Moved from line ${p.line}: the quoted code is on line ${lineText(a)}.`;
  return null;
}

// Plan r2 UI-RR: a re-review discards the carried drafts that it finds fixed or outdated. Other closed drafts are discards by you.
export function closedLabel(it: ReviewItemDto): string {
  const v = it.payload.carried?.verdict;
  return v === "fixed" ? "Fixed in the new commits" : v === "outdated" ? "Outdated" : "Discarded";
}

// A draft that a re-review carried. A fixed or outdated draft that is not discarded is one that you restored.
export function carriedNote(it: ReviewItemDto): string | null {
  const v = it.payload.carried?.verdict;
  if (!v) return null;
  return v === "open" ? "Still open after the new commits." : `${closedLabel(it)}. You restored it.`;
}

// The live-region text after a triage action (WP15). The focus moves on to the next item, so the page says what happened.
// before: the item as the page showed it. after: the item that the server returned.
export function triageText(before: ReviewItemDto, after: ReviewItemDto, action: ItemActionInput["action"]): string {
  switch (action) {
    case "accept":
      return "Accepted.";
    case "discard":
      return "Discarded.";
    case "restore":
      return before.status === "accepted" ? "Accept undone." : "Restored.";
    case "edit":
      return "Saved and accepted.";
    case "move":
      return after.anchor ? `Moved to line ${lineText(after.anchor)}.` : "Moved.";
  }
}

// ---------- Reply drafts (docs/plans/replies.md step 6) ----------

export const replyOf = (it: ReviewItemDto) => it.payload as ReplyPayload;

// GET /api/prs/:id/reply-drafts gives the newest unposted draft of each thread. Keys are thread IDs.
export function replyMap(items: ReviewItemDto[] | undefined): Map<number, ReviewItemDto> {
  const out = new Map<number, ReviewItemDto>();
  for (const it of items ?? []) if (it.kind === "reply") out.set(replyOf(it).thread, it);
  return out;
}

// none: action none, or no body yet. Accept needs a body (WP17), so it offers only a reply of your own.
// stale: the draft answers a message that is no longer the newest live message of the thread.
export type ReplyCard =
  | { kind: "pending" }
  | { kind: "none"; it: ReviewItemDto; stale: boolean }
  | { kind: "draft"; it: ReviewItemDto; stale: boolean }
  | { kind: "discarded"; it: ReviewItemDto };

// newest: the newest live message of the thread. pending: a reply run that this page started for the thread runs now.
export function replyCard(it: ReviewItemDto | undefined, newest: number | null, pending: boolean): ReplyCard | null {
  if (pending) return { kind: "pending" };
  if (!it) return null;
  const stale = newest !== null && replyOf(it).replyTo !== newest;
  if (!it.body.trim()) return { kind: "none", it, stale };
  return it.status === "discarded" ? { kind: "discarded", it } : { kind: "draft", it, stale };
}

// The Draft replies button. D12: the server refuses more than MAX_REPLY_THREADS threads in one run.
export function repliesButton(your: number, profile: string): { disabled: boolean; hint: string } {
  if (!your) return { disabled: true, hint: "No thread waits for your reply." };
  if (your > MAX_REPLY_THREADS)
    return {
      disabled: true,
      hint: `${your} threads wait for your reply. Draft at most ${MAX_REPLY_THREADS} at a time: use Draft reply in each thread.`,
    };
  const which = your === 1 ? "the thread" : `each of the ${your} threads`;
  return { disabled: false, hint: `Draft a reply for ${which} where it is your turn. Profile: ${profile}.` };
}

export const coverageRows = (c: Coverage): [string, string[]][] =>
  (
    [
      ["Read", c.read],
      ["Skipped", c.skipped],
      ["Unavailable", c.unavailable],
      ["Not checked", c.notChecked],
    ] as [string, string[]][]
  ).filter(([, v]) => v.length > 0);

// ---------- Review runs view ----------

// runs: newest first, as GET /api/runs returns them.
export function latestByPr(runs: RunDto[]): Map<number, RunDto> {
  const out = new Map<number, RunDto>();
  for (const r of runs) if (!out.has(r.pr)) out.set(r.pr, r);
  return out;
}

// prototype/v3 grouped() for the runs view: one flat list, the running review first, then the newest run.
export function runRows(prs: PrRow[], latest: ReadonlyMap<number, RunDto>, q: string): PrRow[] {
  const key = (p: PrRow) => {
    const r = latest.get(p.id);
    return r ? (r.status === "running" ? Number.MAX_SAFE_INTEGER : r.startedAt) : 0;
  };
  return prs.filter((p) => latest.has(p.id) && matches(p, q)).sort((a, b) => key(b) - key(a));
}

export type RunWhy = { error: string | null; lead: string | null; text: string | null };

// prototype/v3 whyRun. The list has no item counts, so a finished run shows its summary line.
// The run names the profile as it was at the start of the run.
export function runWhy(r: RunDto): RunWhy {
  const profile = r.profileName;
  switch (r.status) {
    case "running":
      return { error: null, lead: null, text: `${profile}: ${r.kind === "reply" ? "drafting replies" : "reviewing"} now.` };
    case "cancelled":
      return { error: null, lead: null, text: `${profile}: you cancelled it.` };
    case "failed":
      return {
        error: r.errorKind === "usage_limit" ? "Usage limit" : "Failed",
        lead: null,
        text: `${profile}: ${r.errorText ?? ""}`.trim(),
      };
    default: {
      const line = r.summary?.summary.trim() || "done.";
      return { error: null, lead: `${profile}:`, text: r.status === "incomplete" ? `${line} Coverage has gaps.` : line };
    }
  }
}
