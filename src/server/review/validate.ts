// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Anchor validator (plan v3 WP9) with the changed-line, cause, and rule checks and the overlap groups (docs/plans/review-v2/spec.md
// section 1.7), earlier-finding validator (r2 S-RR), reply validator (replies.md WP17), and answer validator (thread-outcome.md section 9).
// Pure: the caller passes the file contents, the diff, and the run's agent names.
import { MAX_NOTE } from "../../shared/dto";
import type {
  Anchor,
  AnchoredFinding,
  AnsweredQuestion,
  Coverage,
  DropReason,
  EarlierVerdict,
  ExcerptLine,
  Finding,
  ReplyPayload,
  ReplyResult,
  ReviewResult,
  Side,
  StoredFinding,
  ValidatedResult,
  Verdict,
} from "../../shared/review";
import { type DiffFile, parseDiff } from "./diffmap";
import type { ReplyThread } from "./prompt";

export const CONTEXT_LINES = 3;
// ponytail: fixed caps that bound the scan per finding and the excerpt size. Raise them if real reviews hit them.
export const MAX_FILE_CHARS = 4 * 1024 * 1024;
export const MAX_RANGE_LINES = 100;
export const MAX_LINE_CHARS = 1000;

// One loaded project instruction file as the prompt shows it (instructions.ts). scope: the folder that it applies to, or null for
// all files.
export type RuleSource = { scope: string | null; text: string };

export type ValidateInput = {
  result: ReviewResult;
  // Output of `git diff -M -U3 <base> <head>`.
  diff: string;
  // Contents at head (the worktree), keyed by repository path.
  newFiles: ReadonlyMap<string, string>;
  // Contents at base, keyed by base path. A file outside the diff is the same on both sides, so it may be absent here.
  oldFiles: ReadonlyMap<string, string>;
  // Subagent names of the run's Agent events.
  agents: readonly string[];
  explain?: boolean;
  // The project instructions of the run. Absent: none, so every rule finding drops.
  rules?: readonly RuleSource[];
};

export const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

// A repository path with "/" separators, or null for a path that can leave the snapshot.
// git refuses to track a ".git" part (verify_path), so such a path is never in the snapshot.
export function repoPath(raw: string): string | null {
  const p = raw.replaceAll("\\", "/");
  if (p.includes("\0") || p.startsWith("/") || /^[A-Za-z]:/.test(p)) return null;
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  if (!parts.length || parts.some((s) => s === ".." || s.toLowerCase() === ".git")) return null;
  return parts.join("/");
}

// The file lines, and the whole file after whitespace collapse with the start of each line in it.
type Text = { lines: string[]; flat: string; starts: number[]; lineOf: number[] };

function prepare(content: string): Text {
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  let flat = "";
  const starts: number[] = [];
  const lineOf: number[] = [];
  for (const [i, raw] of lines.entries()) {
    const l = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    lines[i] = l;
    const c = collapse(l);
    if (!c) continue;
    if (flat) flat += " ";
    starts.push(flat.length);
    lineOf.push(i + 1);
    flat += c;
  }
  return { lines, flat, starts, lineOf };
}

// The line of a non-space character of flat.
function lineAt(t: Text, pos: number): number {
  let lo = 0;
  let hi = t.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((t.starts[mid] as number) <= pos) lo = mid;
    else hi = mid - 1;
  }
  return t.lineOf[lo] as number;
}

// D4: the window nearest to the reported line in the whole file, ties to the lower line.
// A window keeps the reported height h, and grows when the quote spans more lines.
function nearest(t: Text, quote: string, line: number, h: number): { s: number; e: number } | null {
  let best: { s: number; e: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  const n = t.lines.length;
  for (let p = t.flat.indexOf(quote); p !== -1; p = t.flat.indexOf(quote, p + 1)) {
    const a = lineAt(t, p);
    // A later match starts on line a or after, so its window starts on line a - h + 1 or after.
    if (a - h + 1 - line > bestD) break;
    const b = lineAt(t, p + quote.length - 1);
    const height = Math.max(h, b - a + 1);
    const s = Math.min(Math.max(line, b - height + 1, 1), a, n - height + 1);
    const d = Math.abs(s - line);
    if (d < bestD || (d === bestD && best && s < best.s)) {
      best = { s, e: s + height - 1 };
      bestD = d;
    }
  }
  return best;
}

function excerpt(t: Text, file: DiffFile | undefined, side: Side, s: number, e: number): ExcerptLine[] {
  const ws = Math.max(1, s - CONTEXT_LINES);
  const we = Math.min(t.lines.length, e + CONTEXT_LINES);
  const kinds = side === "new" ? file?.newLines : file?.oldLines;
  const other = side === "new" ? "del" : "add";
  const at = (r: { old: number; new: number }) => (side === "new" ? r.new : r.old);
  // Rows of the other side sit between the window lines, never at its edges.
  const extra = file?.rows.filter((r) => r.kind === other && at(r) > ws && at(r) <= we) ?? [];
  const ctxOld = new Map(
    side === "new"
      ? file?.rows.filter((r) => r.kind === "ctx" && r.new >= ws && r.new <= we).map((r): [number, number] => [r.new, r.old])
      : [],
  );
  const clip = (s: string) => s.slice(0, MAX_LINE_CHARS);
  const out: ExcerptLine[] = [];
  let j = 0;
  for (let k = ws; k <= we; k++) {
    for (let r = extra[j]; r && at(r) === k; r = extra[++j])
      out.push({ n: side === "new" ? r.old : r.new, kind: other, text: clip(r.text) });
    const kind = kinds?.get(k);
    const old = ctxOld.get(k);
    out.push({
      n: k,
      kind: kind ?? "ctx",
      text: clip(t.lines[k - 1] as string),
      ...(kind === "ctx" ? { hunk: true as const } : {}),
      ...(old === undefined ? {} : { old }),
    });
  }
  return out;
}

// The place fields of a finding or of its cause.
type Placed = Pick<StoredFinding, "path" | "side" | "line" | "lineEnd" | "anchorText">;

// anchor: the anchor of one place against the diff and the file contents, or the reason to drop it.
// changed: spec.md section 1.7 step 2, the anchor range holds an added line (side new) or a removed line (side old).
export function anchorer(input: Pick<ValidateInput, "diff" | "newFiles" | "oldFiles">) {
  const files = parseDiff(input.diff);
  const byNew = new Map<string, DiffFile>();
  const byOld = new Map<string, DiffFile>();
  for (const f of files) {
    if (f.path !== null) byNew.set(f.path, f);
    if (f.oldPath !== null) byOld.set(f.oldPath, f);
  }
  const texts = new Map<string, Text>();
  const text = (key: string, content: string) => {
    const t = texts.get(key) ?? prepare(content);
    texts.set(key, t);
    return t;
  };
  const changed = (a: Anchor, side: Side): boolean => {
    const file = byNew.get(a.path) ?? byOld.get(a.path);
    const lines = side === "new" ? file?.newLines : file?.oldLines;
    const kind = side === "new" ? "add" : "del";
    for (let k = a.line; k <= a.lineEnd; k++) if (lines?.get(k) === kind) return true;
    return false;
  };

  const anchor = (f: Placed): Anchor | DropReason => {
    const p = repoPath(f.path);
    if (p === null) return "path";
    const file = byNew.get(p) ?? byOld.get(p);
    const path = file ? ((file.path ?? file.oldPath) as string) : p;
    const oldPath = file?.oldPath && file.path && file.oldPath !== file.path ? file.oldPath : null;
    const src = file ? (f.side === "new" ? file.path : file.oldPath) : p;
    const sideFiles = f.side === "new" ? input.newFiles : input.oldFiles;
    // A file outside the diff is the same at base and head.
    const content = src === null ? undefined : (sideFiles.get(src) ?? (file ? undefined : input.newFiles.get(src)));
    if (content === undefined) return "file";
    if (content.length > MAX_FILE_CHARS) return "size";
    const quote = collapse(f.anchorText);
    if (!quote) return "match";

    const t = text(`${f.side}:${src}`, content);
    const end = f.lineEnd ?? f.line;
    const valid = f.line >= 1 && end >= f.line && end <= t.lines.length && end - f.line < MAX_RANGE_LINES;
    let state: Anchor["state"] = "exact";
    let s = f.line;
    let e = end;
    if (!(valid && collapse(t.lines.slice(f.line - 1, end).join("\n")).includes(quote))) {
      const w = nearest(t, quote, f.line, valid ? end - f.line + 1 : 1);
      if (!w) return "match";
      if (w.e - w.s >= MAX_RANGE_LINES) return "size";
      state = "moved";
      s = w.s;
      e = w.e;
    }
    const lines = f.side === "new" ? file?.newLines : file?.oldLines;
    for (let k = s; k <= e; k++) if (!lines?.has(k)) state = "outside";
    return { state, path, oldPath, line: s, lineEnd: e, excerpt: excerpt(t, file, f.side, s, e) };
  };
  return { anchor, changed };
}

// The file of an anchored line: the new path on side new, the base path on side old.
const sidePath = (a: Anchor, side: Side) => (side === "old" ? (a.oldPath ?? a.path) : a.path);

// spec.md section 1.7 step 5: the rule quote, whitespace collapsed, is in a loaded file whose scope covers the path.
function ruleCheck(sources: readonly RuleSource[]) {
  const flat = sources.map((s) => ({ scope: s.scope, text: collapse(s.text) }));
  return (rule: string, path: string) => {
    const q = collapse(rule);
    return flat.some((s) => (s.scope === null || path.startsWith(`${s.scope}/`)) && s.text.includes(q));
  };
}

// kept: for each finding of the result, its index in findings, or null when the validator dropped it.
export function validate(input: ValidateInput): ValidatedResult & { kept: (number | null)[] } {
  const { findings, ...rest } = input.result;
  if (input.explain) return { ...rest, findings: [], dropped: [], kept: findings.map(() => null) };
  const { anchor, changed } = anchorer(input);
  const holds = ruleCheck(input.rules ?? []);
  const agents = new Set(input.agents);
  const out: ValidatedResult & { kept: (number | null)[] } = { ...rest, findings: [], dropped: [], kept: [] };
  const drop = (f: Finding, reason: DropReason) => {
    out.dropped.push({ ...f, reason });
    out.kept.push(null);
  };
  for (const raw of findings) {
    const f: Finding = { ...raw, agent: raw.agent !== null && agents.has(raw.agent) ? raw.agent : null };
    const a = anchor(f);
    if (typeof a === "string") {
      drop(f, a);
      continue;
    }
    // spec.md section 1.7 steps 2 to 4: a finding is in the change by its anchor, else by its cause.
    let cause: AnchoredFinding["cause"] = f.cause;
    if (!changed(a, f.side)) {
      const c = f.cause ? anchor(f.cause) : null;
      if (!f.cause || c === null || typeof c === "string" || !changed(c, f.cause.side)) {
        drop(f, "unchanged");
        continue;
      }
      cause = { ...f.cause, anchor: c };
    }
    if (f.module === "rules" && f.rule.trim() && !holds(f.rule, sidePath(a, f.side))) {
      drop(f, "rule");
      continue;
    }
    out.kept.push(out.findings.push({ ...f, cause, anchor: a }) - 1);
  }
  return out;
}

// spec.md section 1.7, dedupe: two findings with the same path, the same side, and overlapping anchor ranges share a group. Groups join
// by transitivity. The groups count from 1 in the order of their first finding. A finding without a partner gets null.
export function overlapGroups(list: readonly { side: Side; anchor: Pick<Anchor, "path" | "line" | "lineEnd"> }[]): (number | null)[] {
  const root = list.map((_, i) => i);
  const find = (i: number): number => {
    while (root[i] !== i) i = root[i] as number;
    return i;
  };
  list.forEach((a, i) => {
    for (let j = 0; j < i; j++) {
      const b = list[j] as (typeof list)[number];
      if (a.side === b.side && a.anchor.path === b.anchor.path && a.anchor.line <= b.anchor.lineEnd && b.anchor.line <= a.anchor.lineEnd)
        root[find(i)] = find(j);
    }
  });
  const size = new Map<number, number>();
  for (let i = 0; i < list.length; i++) size.set(find(i), (size.get(find(i)) ?? 0) + 1);
  const number = new Map<number, number>();
  return list.map((_, i) => {
    const r = find(i);
    if ((size.get(r) ?? 0) < 2) return null;
    if (!number.has(r)) number.set(r, number.size + 1);
    return number.get(r) as number;
  });
}

// ---------- Earlier findings of a re-review (plan r2 S-RR) ----------

// id: the source item ID. finding: the stored finding at the item's current path and lines.
export type EarlierItem = { id: number; finding: StoredFinding };
// finding: the stored finding with the verdict path and line. anchor: null when its code is not at the head.
export type EarlierCase = { id: number; verdict: Verdict; reason: string; finding: StoredFinding };
export type CheckedEarlier = EarlierCase & { anchor: Anchor | null };

export const NO_VERDICT = "The run gave no verdict.";
export const CODE_GONE = "The code of the finding is gone.";

// One case per item. An unknown or a second verdict goes to skipped. An item without a verdict stays open and goes to skipped.
export function earlierCases(earlier: readonly EarlierVerdict[], items: readonly EarlierItem[]) {
  const ids = new Set(items.map((i) => i.id));
  const got = new Map<number, EarlierVerdict>();
  const skipped: string[] = [];
  for (const v of earlier) {
    if (!ids.has(v.id)) skipped.push(`Verdict for finding ${v.id} dropped: the ID is not an earlier finding.`);
    else if (got.has(v.id)) skipped.push(`Verdict for finding ${v.id} dropped: a second verdict for the finding.`);
    else got.set(v.id, v);
  }
  const cases = items.map(({ id, finding: f }): EarlierCase => {
    const v = got.get(id);
    if (!v) {
      skipped.push(`Finding ${id} has no verdict. It stays open.`);
      return { id, verdict: "open", reason: NO_VERDICT, finding: f };
    }
    const line = v.line ?? f.line;
    const lineEnd = f.lineEnd === null ? null : line + (f.lineEnd - f.line);
    return { id, verdict: v.status, reason: v.reason, finding: { ...f, path: v.path ?? f.path, line, lineEnd } };
  });
  return { cases, skipped };
}

// Anchors each earlier finding against MB..head. An open finding without an anchor becomes outdated.
// A fixed or outdated finding keeps its anchor when its code is still there.
export function validateEarlier(
  input: Pick<ValidateInput, "diff" | "newFiles" | "oldFiles"> & { earlier: readonly EarlierVerdict[]; items: readonly EarlierItem[] },
): { checked: CheckedEarlier[]; skipped: string[] } {
  const { anchor } = anchorer(input);
  const { cases, skipped } = earlierCases(input.earlier, input.items);
  const checked = cases.map((c): CheckedEarlier => {
    const a = anchor(c.finding);
    const at = typeof a === "string" ? null : a;
    return c.verdict === "open" && at === null ? { ...c, verdict: "outdated", reason: CODE_GONE, anchor: null } : { ...c, anchor: at };
  });
  return { checked, skipped };
}

// ---------- Reply drafts (plan replies.md WP17) ----------

export type ValidatedReply = { payload: ReplyPayload; status: "new" | "discarded" };
export type ValidatedReplies = { summary: string; coverage: Coverage; replies: ValidatedReply[] };

// Plan replies.md R11: only requested threads pass. Every drop and every unanswered thread goes to coverage.skipped.
export function validateReplies(result: ReplyResult, requested: readonly ReplyThread[]): ValidatedReplies {
  const replyTo = new Map(requested.map((r) => [r.thread, r.replyTo]));
  const mine = new Set(requested.filter((r) => r.mine).map((r) => r.thread));
  const answered = new Set<number>();
  const skipped = [...result.coverage.skipped];
  const replies: ValidatedReply[] = [];
  for (const r of result.replies) {
    const to = replyTo.get(r.thread);
    const body = r.action === "none" ? "" : r.body.trim();
    const why =
      to === undefined
        ? "the thread was not requested"
        : answered.has(r.thread)
          ? "a second reply for the thread"
          : r.action === "reply" && !body
            ? "the body is empty"
            : body.length > MAX_NOTE
              ? `the body is longer than ${MAX_NOTE} characters`
              : null;
    if (to !== undefined) answered.add(r.thread);
    if (to === undefined || why !== null) {
      skipped.push(`Reply for thread ${r.thread} dropped: ${why}.`);
      continue;
    }
    // A resolve proposal needs the settled judgement, so the chip and the tick never contradict each other.
    const resolve = r.resolve && r.judgement === "settled";
    if (r.resolve && !resolve)
      skipped.push(`Resolve proposal for thread ${r.thread} dropped: the judgement is ${r.judgement ?? "none"}, not settled.`);
    // Only a thread that the user started gets the tick by default. A resolve proposal without a reply stays a draft.
    const resolveEvidence = resolve ? r.resolveEvidence.trim() : "";
    const none = r.action === "none" && !resolve;
    replies.push({
      payload: {
        ...r,
        body,
        replyTo: to,
        resolve,
        resolveEvidence,
        resolveTick: resolve && mine.has(r.thread),
        origin: "reply",
        ...(none && { discardedBy: "ai" as const }),
      },
      status: none ? "discarded" : "new",
    });
  }
  for (const r of requested) if (!answered.has(r.thread)) skipped.push(`Thread ${r.thread} has no reply.`);
  return { summary: result.summary, coverage: { ...result.coverage, skipped }, replies };
}

// ---------- Answered questions of a review run (docs/plans/thread-outcome.md section 9) ----------

// A thread with the questions that the user posted from earlier runs. questions: their count. The question numbers count from 1.
export type AskedThread = ReplyThread & { questions: number };

// One unaccepted reply draft per thread. Only a thread whose questions are all settled proposes resolve. A question without an entry
// stays open. Every drop goes to skipped. kept: validate().kept, for the finding of an issue.
export function validateAnswered(
  answered: readonly AnsweredQuestion[],
  asked: readonly AskedThread[],
  kept: readonly (number | null)[],
): { replies: ValidatedReply[]; skipped: string[] } {
  const threads = new Map(asked.map((t) => [t.thread, t]));
  const got = new Map<number, Map<number, AnsweredQuestion>>();
  const skipped: string[] = [];
  for (const a of answered) {
    const t = threads.get(a.thread);
    const q = a.question ?? (t?.questions === 1 ? 1 : null);
    const list = got.get(a.thread) ?? new Map<number, AnsweredQuestion>();
    const why = !t
      ? "the thread holds no question of the user"
      : q === null
        ? "the thread holds several questions, and the entry names none"
        : q > t.questions
          ? `the thread has no question ${q}`
          : list.has(q)
            ? `a second entry for question ${q}`
            : a.outcome !== "issue"
              ? null
              : a.finding === null
                ? "an issue needs its finding"
                : a.finding >= kept.length
                  ? `the result has no finding ${a.finding}`
                  : kept[a.finding] === null
                    ? `the validator dropped finding ${a.finding}`
                    : null;
    if (why !== null || q === null) {
      skipped.push(`Answer for thread ${a.thread}${a.question === null ? "" : `, question ${a.question}`} dropped: ${why}.`);
      continue;
    }
    got.set(a.thread, list.set(q, a));
  }
  const replies: ValidatedReply[] = [];
  for (const t of asked) {
    const list = [...(got.get(t.thread) ?? new Map<number, AnsweredQuestion>()).entries()].sort(([a], [b]) => a - b).map(([, a]) => a);
    if (!list.length) continue;
    const settled = list.length === t.questions && list.every((a) => a.outcome === "settled");
    const body = [...new Set(list.map((a) => a.reply.trim()).filter(Boolean))].join("\n\n");
    const why =
      body.length > MAX_NOTE
        ? `the body is longer than ${MAX_NOTE} characters`
        : !body && !settled
          ? "the body is empty, and a question stays open"
          : null;
    if (why) {
      skipped.push(`Reply for thread ${t.thread} dropped: ${why}.`);
      continue;
    }
    const evidence = list
      .map((a) => collapse(a.evidence))
      .filter(Boolean)
      .join(" ");
    replies.push({
      payload: {
        thread: t.thread,
        action: body ? "reply" : "none",
        body,
        reason: evidence,
        evidenceStatus: "unverified",
        judgement: settled ? "settled" : list.some((a) => a.outcome === "followup") ? "followup" : "unsettled",
        replyTo: t.replyTo,
        resolve: settled,
        resolveEvidence: settled ? evidence : "",
        resolveTick: settled && !!t.mine,
        origin: "review",
      },
      status: "new",
    });
  }
  return { replies, skipped };
}
