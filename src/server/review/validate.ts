// Anchor validator (plan v3 WP9) and reply validator (replies.md WP17). Pure: the caller passes the file contents, the diff, and the run's agent names.
import { MAX_NOTE } from "../../shared/dto";
import type {
  Anchor,
  Coverage,
  DropReason,
  ExcerptLine,
  Finding,
  ReplyPayload,
  ReplyResult,
  ReviewResult,
  Side,
  ValidatedResult,
} from "../../shared/review";
import { type DiffFile, parseDiff } from "./diffmap";
import type { ReplyThread } from "./prompt";

export const CONTEXT_LINES = 3;
// ponytail: fixed caps that bound the scan per finding and the excerpt size. Raise them if real reviews hit them.
export const MAX_FILE_CHARS = 4 * 1024 * 1024;
export const MAX_RANGE_LINES = 100;
export const MAX_LINE_CHARS = 1000;

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
  const clip = (s: string) => s.slice(0, MAX_LINE_CHARS);
  const out: ExcerptLine[] = [];
  let j = 0;
  for (let k = ws; k <= we; k++) {
    for (let r = extra[j]; r && at(r) === k; r = extra[++j])
      out.push({ n: side === "new" ? r.old : r.new, kind: other, text: clip(r.text) });
    const kind = kinds?.get(k);
    out.push({ n: k, kind: kind ?? "ctx", text: clip(t.lines[k - 1] as string), ...(kind === "ctx" ? { hunk: true as const } : {}) });
  }
  return out;
}

export function validate(input: ValidateInput): ValidatedResult {
  const { findings, ...rest } = input.result;
  if (input.explain) return { ...rest, findings: [], dropped: [] };

  const files = parseDiff(input.diff);
  const byNew = new Map<string, DiffFile>();
  const byOld = new Map<string, DiffFile>();
  for (const f of files) {
    if (f.path !== null) byNew.set(f.path, f);
    if (f.oldPath !== null) byOld.set(f.oldPath, f);
  }
  const agents = new Set(input.agents);
  const texts = new Map<string, Text>();
  const text = (key: string, content: string) => {
    const t = texts.get(key) ?? prepare(content);
    texts.set(key, t);
    return t;
  };

  const anchor = (f: Finding): Anchor | DropReason => {
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

  const out: ValidatedResult = { ...rest, findings: [], dropped: [] };
  for (const raw of findings) {
    const f: Finding = { ...raw, agent: raw.agent !== null && agents.has(raw.agent) ? raw.agent : null };
    const a = anchor(f);
    if (typeof a === "string") out.dropped.push({ ...f, reason: a });
    else out.findings.push({ ...f, anchor: a });
  }
  return out;
}

// ---------- Reply drafts (plan replies.md WP17) ----------

export type ValidatedReply = { payload: ReplyPayload; status: "new" | "discarded" };
export type ValidatedReplies = { summary: string; coverage: Coverage; replies: ValidatedReply[] };

// Plan replies.md R11: only requested threads pass. Every drop and every unanswered thread goes to coverage.skipped.
export function validateReplies(result: ReplyResult, requested: readonly ReplyThread[]): ValidatedReplies {
  const replyTo = new Map(requested.map((r) => [r.thread, r.replyTo]));
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
    replies.push({ payload: { ...r, body, replyTo: to }, status: r.action === "none" ? "discarded" : "new" });
  }
  for (const r of requested) if (!answered.has(r.thread)) skipped.push(`Thread ${r.thread} has no reply.`);
  return { summary: result.summary, coverage: { ...result.coverage, skipped }, replies };
}
