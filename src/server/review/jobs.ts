// Review jobs (plan v3 WP10) and reply-draft jobs (replies.md WP17): one run from the stored brief to stored drafts. One run at a time.
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type {
  BriefDto,
  BriefInput,
  PrTask,
  ReviewItemDto,
  RunConflict,
  RunDetail,
  RunDto,
  RunnerCheckDto,
  RunSummary,
  RunUsage,
} from "../../shared/dto";
import {
  type AnchoredFinding,
  type Finding,
  MAX_REPLY_THREADS,
  type Question,
  type ReplyPayload,
  replyJsonSchema,
  replyResult,
  reviewJsonSchema,
  reviewResult,
} from "../../shared/review";
import type { RunErrorKind, RunEvent, RunStatus } from "../../shared/run-log";
import { byThread, newestLive, type TurnMsg, threadTurn } from "../../shared/turn";
import type { Comment, ExcerptLine, PrRef, PullRequest } from "../../shared/types";
import { dataDir as defaultDataDir } from "../config";
import { taskFiles } from "../context/task-file";
import type { Live } from "../live";
import { log } from "../log";
import type { Settings } from "../settings";
import {
  createDocServers,
  DEFAULT_PROFILE,
  GIT_SERVER,
  type ListTools,
  mainAgent,
  type Profile,
  profileOf,
  profileRevision,
  REVIEWER,
  replyAgent,
  reviewerAgent,
  SHIPPED_PROFILES,
} from "./catalog";
import { createClaudeRunner, type RunnerCheck, type RunOutcome } from "./claude";
import { type DiffFile, parseDiff } from "./diffmap";
import { git, gitEnv } from "./git";
import { gitMcpServer } from "./git-mcp";
import { buildPrompt, buildReplyPrompt, type ReplyThread } from "./prompt";
import { MAX_FILE_CHARS, repoPath, type ValidatedReply, validate, validateReplies } from "./validate";
import { type GitRemote, noUrl, prepareWorkspace, pruneWorkspaces, type Workspace } from "./workspace";

const RAW_MAX = 2 * 1024 * 1024;
// Plan v3 WP10: at most 2 `changed` events with runs per second.
const NOTIFY_MS = 500;
// The git MCP server runs `bun <main.ts> --git-mcp`. Bun.main is another file under bun test and in serve.ts.
const MAIN_ENTRY = join(import.meta.dir, "..", "main.ts");

export type ReviewJobsOptions = {
  settings: Settings;
  live: Live;
  // Absent: REVIEW_LOOP_DATA_DIR or the OS default, as for the settings.
  dataDir?: string;
  // The CLI argv prefix. Absent: claude on PATH. serve.ts and the tests pass the fake CLI.
  runnerCommand?: string[];
  // Absent: the forge provider. The tests pass a file remote.
  gitRemote?: (ref: PrRef) => Promise<GitRemote>;
  // Absent: tools/list over the network. The tests pass a stub.
  listTools?: ListTools;
  now?: () => number;
};

type PrRow = {
  id: number;
  project: string;
  repo: string;
  pr_id: number;
  title: string | null;
  description: string | null;
  author_slug: string | null;
  author_name: string | null;
  my_role: string | null;
  state: string | null;
  pr_version: number | null;
  source_head: string | null;
  target_head: string | null;
  source_branch: string | null;
  target_branch: string | null;
  web_url: string | null;
  updated_date: number | null;
};

type Heads = PrRow & { source_head: string; target_head: string };

type RunRow = {
  id: number;
  pr: number;
  kind: RunDto["kind"];
  profile: string;
  // null for runs made before M4.
  profile_name: string | null;
  explain: number | null;
  note: string;
  source_head: string;
  target_head: string;
  merge_base: string | null;
  fetch_via: RunDto["via"];
  status: RunStatus;
  error_kind: RunErrorKind | null;
  error_text: string | null;
  session_id: string | null;
  cli_version: string | null;
  model: string | null;
  usage_json: string | null;
  summary_json: string | null;
  has_raw: number;
  started_at: number;
  finished_at: number | null;
  pr_source: string | null;
  pr_target: string | null;
  since_head: string | null;
  range_base: string | null;
  question: string | null;
};

export type ItemRow = {
  id: number;
  run: number;
  kind: ReviewItemDto["kind"];
  payload_json: string;
  body: string;
  path: string | null;
  side: "new" | "old" | null;
  line: number | null;
  line_end: number | null;
  anchor_state: AnchoredFinding["anchor"]["state"] | null;
  excerpt_json: string | null;
  status: ReviewItemDto["status"];
  revision: number;
  edited: number;
  // Reply items only: the root comment ID.
  thread: number | null;
};
type NewItem = Omit<ItemRow, "id" | "run" | "revision" | "edited">;

type Ending = {
  status: Exclude<RunStatus, "running">;
  kind: RunErrorKind | null;
  text: string | null;
  raw: string;
  outcome?: RunOutcome;
  result?: { summary: RunSummary; items: NewItem[] };
};

// threads: the threads of a reply run. null for a review run. profile: the profile as it was at the start.
type Job = {
  id: number;
  pr: number;
  key: string;
  db: Database;
  profile: Profile;
  threads: ReplyThread[] | null;
  cancelled: boolean;
  done: Promise<void>;
};

export type StartResult =
  | { status: 200 | 202; run: RunDto }
  | { status: 409; conflict: RunConflict }
  | { status: 400 | 404 | 409; error: string };

const SQL = {
  pr: `SELECT id, project, repo, pr_id, title, description, author_slug, author_name, my_role, state, pr_version, source_head, target_head, source_branch,
      target_branch, web_url, updated_date FROM pull_request WHERE id = $id`,
  comments: `SELECT comment_id, version, parent_id, root_id, author_slug, author_name, author_login, text, anchor_json, thread_resolved, created_at,
      updated_at, excerpt_json FROM comment WHERE pr = $pr AND tombstoned_at IS NULL`,
  tasks: "SELECT key, source, url FROM pr_task WHERE pr = $pr ORDER BY ord",
  brief: "SELECT note, profile, updated_at FROM pr_brief WHERE pr = $pr",
  saveBrief: `INSERT INTO pr_brief (pr, note, profile, updated_at) VALUES ($pr, $note, $profile, $now)
    ON CONFLICT (pr) DO UPDATE SET note = excluded.note, profile = excluded.profile, updated_at = excluded.updated_at`,
  insert: `INSERT INTO review_run (pr, kind, profile, profile_name, profile_revision, explain, note, idem_key, source_head, target_head, status, started_at)
    VALUES ($pr, $kind, $profile, $profile_name, $profile_revision, $explain, $note, $key, $source, $target, 'running', $now) RETURNING id`,
  run: `SELECT r.id, r.pr, r.kind, r.profile, r.profile_name, r.explain, r.note, r.source_head, r.target_head, r.merge_base, r.fetch_via, r.status, r.error_kind, r.error_text,
      r.session_id, r.cli_version, r.model, r.usage_json, r.summary_json, r.raw_output IS NOT NULL AS has_raw, r.started_at, r.finished_at,
      p.source_head AS pr_source, p.target_head AS pr_target, r.since_head, r.range_base, r.question
    FROM review_run r JOIN pull_request p ON p.id = r.pr`,
  workspace: "UPDATE review_run SET merge_base = $base, range_base = $range, fetch_via = $via WHERE id = $id",
  end: `UPDATE review_run SET status = $status, error_kind = $kind, error_text = $text, session_id = $session, cli_version = $cli, model = $model,
      usage_json = $usage, summary_json = $summary, raw_output = $raw, finished_at = $now WHERE id = $id AND status = 'running'`,
  // A run that was running at the last stop has no process now.
  recover: `UPDATE review_run SET status = 'failed', error_kind = 'restart', error_text = $text, raw_output = COALESCE(raw_output, $text),
      finished_at = $now WHERE status = 'running'`,
  event: `INSERT INTO run_event (run, id, seq, parent, tool, target, status, note, agent, started_at, ended_at)
    VALUES ($run, $id, $seq, $parent, $tool, $target, $status, $note, $agent, $started, $ended)
    ON CONFLICT (run, id) DO UPDATE SET status = excluded.status, note = excluded.note, agent = excluded.agent, ended_at = excluded.ended_at`,
  events: `SELECT id, seq, parent, tool, target, status, note, agent, started_at AS startedAt, ended_at AS endedAt FROM run_event
    WHERE run = $run ORDER BY seq`,
  item: `INSERT INTO review_item (run, kind, payload_json, body, path, side, line, line_end, anchor_state, excerpt_json, status, thread)
    VALUES ($run, $kind, $payload_json, $body, $path, $side, $line, $line_end, $anchor_state, $excerpt_json, $status, $thread)`,
  items: "SELECT * FROM review_item WHERE run = $run ORDER BY id",
  // A new reply draft replaces the open drafts of its thread. Posted drafts stay.
  supersede: `UPDATE review_item SET status = 'discarded', revision = revision + 1
    WHERE kind = 'reply' AND thread = $thread AND status IN ('new', 'accepted') AND run IN (SELECT id FROM review_run WHERE pr = $pr)`,
  replyItems: "SELECT i.* FROM review_item i JOIN review_run r ON r.id = i.run WHERE r.pr = $pr AND i.kind = 'reply' ORDER BY i.id",
  // Deleted messages too: the turn rule reads them.
  turns: `SELECT comment_id AS id, root_id AS rootId, author_slug AS authorSlug, author_login AS authorLogin, created_at AS createdAt,
      tombstoned_at IS NOT NULL AS deleted, thread_resolved AS threadResolved FROM comment WHERE pr = $pr`,
  raw: "SELECT raw_output FROM review_run WHERE id = $id",
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

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

const failure = (kind: RunErrorKind, text: string): Ending => ({ status: "failed", kind, text, raw: `${kind}: ${text}` });

const toCheckDto = (c: RunnerCheck): RunnerCheckDto => (c.ok ? { ok: true, version: c.version } : c);

function toPullRequest(r: PrRow & { source_head: string; target_head: string }): PullRequest {
  const author = r.author_slug ?? "";
  return {
    ref: { project: r.project, repo: r.repo, id: r.pr_id },
    version: r.pr_version ?? 0,
    title: r.title ?? "",
    description: r.description ?? undefined,
    state: r.state ?? "",
    author: { slug: author, name: r.author_name ?? author, login: author },
    reviewers: [],
    sourceHead: r.source_head,
    targetHead: r.target_head,
    sourceBranch: r.source_branch ?? "",
    targetBranch: r.target_branch ?? "",
    webUrl: r.web_url ?? undefined,
    updatedDate: r.updated_date ?? 0,
  };
}

function commentsOf(db: Database, pr: number): Comment[] {
  type Row = {
    comment_id: number;
    version: number;
    parent_id: number | null;
    root_id: number;
    author_slug: string;
    author_name: string | null;
    author_login: string | null;
    text: string;
    anchor_json: string | null;
    thread_resolved: number;
    created_at: number;
    updated_at: number;
    excerpt_json: string | null;
  };
  return (db.query(SQL.comments).all({ pr }) as Row[]).map((c) => {
    let anchor: unknown;
    let excerpt: ExcerptLine[] | undefined;
    try {
      anchor = c.anchor_json ? JSON.parse(c.anchor_json) : undefined;
      excerpt = c.excerpt_json ? JSON.parse(c.excerpt_json) : undefined;
    } catch {}
    return {
      id: c.comment_id,
      version: c.version,
      parentId: c.parent_id,
      rootId: c.root_id,
      author: { slug: c.author_slug, name: c.author_name ?? c.author_slug, login: c.author_login ?? c.author_slug },
      text: c.text,
      anchor,
      threadResolved: c.thread_resolved === 1,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      ...(excerpt && { excerpt }),
    };
  });
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
});

const NO_ANCHOR = { path: null, side: null, line: null, line_end: null, anchor_state: null, excerpt_json: null } as const;

const questionItem = (q: Question): NewItem => ({
  kind: "question",
  payload_json: JSON.stringify(q),
  body: q.text,
  ...NO_ANCHOR,
  status: "new",
  thread: null,
});

const replyItem = (r: ValidatedReply): NewItem => ({
  kind: "reply",
  payload_json: JSON.stringify(r.payload),
  body: r.payload.body,
  ...NO_ANCHOR,
  status: r.status,
  thread: r.payload.thread,
});

function schemaFailure(issues: { path: PropertyKey[]; message: string }[], what: string, raw: string, o: RunOutcome): Ending {
  const text = issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { status: "failed", kind: "schema", text: `The result does not match the ${what} schema. ${text}`, raw, outcome: o };
}

// The servers left out of the spec, then the servers of the spec that did not connect.
function unavailable(o: RunOutcome, servers: string[], gaps: string[]): string[] {
  const down = servers.flatMap((name) => {
    const status = o.init?.mcp_servers?.find((s) => s.name === name)?.status ?? "absent";
    return status === "connected" ? [] : [`MCP server ${name}: ${status}`];
  });
  return [...gaps, ...down];
}

function ended(raw: string, o: RunOutcome, result: NonNullable<Ending["result"]>): Ending {
  const c = result.summary.coverage;
  return { status: c.skipped.length || c.unavailable.length ? "incomplete" : "completed", kind: null, text: null, raw, outcome: o, result };
}

// Turns a runner outcome into the run end. servers: the MCP servers of the spec. gaps: the servers left out of the spec.
async function judge(o: RunOutcome, ws: Workspace, profile: Profile, servers: string[], gaps: string[]): Promise<Ending> {
  const raw = rawOutput(o);
  if (o.status !== "completed") return { status: o.status, kind: o.kind, text: o.text, raw, outcome: o };
  const parsed = reviewResult.safeParse(o.result?.structured_output);
  if (!parsed.success) return schemaFailure(parsed.error.issues, "review", raw, o);
  // Only a finished Agent call returned a report.
  const agents = o.events.filter((e) => e.tool === "Agent" && e.agent !== null && e.status === "ok").map((e) => e.agent as string);
  const blobs = await readBlobs(ws, parsed.data.findings);
  const v = validate({ result: parsed.data, diff: ws.diff, ...blobs, agents, explain: profile.explain });
  const dropped = v.dropped.map((d) => (d.reason === "file" && blobs.oversized(d) ? { ...d, reason: "size" as const } : d));
  const coverage = { ...v.coverage, unavailable: [...v.coverage.unavailable, ...unavailable(o, servers, gaps)] };
  return ended(raw, o, {
    summary: { summary: v.summary, risks: v.risks, coverage, dropped },
    items: [...v.findings.map(findingItem), ...v.questions.map(questionItem)],
  });
}

function judgeReplies(o: RunOutcome, threads: ReplyThread[], servers: string[], gaps: string[]): Ending {
  const raw = rawOutput(o);
  if (o.status !== "completed") return { status: o.status, kind: o.kind, text: o.text, raw, outcome: o };
  const parsed = replyResult.safeParse(o.result?.structured_output);
  if (!parsed.success) return schemaFailure(parsed.error.issues, "reply", raw, o);
  const v = validateReplies(parsed.data, threads);
  const coverage = { ...v.coverage, unavailable: [...v.coverage.unavailable, ...unavailable(o, servers, gaps)] };
  return ended(raw, o, { summary: { summary: v.summary, risks: [], coverage, dropped: [] }, items: v.replies.map(replyItem) });
}

function toRunDto(r: RunRow): RunDto {
  const source = r.pr_source !== null && r.pr_source !== r.source_head;
  const target = r.pr_target !== null && r.pr_target !== r.target_head;
  return {
    id: r.id,
    pr: r.pr,
    kind: r.kind,
    profile: r.profile,
    profileName: r.profile_name ?? SHIPPED_PROFILES.find((p) => p.id === r.profile)?.name ?? r.profile,
    explain: r.explain === null ? null : r.explain === 1,
    note: r.note,
    status: r.status,
    errorKind: r.error_kind,
    errorText: r.error_text,
    sourceHead: r.source_head,
    targetHead: r.target_head,
    mergeBase: r.merge_base,
    via: r.fetch_via,
    sessionId: r.session_id,
    cliVersion: r.cli_version,
    model: r.model,
    usage: r.usage_json ? (JSON.parse(r.usage_json) as RunUsage) : null,
    summary: r.summary_json ? (JSON.parse(r.summary_json) as RunSummary) : null,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    stale: source || target ? { source, target } : null,
    hasRaw: r.has_raw === 1,
    since: r.since_head === null ? null : { head: r.since_head, incremental: r.range_base !== null && r.range_base !== r.merge_base },
    question: r.question,
  };
}

export function toItemDto(r: ItemRow): ReviewItemDto {
  const payload = JSON.parse(r.payload_json) as AnchoredFinding | Question | ReplyPayload;
  const anchor =
    r.kind === "finding" && r.path !== null && r.side !== null && r.line !== null && r.line_end !== null && r.anchor_state !== null
      ? {
          state: r.anchor_state,
          path: r.path,
          oldPath: (payload as AnchoredFinding).anchor.oldPath,
          line: r.line,
          lineEnd: r.line_end,
          excerpt: JSON.parse(r.excerpt_json ?? "[]"),
          side: r.side,
        }
      : null;
  return {
    id: r.id,
    run: r.run,
    kind: r.kind,
    body: r.body,
    payload,
    anchor,
    status: r.status,
    revision: r.revision,
    edited: r.edited === 1,
  };
}

export function createReviewJobs(opts: ReviewJobsOptions) {
  const { settings, live } = opts;
  const now = opts.now ?? Date.now;
  const dataDir = opts.dataDir ?? defaultDataDir();
  const runner = createClaudeRunner({ command: opts.runnerCommand });
  const docServers = createDocServers(opts.listTools);
  const recovered = new WeakSet<Database>();
  let job: Job | null = null;
  let checked: RunnerCheck | null = null;
  let pruned: Promise<void> | null = null;

  // The database of the configured origin. Its first use ends the runs of the last process (restart recovery).
  function open(): Database | null {
    const db = settings.db();
    if (db && !recovered.has(db)) {
      recovered.add(db);
      db.query(SQL.recover).run({ text: "The app stopped during the run.", now: now() });
    }
    return db;
  }

  // pruneWorkspaces deletes every run folder. It runs once, before the first workspace.
  const prune = () =>
    (pruned ??= pruneWorkspaces(dataDir).catch((e) => {
      log(`Could not prune the review workspaces: ${(e as Error).message}`);
    }));

  async function check() {
    checked = await runner.check();
    return checked;
  }

  // ---------- SSE ----------
  const pending = { prs: new Set<number>(), runs: new Set<number>() };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sentAt = 0;
  function notify(run: number, pr?: number) {
    pending.runs.add(run);
    if (pr !== undefined) pending.prs.add(pr);
    if (timer) return;
    timer = setTimeout(
      () => {
        timer = null;
        sentAt = Date.now();
        live.broadcast("changed", { prs: [...pending.prs], runs: [...pending.runs] });
        pending.prs.clear();
        pending.runs.clear();
      },
      Math.max(0, sentAt + NOTIFY_MS - Date.now()),
    );
  }

  // ---------- Pipeline ----------
  function upsertEvents(db: Database, run: number, events: RunEvent[]) {
    const q = db.query(SQL.event);
    for (const e of events)
      q.run({
        run,
        id: e.id,
        seq: e.seq,
        parent: e.parent,
        tool: e.tool,
        target: e.target,
        status: e.status,
        note: e.note,
        agent: e.agent,
        started: e.startedAt,
        ended: e.endedAt,
      });
  }

  // One transaction for the run, its log, and its items.
  function end(j: Job, e: Ending) {
    const o = e.outcome;
    const r = o?.result;
    const usage: RunUsage | null = r ? { costUsd: r.total_cost_usd, turns: r.num_turns, durationMs: r.duration_ms, tokens: r.usage } : null;
    j.db.transaction(() => {
      if (o) upsertEvents(j.db, j.id, o.events);
      const done = j.db.query(SQL.end).run({
        id: j.id,
        status: e.status,
        kind: e.kind,
        text: e.text,
        session: o?.init?.session_id ?? r?.session_id ?? null,
        cli: o?.init?.claude_code_version ?? null,
        model: o?.init?.model ?? null,
        usage: usage ? JSON.stringify(usage) : null,
        summary: e.result ? JSON.stringify(e.result.summary) : null,
        raw: e.raw,
        now: now(),
      });
      // Restart recovery can end the row first. Then no item goes in.
      if (!done.changes) return;
      const items = e.result?.items ?? [];
      const supersede = j.db.query(SQL.supersede);
      for (const thread of new Set(items.map((it) => it.thread))) if (thread !== null) supersede.run({ thread, pr: j.pr });
      const q = j.db.query(SQL.item);
      for (const it of items) q.run({ run: j.id, ...it });
    })();
    notify(j.id, j.pr);
  }

  async function steps(j: Job, pr: Heads, brief: BriefInput, held: { ws?: Workspace }) {
    const cancelled = (o?: RunOutcome): Ending => ({
      status: "cancelled",
      kind: null,
      text: null,
      raw: o ? rawOutput(o) : "Cancelled before the runner started.",
      outcome: o,
    });
    const c = await check();
    if (!c.ok) return failure(c.kind === "auth" ? "auth" : "process", c.message);
    if (j.cancelled) return cancelled();

    await prune();
    let ws: Workspace;
    const files = taskFiles(j.db, j.pr);
    try {
      ws = await prepareWorkspace({
        dataDir,
        runId: String(j.id),
        pr: toPullRequest(pr),
        comments: commentsOf(j.db, j.pr),
        remote: await remote({ project: pr.project, repo: pr.repo, id: pr.pr_id }),
        files,
      });
    } catch (e) {
      return failure("workspace", noUrl((e as Error).message));
    }
    held.ws = ws;
    j.db.query(SQL.workspace).run({ id: j.id, base: ws.mergeBase, range: ws.rangeBase, via: ws.via });
    notify(j.id);
    if (j.cancelled) return cancelled();

    const profile = j.profile;
    const docs = await docServers(profile);
    if (j.cancelled) return cancelled();
    const mcpServers = { [GIT_SERVER]: gitMcpServer(ws, MAIN_ENTRY), ...docs.servers };
    const input = {
      mergeBase: ws.mergeBase,
      head: ws.sourceHead,
      note: brief.note,
      profile,
      pr: { project: pr.project, repo: pr.repo, prId: pr.pr_id, webUrl: pr.web_url },
      tasks: j.db.query(SQL.tasks).all({ pr: j.pr }) as PrTask[],
      taskFile: files.length > 0,
    };
    const reply = j.threads;
    const o = await runner.run(
      {
        cwd: ws.work,
        appDir: ws.app,
        prompt: reply ? buildReplyPrompt({ ...input, threads: reply }) : buildPrompt(input),
        schema: reply ? replyJsonSchema() : reviewJsonSchema(),
        maxTurns: profile.maxTurns,
        main: reply ? replyAgent(profile) : mainAgent(profile),
        agents: reply || profile.explain ? {} : { [REVIEWER]: reviewerAgent(profile) },
        mcpServers,
      },
      (events) => {
        j.db.transaction(() => upsertEvents(j.db, j.id, events))();
        notify(j.id);
      },
    );
    // The runner ignores a cancel that comes after the process ended.
    if (j.cancelled) return cancelled(o);
    const servers = Object.keys(mcpServers);
    return reply ? judgeReplies(o, reply, servers, docs.unavailable) : judge(o, ws, profile, servers, docs.unavailable);
  }

  // The git remote of a PR: the test remote, else the forge provider.
  async function remote(ref: PrRef): Promise<GitRemote> {
    if (opts.gitRemote) return opts.gitRemote(ref);
    const provider = await settings.provider();
    if (!provider) throw new Error("Configure the Bitbucket URL and token first.");
    return provider.gitRemote(ref);
  }

  async function execute(j: Job, pr: Heads, brief: BriefInput) {
    const held: { ws?: Workspace } = {};
    try {
      end(j, await steps(j, pr, brief, held));
    } catch (e) {
      const message = (e as Error).message;
      log(`Review run ${j.id} failed: ${message}`);
      try {
        end(j, failure("process", message));
      } catch (e2) {
        // The settings changed and closed this database. The next open marks the run failed.
        log(`Could not end review run ${j.id}: ${(e2 as Error).message}`);
      }
    } finally {
      await held.ws?.remove();
    }
  }

  function cancelActive() {
    if (!job) return false;
    job.cancelled = true;
    runner.cancel();
    return true;
  }

  // A settings change closes the database of the run.
  settings.onSettingsChanged(() => {
    cancelActive();
  });

  // The one run slot (A14). The same key returns the running run.
  function launch(db: Database, pr: Heads, brief: BriefInput, profile: Profile, key: string, threads: ReplyThread[] | null): StartResult {
    if (job) {
      const running = runRow(job.db, job.id);
      if (job.key === key && job.db === db && running) return { status: 200, run: toRunDto(running) };
      return { status: 409, conflict: { error: "Another review is running.", running: { run: job.id, pr: job.pr } } };
    }
    const { id: runId } = db.query(SQL.insert).get({
      pr: pr.id,
      kind: threads ? "reply" : "review",
      profile: profile.id,
      profile_name: profile.name,
      profile_revision: profileRevision(profile),
      explain: profile.explain ? 1 : 0,
      note: brief.note,
      key,
      source: pr.source_head,
      target: pr.target_head,
      now: now(),
    }) as { id: number };
    const j: Job = { id: runId, pr: pr.id, key, db, profile, threads, cancelled: false, done: Promise.resolve() };
    job = j;
    j.done = execute(j, pr, brief).finally(() => {
      if (job === j) job = null;
    });
    notify(runId, pr.id);
    return { status: 202, run: toRunDto(runRow(db, runId) as RunRow) };
  }

  // The threads of a reply run, by thread ID. Absent list: every thread where it is my turn (D12, D13).
  function replyThreads(db: Database, pr: PrRow, list?: number[]): ReplyThread[] | { status: 400 | 409; error: string } {
    type Row = Omit<TurnMsg, "deleted" | "threadResolved"> & { deleted: number; threadResolved: number };
    const rows = db.query(SQL.turns).all({ pr: pr.id }) as Row[];
    const threads = byThread(rows.map((m) => ({ ...m, deleted: m.deleted === 1, threadResolved: m.threadResolved === 1 })));
    const me = settings.config()?.userSlug ?? null;
    const prAuthor = pr.my_role === "AUTHOR";
    const ids = list ? [...new Set(list)] : [...threads].filter(([, t]) => threadTurn(t, me, prAuthor) === "your").map(([id]) => id);
    const out: ReplyThread[] = [];
    for (const thread of ids) {
      const last = newestLive(threads.get(thread) ?? []);
      if (!last) return { status: 400, error: `Comment ${thread} does not start a thread of this pull request with a live message.` };
      out.push({ thread, replyTo: last.id });
    }
    if (!out.length) return { status: 409, error: "No thread waits for your reply." };
    if (out.length > MAX_REPLY_THREADS)
      return { status: 409, error: `${out.length} threads wait for your reply. Draft at most ${MAX_REPLY_THREADS} at a time, per thread.` };
    return out.sort((a, b) => a.thread - b.thread);
  }

  // ---------- Reads ----------
  const prRow = (db: Database, id: number) => db.query(SQL.pr).get({ id }) as PrRow | null;
  const runRow = (db: Database, id: number) => db.query(`${SQL.run} WHERE r.id = $id`).get({ id }) as RunRow | null;

  function briefOf(db: Database, pr: number): BriefDto {
    const b = db.query(SQL.brief).get({ pr }) as { note: string; profile: string; updated_at: number } | null;
    // A deleted profile falls back to the first profile.
    const profile = profileOf(settings.profiles(), b?.profile ?? DEFAULT_PROFILE).id;
    return b ? { note: b.note, profile, updatedAt: b.updated_at } : { note: "", profile, updatedAt: null };
  }

  return {
    open,
    dataDir,
    remote,
    // At start: restart recovery, the prune of leftover workspaces, and the runner check.
    async start() {
      open();
      await prune();
      await check().catch((e) => log(`Runner check failed: ${(e as Error).message}`));
    },
    // Cancels the active run and waits for its end.
    async stop() {
      const j = job;
      cancelActive();
      await j?.done;
    },
    // Resolves when no run is active.
    wait: () => job?.done ?? Promise.resolve(),
    runnerCheck: (): RunnerCheckDto | null => (checked ? toCheckDto(checked) : null),
    hasProfile: (id: string) => settings.profiles().some((p) => p.id === id),

    brief(db: Database, pr: number): BriefDto | null {
      return prRow(db, pr) ? briefOf(db, pr) : null;
    },
    saveBrief(db: Database, pr: number, input: BriefInput): BriefDto | null {
      if (!prRow(db, pr)) return null;
      db.query(SQL.saveBrief).run({ pr, note: input.note, profile: input.profile, now: now() });
      return briefOf(db, pr);
    },

    // Starts a run of the stored brief. The same key returns the running run (A14).
    review(db: Database, id: number): StartResult {
      const pr = prRow(db, id);
      if (!pr) return { status: 404, error: "Pull request not found." };
      const { source_head, target_head } = pr;
      if (!source_head || !target_head) return { status: 409, error: "Sync the pull request first." };
      const brief = briefOf(db, id);
      const profile = profileOf(settings.profiles(), brief.profile);
      const key = [id, source_head, target_head, brief.profile, profileRevision(profile), sha256(brief.note)].join(":");
      return launch(db, { ...pr, source_head, target_head }, brief, profile, key, null);
    },

    // Starts a reply-draft run of the stored brief (plan replies.md WP17). It shares the run slot with reviews.
    draftReplies(db: Database, id: number, list?: number[]): StartResult {
      const pr = prRow(db, id);
      if (!pr) return { status: 404, error: "Pull request not found." };
      const { source_head, target_head } = pr;
      if (!source_head || !target_head) return { status: 409, error: "Sync the pull request first." };
      const threads = replyThreads(db, pr, list);
      if (!Array.isArray(threads)) return threads;
      const brief = briefOf(db, id);
      const profile = profileOf(settings.profiles(), brief.profile);
      const at = threads.map((t) => `${t.thread}@${t.replyTo}`);
      const key = [id, "reply", source_head, target_head, brief.profile, profileRevision(profile), sha256(brief.note), ...at].join(":");
      return launch(db, { ...pr, source_head, target_head }, brief, profile, key, threads);
    },

    // The newest reply item of each thread, unless it is posted. null for an unknown PR.
    replyDrafts(db: Database, pr: number): ReviewItemDto[] | null {
      if (!prRow(db, pr)) return null;
      const newest = new Map<number, ItemRow>();
      for (const r of db.query(SQL.replyItems).all({ pr }) as ItemRow[]) if (r.thread !== null) newest.set(r.thread, r);
      return [...newest.values()]
        .filter((r) => r.status !== "posted")
        .sort((a, b) => (a.thread ?? 0) - (b.thread ?? 0))
        .map(toItemDto);
    },

    cancel(db: Database, run: number): "cancelled" | "not_running" | null {
      if (!runRow(db, run)) return null;
      return job?.id === run && job.db === db && cancelActive() ? "cancelled" : "not_running";
    },

    // pr: the runs of one PR. null: the runs of all PRs. Newest first.
    // R14: the list of one PR also keeps its newest review run when newer reply runs fill the limit.
    runs(db: Database, pr: number | null, limit: number): RunDto[] {
      const sql =
        pr === null
          ? `${SQL.run} ORDER BY r.id DESC LIMIT $limit`
          : `${SQL.run} WHERE r.id IN (SELECT id FROM review_run WHERE pr = $pr ORDER BY id DESC LIMIT $limit)
              OR r.id = (SELECT MAX(id) FROM review_run WHERE pr = $pr AND kind = 'review') ORDER BY r.id DESC`;
      return (db.query(sql).all(pr === null ? { limit } : { pr, limit }) as RunRow[]).map(toRunDto);
    },

    run(db: Database, id: number): RunDetail | null {
      const r = runRow(db, id);
      if (!r) return null;
      return {
        run: toRunDto(r),
        events: db.query(SQL.events).all({ run: id }) as RunEvent[],
        items: (db.query(SQL.items).all({ run: id }) as ItemRow[]).map(toItemDto),
      };
    },

    raw(db: Database, id: number): string | null {
      return (db.query(SQL.raw).get({ id }) as { raw_output: string | null } | null)?.raw_output ?? null;
    },
  };
}

export type ReviewJobs = ReturnType<typeof createReviewJobs>;
