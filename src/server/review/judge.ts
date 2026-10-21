// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The run end (jobs.ts): turns a runner outcome into the stored status, summary, items, answer, or fix notes and edits.
import { acceptedTargets, consultOutput } from "../../shared/consult";
import { MAX_NOTE, type RunSummary } from "../../shared/dto";
import {
  type AnchoredFinding,
  askResult,
  type Finding,
  type FixNote,
  type FixWhy,
  fixResult,
  type Question,
  type ReplyPayload,
  type RereviewResult,
  replyResult,
  rereviewResult,
  reviewResult,
} from "../../shared/review";
import type { RunErrorKind, RunStatus } from "../../shared/run-log";
import type { Profile } from "./catalog";
import type { RunOutcome } from "./claude";
import { type DiffFile, parseDiff } from "./diffmap";
import { type FixFile, type ValidEdit, validateFix } from "./fix";
import { git, gitEnv } from "./git";
import type { ReplyThread } from "./prompt";
import type { Carry } from "./rereview";
import { type NewItem, NO_ANCHOR } from "./run-rows";
import {
  type AskedThread,
  type CheckedEarlier,
  type EarlierItem,
  earlierCases,
  MAX_FILE_CHARS,
  repoPath,
  type ValidatedReply,
  validate,
  validateAnswered,
  validateEarlier,
  validateReplies,
} from "./validate";
import type { Workspace } from "./workspace";

const RAW_MAX = 2 * 1024 * 1024;

// checked: the earlier findings of a re-review. fix: the notes and edits of a fix run.
export type Ending = {
  status: Exclude<RunStatus, "running">;
  kind: RunErrorKind | null;
  text: string | null;
  raw: string;
  outcome?: RunOutcome;
  result?: {
    summary: RunSummary;
    items: NewItem[];
    checked?: CheckedEarlier[];
    answer?: string;
    fix?: { threads: FixNote[]; edits: ValidEdit[] };
  };
};

// docs/plans/thread-outcome.md: the why values of a thread note that give a nofix reply draft. decision, risk, and dropped give none.
const NOFIX_DRAFT: ReadonlySet<FixWhy | null> = new Set<FixWhy>(["already", "invalid", "scope", "unclear"]);

function cap(s: string) {
  const b = Buffer.from(s);
  return b.length <= RAW_MAX ? s : `${b.subarray(0, RAW_MAX - 100).toString()}\n[truncated: the raw output exceeds ${RAW_MAX} bytes]`;
}

function rawOutput(o: RunOutcome): string {
  const r = o.result;
  const text = [r?.result, ...(r?.errors ?? [])].filter((x) => x).join("\n");
  return cap(
    [
      `# Result${r ? ` (subtype ${r.subtype}, is_error ${r.is_error})` : ""}`,
      text || "(none)",
      "",
      "# structured_output",
      r?.structured_output === undefined ? "(none)" : JSON.stringify(r.structured_output, null, 2),
      "",
      `# stderr tail (exit code ${o.exitCode ?? "none"})`,
      o.stderrTail || "(empty)",
      "",
    ].join("\n"),
  );
}

export const failure = (kind: RunErrorKind, text: string): Ending => ({ status: "failed", kind, text, raw: `${kind}: ${text}` });

const findingItem = (f: AnchoredFinding): NewItem => ({
  kind: "finding",
  payload_json: JSON.stringify(f),
  body: f.body,
  path: f.anchor.path,
  side: f.side,
  line: f.anchor.line,
  line_end: f.anchor.lineEnd,
  anchor_state: f.anchor.state,
  excerpt_json: JSON.stringify(f.anchor.excerpt),
  status: "new",
  thread: null,
  edited: 0,
});

const questionItem = (q: Question): NewItem => ({
  kind: "question",
  payload_json: JSON.stringify(q),
  body: q.text,
  ...NO_ANCHOR,
  status: "new",
  thread: null,
  edited: 0,
});

const replyItem = (r: ValidatedReply): NewItem => ({
  kind: "reply",
  payload_json: JSON.stringify(r.payload),
  body: r.payload.body,
  ...NO_ANCHOR,
  status: r.status,
  thread: r.payload.thread,
  edited: 0,
});

export const issuesText = (issues: { path: PropertyKey[]; message: string }[]) =>
  issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");

function schemaFailure(issues: { path: PropertyKey[]; message: string }[], what: string, raw: string, o: RunOutcome): Ending {
  return { status: "failed", kind: "schema", text: `The result does not match the ${what} schema. ${issuesText(issues)}`, raw, outcome: o };
}

// The servers and skills left out of the spec, then the servers of the spec that did not connect.
function unavailable(o: RunOutcome, servers: string[], gaps: string[]): string[] {
  const down = servers.flatMap((name) => {
    const status = o.init?.mcp_servers?.find((s) => s.name === name)?.status ?? "absent";
    return status === "connected" ? [] : [`MCP server ${name}: ${status}`];
  });
  return [...gaps, ...down];
}

// rl-main calls have no parent. stream.ts gives Read targets with "/" and relative to the run folder when the path is inside it.
export function unreadAlways(o: RunOutcome, always: { id: string; folder: string }[]): string[] {
  const read = new Set(
    o.events.filter((e) => e.tool === "Read" && e.parent === null && e.status === "ok").map((e) => e.target.replace(/^(\.\/)+/, "")),
  );
  return always
    .filter((s) => !read.has(`skills/${s.folder}/SKILL.md`))
    .map((s) => `Skill ${s.id} (always use): the model did not read SKILL.md.`);
}

function ended(raw: string, o: RunOutcome, result: NonNullable<Ending["result"]>): Ending {
  const c = result.summary.coverage;
  return { status: c.skipped.length || c.unavailable.length ? "incomplete" : "completed", kind: null, text: null, raw, outcome: o, result };
}

// Reads the finding files from the cache clone, never from the sanitized worktree. The lookup matches validate().
async function readBlobs(ws: Workspace, findings: Finding[]) {
  const byNew = new Map<string, DiffFile>();
  const byOld = new Map<string, DiffFile>();
  for (const f of parseDiff(ws.diff)) {
    if (f.path !== null) byNew.set(f.path, f);
    if (f.oldPath !== null) byOld.set(f.oldPath, f);
  }
  const newFiles = new Map<string, string>();
  const oldFiles = new Map<string, string>();
  const big = new Set<string>();
  const blobOf = (f: Finding) => {
    const p = repoPath(f.path);
    if (p === null) return null;
    const file = byNew.get(p) ?? byOld.get(p);
    // A file outside the diff is the same at base and head, and the validator reads it from newFiles.
    const old = f.side === "old" && file !== undefined;
    const path = file ? (f.side === "new" ? file.path : file.oldPath) : p;
    if (path === null) return null;
    return { path, map: old ? oldFiles : newFiles, object: `${old ? ws.mergeBase : ws.sourceHead}:${path}` };
  };
  const env = gitEnv("/dev/null");
  const g = (args: string[]) => git([`--git-dir=${ws.cache}`, ...args], { env });
  for (const f of findings) {
    const b = blobOf(f);
    if (!b || b.map.has(b.path) || big.has(b.object)) continue;
    try {
      if (Number((await g(["cat-file", "-s", b.object])).trim()) > MAX_FILE_CHARS) big.add(b.object);
      else b.map.set(b.path, await g(["cat-file", "blob", b.object]));
    } catch {
      // No such file on that side. The validator drops the finding with reason "file".
    }
  }
  const oversized = (f: Finding) => {
    const b = blobOf(f);
    return b !== null && big.has(b.object);
  };
  return { newFiles, oldFiles, oversized };
}

// Turns a runner outcome into the run end. servers: the MCP servers of the spec. gaps: the servers and skills left out of the spec.
// rereview: the earlier findings of a re-review at their current lines. asked: the threads of context/questions.md.
export async function judge(
  o: RunOutcome,
  ws: Workspace,
  profile: Profile,
  servers: string[],
  gaps: string[],
  rereview: { carry: Carry; items: EarlierItem[] } | null,
  asked: AskedThread[],
): Promise<Ending> {
  const raw = rawOutput(o);
  if (o.status !== "completed") return { status: o.status, kind: o.kind, text: o.text, raw, outcome: o };
  const parsed = rereview ? rereviewResult.safeParse(o.result?.structured_output) : reviewResult.safeParse(o.result?.structured_output);
  if (!parsed.success) return schemaFailure(parsed.error.issues, rereview ? "re-review" : "review", raw, o);
  const earlier = rereview ? (parsed.data as RereviewResult).earlier : [];
  const items = rereview?.items ?? [];
  // Only a finished Agent call returned a report.
  const agents = o.events.filter((e) => e.tool === "Agent" && e.agent !== null && e.status === "ok").map((e) => e.agent as string);
  const blobs = await readBlobs(ws, [...parsed.data.findings, ...earlierCases(earlier, items).cases.map((c) => c.finding)]);
  const v = validate({ result: parsed.data, diff: ws.diff, ...blobs, agents, explain: profile.explain });
  const e = rereview ? validateEarlier({ earlier, items, diff: ws.diff, ...blobs }) : null;
  const a = profile.explain ? null : validateAnswered(parsed.data.answered, asked, v.kept);
  const dropped = v.dropped.map((d) => (d.reason === "file" && blobs.oversized(d) ? { ...d, reason: "size" as const } : d));
  const base = rereview?.carry.incomplete ? [`Run ${rereview.carry.base}, the base of this re-review, was incomplete.`] : [];
  const coverage = {
    ...v.coverage,
    skipped: [...v.coverage.skipped, ...(e?.skipped ?? []), ...(a?.skipped ?? [])],
    unavailable: [...v.coverage.unavailable, ...unavailable(o, servers, gaps)],
    notChecked: [...v.coverage.notChecked, ...base],
  };
  return ended(raw, o, {
    summary: { summary: v.summary, risks: v.risks, coverage, dropped },
    items: [...v.findings.map(findingItem), ...v.questions.map(questionItem), ...(a?.replies ?? []).map(replyItem)],
    ...(e && { checked: e.checked }),
  });
}

export function judgeReplies(o: RunOutcome, threads: ReplyThread[], servers: string[], gaps: string[]): Ending {
  const raw = rawOutput(o);
  if (o.status !== "completed") return { status: o.status, kind: o.kind, text: o.text, raw, outcome: o };
  const parsed = replyResult.safeParse(o.result?.structured_output);
  if (!parsed.success) return schemaFailure(parsed.error.issues, "reply", raw, o);
  const v = validateReplies(parsed.data, threads);
  const coverage = { ...v.coverage, unavailable: [...v.coverage.unavailable, ...unavailable(o, servers, gaps)] };
  return ended(raw, o, { summary: { summary: v.summary, risks: [], coverage, dropped: [] }, items: v.replies.map(replyItem) });
}

// Plan r2 S-ASK: an ask run makes no items, so nothing of it can post.
export function judgeAsk(o: RunOutcome, servers: string[], gaps: string[]): Ending {
  const raw = rawOutput(o);
  if (o.status !== "completed") return { status: o.status, kind: o.kind, text: o.text, raw, outcome: o };
  const parsed = askResult.safeParse(o.result?.structured_output);
  if (!parsed.success) return schemaFailure(parsed.error.issues, "ask", raw, o);
  const { answer, coverage } = parsed.data;
  const summary =
    answer
      .split("\n")
      .find((l) => l.trim())
      ?.trim() ?? "";
  return ended(raw, o, {
    summary: {
      summary,
      risks: [],
      coverage: { ...coverage, unavailable: [...coverage.unavailable, ...unavailable(o, servers, gaps)] },
      dropped: [],
    },
    items: [],
    answer,
  });
}

// docs/plans/session-consult.md part C: a session run makes no items. Its entries go to answer. The answer preview checks each
// entry again, and nothing changes before the user clicks Apply.
// Part D: fix holds the workspace and the items that need a verdict. validateFix keeps only the edits for accepted items. The notes
// go to fix_json and the edits to fix_edit of the session run. Only an import copies them into a fix run, so no fix card shows before.
export async function judgeSession(o: RunOutcome, fix: { ws: Workspace; asked: string[] } | null): Promise<Ending> {
  const raw = rawOutput(o);
  if (o.status !== "completed") return { status: o.status, kind: o.kind, text: o.text, raw, outcome: o };
  const parsed = consultOutput.safeParse(o.result?.structured_output);
  if (!parsed.success) return schemaFailure(parsed.error.issues, "session answer", raw, o);
  const n = parsed.data.answers.length;
  const answers = `${n} ${n === 1 ? "answer" : "answers"}`;
  const none = { read: [], skipped: [], unavailable: [], notChecked: [] };
  const result = (summary: string, coverage: RunSummary["coverage"], edits?: { threads: FixNote[]; edits: ValidEdit[] }) =>
    ended(raw, o, {
      summary: { summary, risks: [], coverage, dropped: [] },
      items: [],
      answer: JSON.stringify(parsed.data.answers),
      ...(edits && { fix: edits }),
    });
  if (!fix) return result(answers, none);
  const proposal = fixResult.safeParse(parsed.data.fix);
  if (!proposal.success) {
    const issues = issuesText(proposal.error.issues);
    return result(answers, { ...none, skipped: [`The fix does not match the fix schema, so the run keeps no edit. ${issues}`] });
  }
  const files = await readFixFiles(
    fix.ws,
    proposal.data.edits.map((e) => e.path),
  );
  const v = validateFix(proposal.data, acceptedTargets(parsed.data.answers, fix.asked), files);
  const m = v.edits.length;
  return result(`${answers}, ${m} ${m === 1 ? "edit" : "edits"}`, v.coverage, { threads: v.threads, edits: v.edits });
}

export const cancelledEnding = (o?: RunOutcome): Ending => ({
  status: "cancelled",
  kind: null,
  text: null,
  raw: o ? rawOutput(o) : "Cancelled before the runner started.",
  outcome: o,
});

const BLOB_TIMEOUT_MS = 60_000;

// git() decodes stdout as text. That drops a BOM and hides invalid UTF-8, so the edit rules read the blob bytes here.
async function blobBytes(cache: string, env: Record<string, string>, object: string): Promise<Uint8Array> {
  const p = Bun.spawn(["git", `--git-dir=${cache}`, "cat-file", "blob", object], {
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: BLOB_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  const [bytes, err, code] = await Promise.all([new Response(p.stdout).bytes(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`git cat-file failed (exit ${code ?? p.signalCode}): ${err.trim().slice(-2000)}`);
  return bytes;
}

// The edit paths at the source head, read from the cache clone, never from the sanitized worktree.
// The full tree listing needs no pathspec, so no path text can act as pathspec magic.
async function readFixFiles(ws: Workspace, paths: string[]): Promise<Map<string, FixFile>> {
  const env = gitEnv("/dev/null");
  const listing = await git([`--git-dir=${ws.cache}`, "ls-tree", "-r", "-t", "-l", "-z", "--full-tree", ws.sourceHead], { env });
  // ls-tree -l: "<mode> <type> <object> <padded size>\t<path>". The size of a tree or a gitlink is "-".
  const tree = new Map<string, { mode: string; type: string; object: string; size: number }>();
  for (const entry of listing.split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab < 0) continue;
    const [mode = "", type = "", object = "", size = ""] = entry.slice(0, tab).split(/ +/);
    tree.set(entry.slice(tab + 1), { mode, type, object, size: Number(size) });
  }
  const files = new Map<string, FixFile>();
  for (const raw of paths) {
    const path = repoPath(raw);
    if (path === null || files.has(path)) continue;
    const parts = path.split("/");
    const underFile = parts.slice(0, -1).some((_, i) => {
      const t = tree.get(parts.slice(0, i + 1).join("/"));
      return t !== undefined && t.type !== "tree";
    });
    const t = tree.get(path);
    if (underFile || t?.type === "tree") files.set(path, "blocked");
    else if (t?.type === "commit") files.set(path, { mode: t.mode, bytes: new Uint8Array() });
    else if (t) files.set(path, t.size > MAX_FILE_CHARS ? "size" : { mode: t.mode, bytes: await blobBytes(ws.cache, env, t.object) });
  }
  return files;
}

// docs/plans/thread-outcome.md: the unaccepted reply draft of a thread note without a fix. "already" proposes to resolve the thread.
// As in validateReplies, only a thread that the user started gets the tick.
function nofixItem(n: FixNote, t: ReplyThread, body: string): NewItem {
  const already = n.why === "already";
  const payload: ReplyPayload = {
    thread: t.thread,
    action: "reply",
    body,
    reason: n.reason,
    evidenceStatus: "unverified",
    judgement: null,
    replyTo: t.replyTo,
    resolve: already,
    resolveEvidence: already ? n.reason.trim() : "",
    resolveTick: already && !!t.mine,
    origin: "nofix",
  };
  return replyItem({ payload, status: "new" });
}

// Plan r3 S-FIX: the notes of a fix run go to fix_json and its edits to fix_edit. Its only items are the nofix reply drafts.
export async function judgeFix(
  o: RunOutcome,
  ws: Workspace,
  threads: ReplyThread[],
  findings: number[],
  servers: string[],
  gaps: string[],
): Promise<Ending> {
  const raw = rawOutput(o);
  if (o.status !== "completed") return { status: o.status, kind: o.kind, text: o.text, raw, outcome: o };
  const parsed = fixResult.safeParse(o.result?.structured_output);
  if (!parsed.success) return schemaFailure(parsed.error.issues, "fix", raw, o);
  const files = await readFixFiles(
    ws,
    parsed.data.edits.map((e) => e.path),
  );
  const v = validateFix(parsed.data, { threads: threads.map((t) => t.thread), findings }, files);
  const skipped = [...v.coverage.skipped];
  const items = v.threads.flatMap((n): NewItem[] => {
    const t = threads.find((x) => x.thread === n.thread);
    const body = n.reply.trim();
    if (!t || n.fixed || !NOFIX_DRAFT.has(n.why) || !body) return [];
    if (body.length <= MAX_NOTE) return [nofixItem(n, t, body)];
    skipped.push(`Reply for thread ${t.thread} dropped: the body is longer than ${MAX_NOTE} characters.`);
    return [];
  });
  const coverage = { ...v.coverage, skipped, unavailable: [...v.coverage.unavailable, ...unavailable(o, servers, gaps)] };
  return ended(raw, o, {
    summary: { summary: v.summary, risks: [], coverage, dropped: [] },
    items,
    fix: { threads: v.threads, edits: v.edits },
  });
}
