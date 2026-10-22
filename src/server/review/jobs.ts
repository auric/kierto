// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Review jobs (plan v3 WP10), re-reviews (r2 S-RR), ask runs (r2 S-ASK), reply-draft jobs (replies.md WP17), fix runs (r3 S-FIX), and
// session runs (session-consult.md part C): one run from the stored brief to stored drafts, edits, or answers. One run at a time.
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { consultJsonSchema, type SessionAnswerDto, sessionMaxTurns, sessionTokens } from "../../shared/consult";
import {
  type AskDto,
  alwaysSkillError,
  type BriefDto,
  type BriefInput,
  type FixDto,
  type PrTask,
  type ReviewItemDto,
  type RunConflict,
  type RunDetail,
  type RunDto,
  type RunKind,
  type RunnerCheckDto,
  type RunPhase,
} from "../../shared/dto";
import { isMe } from "../../shared/me";
import {
  askJsonSchema,
  type Carried,
  type FixedMark,
  fixJsonSchema,
  MAX_EARLIER,
  MAX_REPLY_THREADS,
  parseFixNotes,
  REVIEW_PROMPT_VERSION,
  type ReplyPayload,
  replyJsonSchema,
  rereviewJsonSchema,
  reviewJsonSchema,
  verifyJsonSchema,
} from "../../shared/review";
import { CHECK_EVENT, type RunEvent } from "../../shared/run-log";
import { byThread, newestLive, type TurnMsg, threadTurn } from "../../shared/turn";
import type { PrRef } from "../../shared/types";
import { dataDir as defaultDataDir } from "../config";
import { taskContext } from "../context/task-file";
import type { Live } from "../live";
import { log } from "../log";
import type { Settings } from "../settings";
import {
  askAgent,
  createDocServers,
  DEFAULT_PROFILE,
  delegation,
  fixAgent,
  GIT_SERVER,
  type ListTools,
  MIN_EDIT_TURNS,
  mainAgent,
  moduleNotes,
  type Profile,
  profileOf,
  profileRevision,
  REVIEWER,
  type ReviewContext,
  replyAgent,
  reviewerAgent,
  VERIFIER,
  VERIFY_SPLIT,
  verifierAgent,
  verifierEffort,
  verifyAgent,
  withDelegation,
  withInstructions,
  withMcp,
  withSkills,
  withVerifyDelegation,
} from "./catalog";
import { createClaudeRunner, RUN_TIMEOUT_MS, type RunnerCheck } from "./claude";
import { type FixCommitRow, toFixCommitDto } from "./clone";
import { codegraphEntry, codegraphIndex, indexCodegraph } from "./codegraph";
import { candidatesFile, earlierItem, findingsFile, fixStateFile, historyFile, questionsFile } from "./context-files";
import { runEffort } from "./defaults";
import { parseDiff } from "./diffmap";
import { currentDrafts, placeReplies, replyOutcome, revisions, touched, withRevision } from "./drafts";
import { gitEnv } from "./git";
import { gitMcpServer } from "./git-mcp";
import { createImprover } from "./improve";
import { projectInstructions } from "./instructions";
import {
  type CandidateLink,
  type CheckRun,
  cancelledCheck,
  cancelledEnding,
  type Ending,
  failure,
  judge,
  judgeAsk,
  judgeFix,
  judgeReplies,
  judgeSession,
  markCopy,
  settle,
  settleExplain,
  unreadAlways,
  usageOf,
} from "./judge";
import { languagesOf, withLanguages } from "./languages";
import {
  buildAskPrompt,
  buildFixPrompt,
  buildPrompt,
  buildReplyPrompt,
  buildRereviewPrompt,
  buildVerifyPrompt,
  type ReplyThread,
} from "./prompt";
import { type Carry, carryOver, current, type PostedFinding, resolveProposals } from "./rereview";
import {
  commentsOf,
  effortsNow,
  type FindingRow,
  type FixEditRow,
  type Heads,
  type ItemRow,
  type NewItem,
  type PrRow,
  type RunRow,
  type SessionRecord,
  type SessionStart,
  SQL,
  toFixEditDto,
  toItemDto,
  toPullRequest,
  toRunDto,
} from "./run-rows";
import { alwaysProblems, claudeConfigDir, copySkills } from "./skills";
import { claudeJsonPath, userServers } from "./user-mcp";
import type { AskedThread } from "./validate";
import { cachePath, type GitRemote, longPath, noUrl, prepareWorkspace, pruneWorkspaces, type Workspace } from "./workspace";

// The entry point of the review modules. The routes, the tests, and the scripts import these names from here.
export { fixStateFile, HISTORY_ASK_BYTES, HISTORY_FINDING_BYTES, historyFile, QUESTIONS_BYTES, questionsFile } from "./context-files";
export { currentDrafts, DROP_REVISIONS, keptText, revisedText, revisions, sameText, touched, userDraft, withRevision } from "./drafts";
export { type ItemRow, type SessionRecord, type SessionStart, toItemDto } from "./run-rows";

// Plan v3 WP10: at most 2 `changed` events with runs per second.
const NOTIFY_MS = 500;
// A judge session run makes at most SESSION_MAX_TURNS read-only turns. A fix session run gets the runner limit (claude.ts).
const SESSION_TIMEOUT_MS = 20 * 60_000;
// The git MCP server runs `bun <main.ts> --git-mcp`. Bun.main is another file under bun test and in serve.ts.
const MAIN_ENTRY = join(import.meta.dir, "..", "main.ts");

// docs/plans/review-v2/spec.md section 0, VERIFY_MAX_TURNS: min(profile.maxTurns, 10 + 3 × candidates), at least 12.
export const verifyMaxTurns = (p: Pick<Profile, "maxTurns">, candidates: number) => Math.max(12, Math.min(p.maxTurns, 10 + 3 * candidates));

// The source item ID of a carried copy (rereview.ts carryOver).
const carriedFrom = (it: NewItem) => (JSON.parse(it.payload_json) as { carried?: Carried }).carried?.from;

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
  // The Claude Code config folder for profile skills and MCP servers. Absent: CLAUDE_CONFIG_DIR or the default, read at each run.
  claudeConfigDir?: string;
  now?: () => number;
};

// threads: the threads of a reply or fix run, else null. findings: the review item IDs of a fix run.
// question: the question of an ask run, else null. profile: the profile as it was at the start.
type Job = {
  id: number;
  pr: number;
  kind: RunKind;
  key: string;
  db: Database;
  profile: Profile;
  threads: ReplyThread[] | null;
  // A reply run for threads that the user named. Its drafts replace a draft that the user declined.
  picked: boolean;
  findings: number[];
  // A fix run for one target that the user wants fixed despite a decision or risk note ("Fix anyway").
  anyway?: boolean;
  carry: Carry | null;
  // A review run only: the threads of context/questions.md, set when the workspace starts (docs/plans/thread-outcome.md section 9).
  asked: AskedThread[];
  question: string | null;
  // A session run only.
  session: SessionStart | null;
  cancelled: boolean;
  done: Promise<void>;
  // The step of the run. RunDto.phase shows it. candidates: the candidates of phase checking.
  phase?: RunDto["phase"];
  candidates?: number;
  // Stops the step before the CLI starts.
  abort?: AbortController;
};

export type StartResult =
  | { status: 200 | 202; run: RunDto }
  | { status: 409; conflict: RunConflict }
  | { status: 400 | 404 | 409; error: string };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const toCheckDto = (c: RunnerCheck): RunnerCheckDto => (c.ok ? { ok: true, version: c.version } : c);

export function createReviewJobs(opts: ReviewJobsOptions) {
  const { settings, live } = opts;
  const now = opts.now ?? Date.now;
  const dataDir = opts.dataDir ?? defaultDataDir();
  const runner = createClaudeRunner({ command: opts.runnerCommand });
  // Its own runner: a proposal uses no run folder, no git ref, and no database, so it runs beside the review run slot.
  const improve = createImprover({ command: opts.runnerCommand, now });
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
  // Each resolves after the next broadcast.
  const flushed: (() => void)[] = [];
  function flush() {
    timer = null;
    sentAt = Date.now();
    live.broadcast("changed", { prs: [...pending.prs], runs: [...pending.runs] });
    pending.prs.clear();
    pending.runs.clear();
    for (const r of flushed.splice(0)) r();
  }
  function notify(run: number, pr?: number) {
    pending.runs.add(run);
    if (pr !== undefined) pending.prs.add(pr);
    if (!timer) timer = setTimeout(flush, Math.max(0, sentAt + NOTIFY_MS - Date.now()));
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
        model: e.model,
        tokens: e.tokens,
        builtin: e.builtin ? 1 : 0,
        started: e.startedAt,
        ended: e.endedAt,
      });
  }

  // One transaction for the run, its log, and its items. Returns false when restart recovery ended the run first.
  function end(j: Job, e: Ending): boolean {
    const o = e.outcome;
    const r = o?.result;
    const usage = e.usage !== undefined ? e.usage : o ? usageOf(o) : null;
    // A session run has no --effort flag.
    const flagged = j.session ? null : j.profile.effort;
    const ok = j.db.transaction(() => {
      if (o) upsertEvents(j.db, j.id, o.events);
      const replies = replyOutcome(j.db, j.pr, e.result?.items ?? [], j.threads ?? j.asked, j.picked);
      const { notes } = replies;
      const summary = e.result?.summary;
      const coverage = summary && notes.length ? { ...summary.coverage, skipped: [...summary.coverage.skipped, ...notes] } : null;
      const done = j.db.query(SQL.end).run({
        id: j.id,
        status: e.status,
        kind: e.kind,
        text: e.text,
        session: o?.init?.session_id ?? r?.session_id ?? null,
        cli: o?.init?.claude_code_version ?? null,
        model: o?.init?.model ?? null,
        // The init event names the model that ran. Its default effort replaces the one from the run start.
        init_effort: !flagged && !!o?.init?.model,
        effort_default: !flagged && o?.init?.model ? runEffort(o.init.model) : null,
        usage: usage ? JSON.stringify(usage) : null,
        summary: summary ? JSON.stringify(coverage ? { ...summary, coverage } : summary) : null,
        answer: e.result?.answer ?? null,
        fix: e.result?.fix ? JSON.stringify(e.result.fix.threads) : null,
        raw: e.raw,
        now: now(),
      });
      // Restart recovery can end the row first. Then no item goes in.
      if (!done.changes) return false;
      const edit = j.db.query(SQL.fixEdit);
      for (const x of e.result?.fix?.edits ?? [])
        edit.run({
          run: j.id,
          ord: x.ord,
          thread: x.thread,
          item: x.finding,
          path: x.path,
          old: x.old,
          new: x.new,
          start: x.start,
          rows: JSON.stringify(x.rows),
        });
      const items = placeReplies(j.db, j.pr, e.result?.items ?? [], replies);
      const q = j.db.query(SQL.item);
      // docs/plans/review-v2/spec.md section 1.8: payload.verify.duplicateOf holds an item ID, known only after the insert.
      const links = e.result?.links ?? new Map<NewItem, CandidateLink>();
      const placed = new Map<number, number>();
      const dups: [number, number][] = [];
      const add = (list: NewItem[]) => {
        for (const it of list) {
          const id = Number(q.run({ run: j.id, ...it }).lastInsertRowid);
          const l = links.get(it);
          if (!l) continue;
          placed.set(l.n, id);
          if (l.duplicateOf !== null) dups.push([id, l.duplicateOf]);
        }
      };
      const linkDuplicates = () => {
        const dup = j.db.query(SQL.duplicateOf);
        for (const [id, n] of dups) {
          const target = placed.get(n);
          if (target !== undefined) dup.run({ id, target });
        }
      };
      if (!j.carry || !e.result) {
        add(items);
        linkDuplicates();
        return true;
      }
      const c = carryOver(j.db, j.carry, e.result.checked ?? []);
      const marks = e.result.carried;
      const open = c.open.map((it) => {
        const from = carriedFrom(it);
        const m = from === undefined ? undefined : marks?.get(from);
        if (!m) return it;
        const next = markCopy(it, m);
        links.set(next, m);
        return next;
      });
      add(items.filter((it) => it.kind === "finding"));
      add(open);
      add(items.filter((it) => it.kind !== "finding"));
      add(c.questions);
      add(c.closed);
      const me = settings.config()?.userSlug ?? null;
      add(resolveProposals(j.db, j.pr, j.carry, e.result.checked ?? [], me, turnThreads(j.db, { id: j.pr })));
      linkDuplicates();
      return true;
    })();
    notify(j.id, j.pr);
    return ok;
  }

  async function steps(j: Job, pr: Heads, brief: BriefInput, held: { ws?: Workspace }) {
    const cancelled = cancelledEnding;
    const c = await check();
    if (!c.ok) return failure(c.kind === "auth" ? "auth" : "process", c.message);
    if (j.cancelled) return cancelled();

    await prune();
    let ws: Workspace;
    const { files, attachments } = taskContext(j.db, j.pr, dataDir);
    const carry = j.carry;
    const earlier = carry?.items.filter((r) => r.kind === "finding") ?? [];
    const posted = new Set(carry?.posted.map((r) => r.id));
    // A re-review gets findings.md instead. An explain run gets no history.
    const history =
      j.kind !== "review"
        ? historyFile(j.db, j.pr, pr.source_head)
        : carry || j.profile.explain
          ? null
          : historyFile(j.db, j.pr, pr.source_head, true);
    const fixState =
      j.kind === "reply" && j.threads
        ? fixStateFile(
            j.db,
            j.pr,
            j.threads.map((t) => t.thread),
          )
        : null;
    // docs/plans/thread-outcome.md section 9: review and re-review runs judge the answers to the user's posted questions. Explain does not.
    const questions = j.kind === "review" && !j.profile.explain ? questionsFile(j.db, j.pr, settings.config()?.userSlug ?? null) : null;
    j.asked = questions?.threads ?? [];
    // The findings of a fix run as they are now. A user edit or move after the start counts.
    const fixRows = j.findings.flatMap((id) => (j.db.query(SQL.fixFinding).get({ id }) as FindingRow | null) ?? []);
    const extra = [
      ...(carry && (earlier.length || carry.posted.length)
        ? [
            findingsFile<ItemRow & Partial<PostedFinding>>([...current(j.db, earlier), ...carry.posted], (r, side) =>
              posted.has(r.id)
                ? side === "new"
                  ? (r.run_head ?? carry.since)
                  : (r.run_base ?? `the merge base of run ${r.run}`)
                : side === "new"
                  ? carry.since
                  : (carry.sinceBase ?? "the earlier merge base"),
            ),
          ]
        : []),
      ...(fixRows.length
        ? [findingsFile(fixRows, (r, side) => (side === "new" ? r.run_head : (r.run_base ?? `the merge base of run ${r.run}`)))]
        : []),
      ...(history ? [history] : []),
      ...(fixState ? [fixState] : []),
      ...(questions?.file ? [questions.file] : []),
    ];
    // Cancel stops the fetch and `worktree add`. A large repository can take as long as the run may take.
    j.abort = new AbortController();
    try {
      if (j.cancelled) return cancelled();
      ws = await prepareWorkspace({
        dataDir,
        runId: String(j.id),
        pr: toPullRequest(pr),
        comments: commentsOf(j.db, j.pr),
        remote: await remote({ project: pr.project, repo: pr.repo, id: pr.pr_id }),
        files: [...files, ...extra],
        attachments,
        ...(carry && { since: carry.since }),
        long: { signal: j.abort.signal, timeoutMs: RUN_TIMEOUT_MS },
      });
    } catch (e) {
      if (j.cancelled) return cancelled();
      return failure("workspace", noUrl((e as Error).message));
    } finally {
      j.abort = undefined;
    }
    held.ws = ws;
    j.db.query(SQL.workspace).run({ id: j.id, base: ws.mergeBase, range: ws.rangeBase, via: ws.via });
    notify(j.id);
    if (j.cancelled) return cancelled();

    const changed = parseDiff(ws.diff);
    // The run reads every source again. The text goes to the prompts and the run folder. SQLite and the log get the paths and sizes only.
    const instructions = await projectInstructions(
      j.db,
      { project: pr.project, repo: pr.repo },
      {
        cache: ws.cache,
        env: gitEnv("/dev/null"),
        commit: ws.targetHead,
        paths: changed.flatMap((f) => [f.path, f.oldPath].filter((p): p is string => p !== null)),
      },
      settings.globalInstructions() ? (opts.claudeConfigDir ?? claudeConfigDir()) : null,
    );
    if (instructions.text) writeFileSync(join(ws.work, "CLAUDE.md"), instructions.text);
    j.db
      .query(SQL.instructions)
      .run({ id: j.id, json: JSON.stringify({ files: instructions.files, bytes: instructions.bytes, notLoaded: instructions.notLoaded }) });
    for (const g of instructions.notLoaded) log(`Review run ${j.id}: project instructions not loaded: ${g}.`);
    if (instructions.files.length)
      log(
        `Review run ${j.id} project instructions: ${instructions.files
          .map((f) => `${f.source === "settings" ? "settings text" : `${f.path} from ${f.source}`} (${f.bytes} bytes)`)
          .join(", ")}.`,
      );
    if (j.cancelled) return cancelled();

    const profile = j.profile;
    const [docs, user] = await Promise.all([
      docServers(profile),
      userServers(
        profile.mcp,
        claudeJsonPath(opts.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR),
        opts.claudeConfigDir ?? claudeConfigDir(),
      ),
    ]);
    if (j.cancelled) return cancelled();
    // One index serves every picked codegraph server. A failed index keeps the servers out of the run.
    const graphs = Object.entries(user.servers).filter(([, s]) => codegraphIndex(s.user) >= 0);
    const first = graphs[0]?.[1].user;
    if (first?.type === "stdio") {
      j.phase = "indexing";
      j.abort = new AbortController();
      notify(j.id);
      const started = now();
      const failed = await indexCodegraph({
        entry: first,
        repo: ws.repo,
        dataDir,
        cacheDb: join(dataDir, "cache", "codegraph", pr.project, pr.repo, "codegraph.db"),
        signal: j.abort.signal,
      });
      j.phase = undefined;
      j.abort = undefined;
      notify(j.id);
      if (j.cancelled) return cancelled();
      log(`Review run ${j.id}: codegraph index: ${failed ?? "ready"} after ${now() - started} ms.`);
      for (const [key, s] of graphs)
        if (failed) {
          delete user.servers[key];
          user.gaps.push(`MCP server ${key}: no codegraph index (${failed})`);
        } else if (s.user.type === "stdio") user.servers[key] = { ...s, user: codegraphEntry(s.user, ws.repo) };
    }
    const mcpServers = { [GIT_SERVER]: gitMcpServer(ws, MAIN_ENTRY), ...docs.servers, ...user.servers };
    for (const g of user.gaps) log(`Review run ${j.id}: ${g}.`);
    const used = Object.entries(user.servers).map(([server, s]) => ({ server, tools: s.tools, remote: s.user.type !== "stdio" }));
    if (used.length) log(`Review run ${j.id} MCP servers: ${used.map((u) => `${u.server} (${u.tools.length} tools)`).join(", ")}.`);
    const unmarked = user.unmarked.length ? `Unmarked MCP tools allowed: ${user.unmarked.join(", ")}.` : null;
    if (unmarked) log(`Review run ${j.id}: ${unmarked}`);
    const skills = copySkills(profile.skills, join(ws.work, "skills"), opts.claudeConfigDir ?? claudeConfigDir());
    for (const g of skills.gaps) log(`Review run ${j.id}: ${g}.`);
    const isAlways = (id: string) => profile.alwaysSkills.includes(id);
    if (skills.copied.length)
      log(
        `Review run ${j.id} skills: ${skills.copied
          .map(
            (s) =>
              `${s.id}${s.version ? `@${s.version}` : ""}${isAlways(s.id) ? " (always)" : ""} (${s.files} files, ${s.bytes} bytes${s.skipped ? `, ${s.skipped} skipped` : ""})`,
          )
          .join(", ")}.`,
      );
    j.db.query(SQL.skills).run({ id: j.id, json: JSON.stringify(skills.copied.map((s) => ({ id: s.id, always: isAlways(s.id) }))) });
    // launch checked the always-use skills. The disk can change before the copy.
    const lost = profile.alwaysSkills.filter((id) => !skills.copied.some((s) => s.id === id));
    if (lost.length)
      return failure(
        "process",
        alwaysProblems(lost, opts.claudeConfigDir ?? claudeConfigDir()).join(" ") || alwaysSkillError(lost[0] as string, "the copy failed"),
      );
    const folders = skills.copied.map((s) => s.folder);
    const always = skills.copied.filter((s) => isAlways(s.id)).map((s) => s.folder);
    // Review and re-review runs only. Explain gives no findings.
    const langs = j.kind === "review" && profile.languageChecks && !profile.explain ? languagesOf(changed) : [];
    if (langs.length) log(`Review run ${j.id} language checks: ${langs.join(", ")}.`);
    // docs/plans/review-v2/design.md R8: the app gives the Agent tool by the size of the change, not the model.
    const delegate = j.kind === "review" ? delegation(profile, changed) : null;
    if (j.kind === "review" && !profile.explain)
      log(`Review run ${j.id}: ${changed.length} changed files, rl-reviewer ${delegate ? `on (${delegate})` : "off"}.`);
    const context: ReviewContext = {
      taskFile: files.length > 0,
      attachments: attachments.length > 0,
      history: history !== null,
      questions: j.asked.length > 0,
      rereview: !!carry,
      instructions: instructions.text !== "",
      goal: !!pr.description?.trim() || files.length > 0,
    };
    const gaps = [...docs.unavailable, ...user.gaps, ...skills.gaps];
    const input = {
      mergeBase: ws.mergeBase,
      head: ws.sourceHead,
      note: brief.note,
      profile,
      pr: { project: pr.project, repo: pr.repo, prId: pr.pr_id, webUrl: pr.web_url },
      tasks: j.db.query(SQL.tasks).all({ pr: j.pr }) as PrTask[],
      taskFile: files.length > 0,
      attachments: attachments.length > 0,
      history: history !== null,
      fixState: fixState !== null,
      questions: j.asked.length > 0,
      instructions: instructions.text,
    };
    const reply = j.kind === "reply" ? j.threads : null;
    const fix = j.kind === "fix" ? j.threads : null;
    const question = j.question;
    const spec = reply
      ? { prompt: buildReplyPrompt({ ...input, threads: reply }), schema: replyJsonSchema(), main: replyAgent(profile) }
      : fix
        ? {
            prompt: buildFixPrompt({ ...input, threads: fix, findings: j.findings, anyway: j.anyway }),
            schema: fixJsonSchema(),
            main: fixAgent(profile),
          }
        : question !== null
          ? { prompt: buildAskPrompt({ ...input, question }), schema: askJsonSchema(), main: askAgent(profile) }
          : carry
            ? {
                prompt: buildRereviewPrompt({
                  ...input,
                  since: carry.since,
                  rangeBase: ws.rangeBase,
                  earlier: [...earlier, ...carry.posted].map((r) => r.id),
                  posted: carry.posted.map((r) => r.id),
                }),
                schema: rereviewJsonSchema(),
                main: mainAgent(profile, context),
              }
            : { prompt: buildPrompt(input), schema: reviewJsonSchema(profile.explain), main: mainAgent(profile, context) };
    // docs/plans/review-v2/spec.md section 1.9: a review run shows phase finding, then checking.
    const finder = j.kind === "review" && !profile.explain;
    if (finder) {
      j.phase = "finding";
      notify(j.id);
    }
    const findStart = now();
    const o = await runner.run(
      {
        cwd: ws.work,
        appDir: ws.app,
        ...spec,
        main: withDelegation(withMcp(withSkills(withLanguages(spec.main, langs), folders, always), used), delegate),
        maxTurns: reply || fix ? Math.max(profile.maxTurns, MIN_EDIT_TURNS) : profile.maxTurns,
        model: profile.model,
        effort: profile.effort,
        // Only a delegating review gets subagents. With agents {}, the CLI gets no Agent tool.
        agents: delegate
          ? {
              [REVIEWER]: withInstructions(
                withMcp(withSkills(withLanguages(reviewerAgent(profile, context), langs), folders, always), used),
                instructions.text,
              ),
            }
          : {},
        mcpServers,
      },
      (events) => {
        j.db.transaction(() => upsertEvents(j.db, j.id, events))();
        notify(j.id);
      },
    );
    const find: RunPhase = { name: "find", startedAt: findStart, endedAt: now(), usage: usageOf(o) };
    // The runner ignores a cancel that comes after the process ended.
    if (j.cancelled) return cancelled(o);
    const servers = Object.keys(mcpServers);
    const unread = unreadAlways(
      o,
      skills.copied.filter((s) => isAlways(s.id)),
    );
    const left = questions?.left
      ? [`${questions.left} threads with your posted questions were left out of ./context/questions.md: it reached its size limit.`]
      : [];
    const modules = j.kind === "review" && !profile.explain ? moduleNotes(profile, context) : [];
    const noted = (e: Ending): Ending => {
      e.result?.summary.coverage.notChecked.push(...unread, ...left, ...modules);
      if (!unmarked) return e;
      e.result?.summary.coverage.notChecked.push(unmarked);
      return { ...e, raw: `${unmarked}\n\n${e.raw}` };
    };
    if (reply) return noted(judgeReplies(o, reply, servers, gaps));
    if (fix) return noted(await judgeFix(o, ws, fix, j.findings, servers, gaps));
    if (question !== null) return noted(judgeAsk(o, servers, gaps));
    const rereview = carry && { carry, items: [...current(j.db, earlier), ...carry.posted].map(earlierItem) };
    const found = await judge(o, ws, profile, servers, gaps, rereview, j.asked, instructions.sources);
    if (!("candidates" in found)) return noted(found);
    if (!finder) return noted(settleExplain(found));

    // docs/plans/review-v2/spec.md section 1.6: the verify phase in the same workspace, run row, and run slot.
    const verify = profile.verifier.mode === "on";
    const file = verify && found.candidates.length ? candidatesFile(found.candidates) : null;
    const written = file?.written ?? 0;
    let verified: CheckRun | null = null;
    if (file && written > 0) {
      writeFileSync(join(ws.context, file.file.name), file.file.text);
      const split = written > VERIFY_SPLIT;
      log(`Review run ${j.id}: checks ${written} of ${found.candidates.length} candidates, ${VERIFIER} ${split ? "on" : "off"}.`);
      j.phase = "checking";
      j.candidates = written;
      notify(j.id);
      const offset = o.events.reduce((m, e) => Math.max(m, e.seq), -1) + 1;
      const tag = (e: RunEvent): RunEvent => ({
        ...e,
        id: CHECK_EVENT + e.id,
        parent: e.parent === null ? null : CHECK_EVENT + e.parent,
        seq: e.seq + offset,
      });
      const verifier = withInstructions(withMcp(withSkills(verifierAgent(profile, context), folders, always), used), instructions.text);
      // No await between this check and run(), so a later Cancel reaches the new process.
      if (j.cancelled) return cancelled(o);
      const startedAt = now();
      const o2 = await runner.run(
        {
          cwd: ws.work,
          appDir: ws.app,
          prompt: buildVerifyPrompt({ ...input, count: written, rereview: !!carry }),
          schema: verifyJsonSchema(),
          main: withVerifyDelegation(withMcp(withSkills(verifyAgent(profile, context), folders, always), used), split),
          maxTurns: verifyMaxTurns(profile, written),
          model: profile.verifier.model ?? profile.model,
          effort: verifierEffort(profile),
          agents: split ? { [VERIFIER]: verifier } : {},
          mcpServers,
        },
        (events) => {
          j.db.transaction(() => upsertEvents(j.db, j.id, events.map(tag)))();
          notify(j.id);
        },
      );
      j.db.transaction(() => upsertEvents(j.db, j.id, o2.events.map(tag)))();
      if (j.cancelled) return cancelledCheck(o, o2);
      verified = { o: o2, startedAt, endedAt: now(), written };
    }
    return noted(settle(found, { volume: profile.volume, find, check: verified, verify, written, servers }));
  }

  // docs/plans/session-consult.md part C: a fork of the user's session in a fresh sanitized snapshot of the PR head, never in the
  // user's clone. The stored text, entries, and run log hold no transcript text.
  async function sessionSteps(j: Job, s: SessionStart, pr: Heads, held: { ws?: Workspace }): Promise<Ending> {
    const c = await check();
    if (!c.ok) return failure(c.kind === "auth" ? "auth" : "process", c.message);
    if (j.cancelled) return cancelledEnding();
    await prune();
    j.abort = new AbortController();
    try {
      if (j.cancelled) return cancelledEnding();
      held.ws = await prepareWorkspace({
        dataDir,
        runId: String(j.id),
        pr: toPullRequest(pr),
        comments: commentsOf(j.db, j.pr),
        remote: await remote({ project: pr.project, repo: pr.repo, id: pr.pr_id }),
        long: { signal: j.abort.signal, timeoutMs: RUN_TIMEOUT_MS },
      });
    } catch (e) {
      if (j.cancelled) return cancelledEnding();
      return failure("workspace", noUrl((e as Error).message));
    } finally {
      j.abort = undefined;
    }
    const ws = held.ws;
    j.db.query(SQL.workspace).run({ id: j.id, base: ws.mergeBase, range: ws.rangeBase, via: ws.via });
    notify(j.id);
    if (j.cancelled) return cancelledEnding();
    const fix = s.mode === "fix";
    log(`Session run ${j.id}: forks a session of ${s.bytes} bytes with ${s.items} review points${fix ? " and asks for fixes" : ""}.`);
    const o = await runner.run(
      {
        cwd: ws.work,
        appDir: ws.app,
        prompt: s.prompt,
        schema: consultJsonSchema(s.mode),
        maxTurns: sessionMaxTurns(s.mode),
        resume: s.path,
        // A fix session gets the limit of an app fix run.
        ...(!fix && { timeoutMs: SESSION_TIMEOUT_MS }),
      },
      (events) => {
        j.db.transaction(() => upsertEvents(j.db, j.id, events))();
        notify(j.id);
      },
    );
    if (j.cancelled) return cancelledEnding(o);
    return judgeSession(o, fix ? { ws, asked: s.asked } : null);
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
    let e: Ending;
    try {
      e = j.session ? await sessionSteps(j, j.session, pr, held) : await steps(j, pr, brief, held);
      // A later re-review merges from the reviewed head, and an apply builds the patch on the head of the fix run. The ref keeps it after a force push.
      // The fix run of a session import (part D) builds on the head of the session run.
      const proposes = j.kind === "fix" || (j.kind === "session" && (e.result?.fix?.edits.length ?? 0) > 0);
      const ref = proposes ? `fix/${j.id}` : j.kind === "review" && !j.profile.explain ? "reviewed" : null;
      if (e.result && ref)
        await held.ws?.keep(ref).catch((err) => log(`Could not keep the head of review run ${j.id}: ${noUrl((err as Error).message)}`));
    } catch (err) {
      const message = (err as Error).message;
      log(`Review run ${j.id} failed: ${message}`);
      e = failure("process", message);
    }
    await held.ws?.remove().catch((err) => log(`Could not remove the workspace of review run ${j.id}: ${noUrl((err as Error).message)}`));
    // The slot frees in the same tick as the end write. A client that sees the end can start the next run.
    if (job === j) job = null;
    try {
      end(j, e);
    } catch (e2) {
      // The settings changed and closed this database. The next open marks the run failed.
      log(`Could not end review run ${j.id}: ${(e2 as Error).message}`);
    }
  }

  const withPhase = (db: Database, r: RunDto): RunDto =>
    job?.phase && job.id === r.id && job.db === db && r.status === "running"
      ? { ...r, phase: job.phase, ...(job.phase === "checking" && job.candidates !== undefined && { candidates: job.candidates }) }
      : r;

  function cancelActive() {
    if (!job) return false;
    job.cancelled = true;
    job.abort?.abort();
    runner.cancel();
    return true;
  }

  // A settings change closes the database of the run.
  settings.onSettingsChanged(() => {
    cancelActive();
  });

  // The one run slot (A14). The same key returns the running run. null: the slot is free.
  function taken(db: Database, key: string): StartResult | null {
    if (!job) return null;
    const running = runRow(job.db, job.id);
    if (job.key === key && job.db === db && running) return { status: 200, run: toRunDto(running) };
    return { status: 409, conflict: { error: "Another review is running.", running: { run: job.id, pr: job.pr } } };
  }

  // Takes the slot and starts the run in the background.
  function begin(j: Job, pr: Heads, brief: BriefInput): StartResult {
    job = j;
    j.done = execute(j, pr, brief).finally(() => {
      if (job === j) job = null;
      // wait() resolves after the final broadcast. The broadcast keeps its NOTIFY_MS spacing.
      if (timer) return new Promise<void>((r) => flushed.push(r));
    });
    notify(j.id, pr.id);
    return { status: 202, run: toRunDto(runRow(j.db, j.id) as RunRow) };
  }

  function launch(
    db: Database,
    pr: Heads,
    brief: BriefInput,
    profile: Profile,
    key: string,
    kind: RunKind,
    o: { threads?: ReplyThread[]; picked?: boolean; findings?: number[]; anyway?: boolean; carry?: Carry; question?: string } = {},
  ): StartResult {
    const busy = taken(db, key);
    if (busy) return busy;
    // A missing always-use skill refuses the start, so no failed run is stored.
    const missing = alwaysProblems(profile.alwaysSkills, opts.claudeConfigDir ?? claudeConfigDir());
    if (missing.length) return { status: 409, error: missing.join(" ") };
    const { threads = null, picked = false, findings = [], anyway = false, carry = null, question = null } = o;
    const { id: runId } = db.query(SQL.insert).get({
      pr: pr.id,
      kind,
      profile: profile.id,
      profile_name: profile.name,
      profile_revision: profileRevision(profile),
      explain: profile.explain ? 1 : 0,
      note: brief.note,
      key,
      source: pr.source_head,
      target: pr.target_head,
      now: now(),
      since: carry?.since ?? null,
      question,
      tasks: JSON.stringify(db.query(SQL.fetched).all({ pr: pr.id })),
      model: profile.model,
      effort: profile.effort ?? "default",
      effort_default: profile.effort ? null : runEffort(profile.model),
      prompt_version: REVIEW_PROMPT_VERSION,
    }) as { id: number };
    return begin(
      {
        id: runId,
        pr: pr.id,
        kind,
        key,
        db,
        profile,
        threads,
        picked,
        findings,
        anyway,
        carry,
        asked: [],
        question,
        session: null,
        cancelled: false,
        done: Promise.resolve(),
      },
      pr,
      brief,
    );
  }

  // The messages of each thread of a PR, by root comment ID.
  function turnThreads(db: Database, pr: Pick<PrRow, "id">) {
    type Row = Omit<TurnMsg, "deleted" | "threadResolved"> & { deleted: number; threadResolved: number };
    const rows = db.query(SQL.turns).all({ pr: pr.id }) as Row[];
    return byThread(rows.map((m) => ({ ...m, deleted: m.deleted === 1, threadResolved: m.threadResolved === 1 })));
  }

  // The threads of a reply run, by thread ID. Absent list: every thread where it is my turn (D12, D13).
  function replyThreads(db: Database, pr: PrRow, list?: number[]): ReplyThread[] | { status: 400 | 409; error: string } {
    const threads = turnThreads(db, pr);
    const me = settings.config()?.userSlug ?? null;
    const prAuthor = pr.my_role === "AUTHOR";
    const ids = list ? [...new Set(list)] : [...threads].filter(([, t]) => threadTurn(t, me, prAuthor) === "your").map(([id]) => id);
    const out: ReplyThread[] = [];
    for (const thread of ids) {
      const msgs = threads.get(thread) ?? [];
      const last = newestLive(msgs);
      if (!last) return { status: 400, error: `Comment ${thread} does not start a thread of this pull request with a live message.` };
      const root = msgs.find((m) => m.id === thread);
      const mine = !!root && isMe({ slug: root.authorSlug, login: root.authorLogin }, me);
      const joined = msgs.some((m) => !m.deleted && isMe({ slug: m.authorSlug, login: m.authorLogin }, me));
      out.push({ thread, replyTo: last.id, mine, joined });
    }
    if (!out.length) return { status: 409, error: "No thread waits for your reply." };
    if (out.length > MAX_REPLY_THREADS)
      return { status: 409, error: `${out.length} threads wait for your reply. Draft at most ${MAX_REPLY_THREADS} at a time, per thread.` };
    return out.sort((a, b) => a.thread - b.thread);
  }

  // The threads of a fix run (plan r3 S-FIX). A given list passes the reply-run checks, and each thread must be unresolved (fix-ux.md).
  // Absent list: each thread whose current reply draft (currentDrafts) is not posted and judges the comment valid or partly valid, and that
  // has a live message.
  function fixThreads(db: Database, pr: PrRow, list?: number[]): ReplyThread[] | { status: 400 | 409; error: string } {
    if (list) {
      const threads = turnThreads(db, pr);
      const resolved = list.find((id) => threads.get(id)?.some((m) => m.threadResolved));
      if (resolved !== undefined) return { status: 400, error: `Thread ${resolved} is resolved. Fix works only on open threads.` };
      return replyThreads(db, pr, list);
    }
    const newest = currentDrafts(db, pr.id);
    const threads = turnThreads(db, pr);
    const out: number[] = [];
    for (const [thread, r] of newest) {
      const judgement = r.status === "posted" ? null : (JSON.parse(r.payload_json) as ReplyPayload).judgement;
      const last = newestLive(threads.get(thread) ?? []);
      if ((judgement === "valid" || judgement === "partly") && last) out.push(thread);
    }
    if (!out.length) return { status: 409, error: "No reply draft finds a comment valid or partly valid. Draft replies first." };
    if (out.length > MAX_REPLY_THREADS)
      return {
        status: 409,
        error: `${out.length} threads have a valid reply draft. Fix at most ${MAX_REPLY_THREADS} at a time, per thread.`,
      };
    // replyThreads adds mine: the resolve tick of a nofix draft needs it.
    return replyThreads(db, pr, out);
  }

  // The findings of a fix run (docs/plans/fix-ux.md WP3): open findings of this PR that are not posted and have a place in the code.
  function fixFindings(db: Database, pr: PrRow, list: number[]): number[] | { status: 400; error: string } {
    const ids = [...new Set(list)].sort((a, b) => a - b);
    for (const id of ids) {
      const r = db.query(SQL.fixFinding).get({ id }) as FindingRow | null;
      const refuse = (why: string) => ({ status: 400 as const, error: `Finding ${id} ${why}` });
      if (r?.kind !== "finding" || r.run_pr !== pr.id) return refuse("is not a finding of this pull request.");
      if (r.status === "posted") return refuse("is posted. Fix its thread instead.");
      if (r.status === "discarded") {
        const p = JSON.parse(r.payload_json) as { carried?: Carried; fixed?: FixedMark };
        if (p.fixed) return refuse(`is closed: it is fixed in ${p.fixed.short}.`);
        if (p.carried && p.carried.verdict !== "open") return refuse(`is closed: a re-review found it ${p.carried.verdict}.`);
        if (r.copy !== null) return refuse(`is closed: a re-review carried it over as finding ${r.copy}.`);
        return refuse("is discarded. Fix works only on open findings.");
      }
      if (r.path === null || r.side === null || r.line === null) return refuse("has no place in the code.");
    }
    return ids;
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
    // Cancels the active run and the running prompt proposal, and waits for their end.
    async stop() {
      const j = job;
      cancelActive();
      await Promise.all([j?.done, improve.stop()]);
    },
    improve,
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
    // profile: a profile for this run only. Absent: the brief profile. The brief keeps its profile.
    review(db: Database, id: number, profileId?: string): StartResult {
      const pr = prRow(db, id);
      if (!pr) return { status: 404, error: "Pull request not found." };
      const { source_head, target_head } = pr;
      if (!source_head || !target_head) return { status: 409, error: "Sync the pull request first." };
      const brief = briefOf(db, id);
      const profile = profileOf(settings.profiles(), profileId ?? brief.profile);
      const key = [id, source_head, target_head, profile.id, profileRevision(profile), sha256(brief.note)].join(":");
      return launch(db, { ...pr, source_head, target_head }, brief, profile, key, "review");
    },

    // Plan r2 S-RR: reviews the commits after the base run and checks its open findings. It shares the run slot.
    rereview(db: Database, id: number): StartResult {
      const pr = prRow(db, id);
      if (!pr) return { status: 404, error: "Pull request not found." };
      const { source_head, target_head } = pr;
      if (!source_head || !target_head) return { status: 409, error: "Sync the pull request first." };
      const brief = briefOf(db, id);
      const profile = profileOf(settings.profiles(), brief.profile);
      if (profile.explain) return { status: 409, error: "The Explain profile gives no findings. Pick a review profile first." };
      const base = db.query(`${SQL.run} ${SQL.baseRun}`).get({ pr: id }) as RunRow | null;
      if (!base) return { status: 409, error: "Review the pull request first." };
      if (base.source_head === source_head) return { status: 409, error: `Run ${base.id} reviewed this source head. No new commits.` };
      const key = [id, "rereview", base.id, source_head, target_head, brief.profile, profileRevision(profile), sha256(brief.note)].join(
        ":",
      );
      const items = db.query(SQL.carry).all({ run: base.id }) as ItemRow[];
      const room = MAX_EARLIER - items.filter((r) => r.kind === "finding").length;
      const carry: Carry = {
        base: base.id,
        since: base.source_head,
        sinceBase: base.merge_base,
        incomplete: base.status === "incomplete",
        items,
        // shortcut: above MAX_EARLIER earlier findings, the oldest posted findings get no verdict. Page the verdicts if this happens.
        posted: room > 0 ? (db.query(SQL.posted).all({ pr: id, limit: room }) as PostedFinding[]) : [],
      };
      return launch(db, { ...pr, source_head, target_head }, brief, profile, key, "review", { carry });
    },

    // Plan r2 S-ASK: answers one question with the brief profile, or the given one, and an empty note. It shares the run slot.
    ask(db: Database, id: number, question: string, profileId?: string): StartResult {
      const pr = prRow(db, id);
      if (!pr) return { status: 404, error: "Pull request not found." };
      const { source_head, target_head } = pr;
      if (!source_head || !target_head) return { status: 409, error: "Sync the pull request first." };
      const brief = briefOf(db, id);
      const profile = profileOf(settings.profiles(), profileId ?? brief.profile);
      const key = [id, "ask", source_head, target_head, profile.id, profileRevision(profile), sha256(question)].join(":");
      return launch(db, { ...pr, source_head, target_head }, { ...brief, note: "" }, profile, key, "ask", { question });
    },

    // The newest ask runs of a PR with their answers. null for an unknown PR.
    asks(db: Database, pr: number): AskDto[] | null {
      if (!prRow(db, pr)) return null;
      const now = effortsNow();
      return (db.query(`${SQL.run} ${SQL.asks}`).all({ pr }) as RunRow[]).map((r) => ({ run: toRunDto(r, now), answer: r.answer }));
    },

    // Starts a reply-draft run of the stored brief (plan replies.md WP17). It shares the run slot with reviews.
    // profile: a profile for this run only. Absent: the brief profile.
    draftReplies(db: Database, id: number, list?: number[], profileId?: string): StartResult {
      const pr = prRow(db, id);
      if (!pr) return { status: 404, error: "Pull request not found." };
      const { source_head, target_head } = pr;
      if (!source_head || !target_head) return { status: 409, error: "Sync the pull request first." };
      const found = replyThreads(db, pr, list);
      if (!Array.isArray(found)) return found;
      // docs/plans/thread-outcome.md: the run revises a draft that the user edited or accepted. A thread that the user named always,
      // the other threads only when new messages came after the draft. Draft replies keeps a current one as it is.
      const drafts = currentDrafts(db, id);
      const threads = found.map((t): ReplyThread => {
        const cur = drafts.get(t.thread);
        if (!cur || !touched(cur)) return t;
        const stale = (JSON.parse(cur.payload_json) as ReplyPayload).replyTo !== t.replyTo;
        return list !== undefined || stale ? { ...t, revise: cur.id } : t;
      });
      const brief = briefOf(db, id);
      const profile = profileOf(settings.profiles(), profileId ?? brief.profile);
      const at = threads.map((t) => `${t.thread}@${t.replyTo}`);
      const key = [id, "reply", source_head, target_head, profile.id, profileRevision(profile), sha256(brief.note), ...at].join(":");
      return launch(db, { ...pr, source_head, target_head }, brief, profile, key, "reply", { threads, picked: list !== undefined });
    },

    // Plan r3 S-FIX: proposes edits for the review points on the user's own PR. It shares the run slot.
    // pick: the threads and the review findings to fix. Absent both: the threads with a valid or partly valid reply draft.
    // fixRunInput caps the threads and the findings together. profile: a profile for this run only. Absent: the brief profile.
    // anyway: "Fix anyway" for the one target of pick. fixRunInput refuses it with more targets.
    fix(
      db: Database,
      id: number,
      pick: { threads?: number[]; findings?: number[]; anyway?: boolean } = {},
      profileId?: string,
    ): StartResult {
      const pr = prRow(db, id);
      if (!pr) return { status: 404, error: "Pull request not found." };
      const { source_head, target_head } = pr;
      if (!source_head || !target_head) return { status: 409, error: "Sync the pull request first." };
      if (pr.my_role !== "AUTHOR") return { status: 409, error: "Fix works only on your own pull requests." };
      const brief = briefOf(db, id);
      const profile = profileOf(settings.profiles(), profileId ?? brief.profile);
      if (profile.explain) return { status: 409, error: "The Explain profile proposes no fixes. Pick a review profile first." };
      const threads = pick.threads || !pick.findings ? fixThreads(db, pr, pick.threads) : [];
      if (!Array.isArray(threads)) return threads;
      const findings = pick.findings ? fixFindings(db, pr, pick.findings) : [];
      if (!Array.isArray(findings)) return findings;
      const at = [...threads.map((t) => `${t.thread}@${t.replyTo}`), ...findings.map((f) => `finding${f}`)];
      const anyway = pick.anyway === true;
      const key = [id, "fix", source_head, target_head, profile.id, profileRevision(profile), ...at, ...(anyway ? ["anyway"] : [])].join(
        ":",
      );
      return launch(db, { ...pr, source_head, target_head }, { ...brief, note: "" }, profile, key, "fix", { threads, findings, anyway });
    },

    // docs/plans/session-consult.md part C: forks the user's own session with the text of part A. Own PRs only. It shares the run slot.
    session(db: Database, id: number, s: SessionStart): StartResult {
      const pr = prRow(db, id);
      if (!pr) return { status: 404, error: "Pull request not found." };
      const { source_head, target_head } = pr;
      if (!source_head || !target_head) return { status: 409, error: "Sync the pull request first." };
      if (pr.my_role !== "AUTHOR") return { status: 409, error: "Ask your session works only on your own pull requests." };
      // The tag suffix is new for each start, so the key leaves it out.
      const key = [id, "session", source_head, target_head, s.id, sha256(s.prompt.replaceAll(s.tag, ""))].join(":");
      const busy = taken(db, key);
      if (busy) return busy;
      const record: SessionRecord = {
        session: s.id,
        title: s.title,
        bytes: s.bytes,
        tokens: sessionTokens(s.bytes),
        groups: s.groups,
        items: s.items,
        textBytes: s.textBytes,
        snapshot: s.snapshot,
        mode: s.mode,
      };
      const { id: runId } = db.query(SQL.sessionInsert).get({
        pr: id,
        key,
        source: source_head,
        target: target_head,
        now: now(),
        consult: JSON.stringify(record),
      }) as { id: number };
      const profile = profileOf(settings.profiles(), DEFAULT_PROFILE);
      const heads = { ...pr, source_head, target_head };
      const j: Job = {
        id: runId,
        pr: id,
        kind: "session",
        key,
        db,
        profile,
        threads: null,
        picked: false,
        findings: [],
        carry: null,
        asked: [],
        question: null,
        session: s,
        cancelled: false,
        done: Promise.resolve(),
      };
      return begin(j, heads, { note: "", profile: profile.id });
    },

    // The answer of an ended session run, the item keys at its start, and the count of its proposed edits per item ID (part D).
    // null: no such run of the PR, or no answer.
    sessionAnswer(db: Database, pr: number, run: number): SessionAnswerDto | null {
      const r = db.query(SQL.sessionAnswer).get({ run, pr }) as { answer: string; consult_json: string } | null;
      if (!r) return null;
      const record = JSON.parse(r.consult_json) as SessionRecord;
      const edits: Record<string, number> = {};
      for (const e of db.query(SQL.fixEdits).all({ run }) as FixEditRow[]) {
        const id = e.thread !== null ? `T${e.thread}` : `F${e.item}`;
        edits[id] = (edits[id] ?? 0) + 1;
      }
      return { entries: JSON.parse(r.answer) as unknown[], snapshot: record.snapshot, mode: record.mode ?? "judge", edits };
    },

    // The newest fix runs of a PR with their notes, edits, and commits. null for an unknown PR.
    fixes(db: Database, id: number): FixDto[] | null {
      const pr = prRow(db, id);
      if (!pr) return null;
      const cache = cachePath(longPath(dataDir), { project: pr.project, repo: pr.repo, id: pr.pr_id });
      const now = effortsNow();
      return (db.query(`${SQL.run} ${SQL.fixes}`).all({ pr: id }) as RunRow[]).map((r) => ({
        run: toRunDto(r, now),
        threads: parseFixNotes(r.fix_json),
        edits: (db.query(SQL.fixEdits).all({ run: r.id }) as FixEditRow[]).map(toFixEditDto),
        commits: (db.query(SQL.fixCommits).all({ run: r.id }) as FixCommitRow[]).map((c) => toFixCommitDto(c, cache)),
      }));
    },

    // The current reply draft of each thread (currentDrafts), unless it is posted, with its waiting revision. null for an unknown PR.
    replyDrafts(db: Database, pr: number): ReviewItemDto[] | null {
      if (!prRow(db, pr)) return null;
      const revs = revisions(db, pr);
      return [...currentDrafts(db, pr).values()]
        .filter((r) => r.status !== "posted")
        .sort((a, b) => (a.thread ?? 0) - (b.thread ?? 0))
        .map((r) => withRevision(r, revs));
    },

    // The Claude config folder of the runs. The instructions preview reads the global file from it.
    configDir: () => opts.claudeConfigDir ?? claudeConfigDir(),

    cancel(db: Database, run: number): "cancelled" | "not_running" | null {
      if (!runRow(db, run)) return null;
      return job?.id === run && job.db === db && cancelActive() ? "cancelled" : "not_running";
    },

    // pr: the runs of one PR. null: the runs of all PRs. Newest first. A consult run (session-consult.md part C) and the fix run of a
    // session import (part D) start no process, so no run list shows them. The fix cards show the fix run of an import.
    // R14: the list of one PR also keeps its newest review run, and its newest review run with a result, when newer runs fill the limit.
    // The UI shows the drafts of the newest review run with a result after a cancelled or failed one.
    runs(db: Database, pr: number | null, limit: number): RunDto[] {
      const listed = "kind <> 'consult' AND NOT (kind = 'fix' AND consult_json IS NOT NULL)";
      const sql =
        pr === null
          ? `${SQL.run} WHERE r.id IN (SELECT id FROM review_run WHERE ${listed} ORDER BY id DESC LIMIT $limit) ORDER BY r.id DESC`
          : `${SQL.run} WHERE r.id IN (SELECT id FROM review_run WHERE pr = $pr AND ${listed} ORDER BY id DESC LIMIT $limit)
              OR r.id = (SELECT MAX(id) FROM review_run WHERE pr = $pr AND kind = 'review')
              OR r.id = (SELECT MAX(id) FROM review_run WHERE pr = $pr AND kind = 'review' AND status IN ('completed', 'incomplete'))
              ORDER BY r.id DESC`;
      const now = effortsNow();
      return (db.query(sql).all(pr === null ? { limit } : { pr, limit }) as RunRow[]).map((r) => withPhase(db, toRunDto(r, now)));
    },

    run(db: Database, id: number): RunDetail | null {
      const r = runRow(db, id);
      // The DTO kind has no "consult". Only the SQL row can hold it.
      if (!r || (r.kind as string) === "consult") return null;
      return {
        run: withPhase(db, toRunDto(r)),
        events: (db.query(SQL.events).all({ run: id }) as (Omit<RunEvent, "builtin"> & { builtin: number })[]).map((e) => ({
          ...e,
          builtin: e.builtin === 1,
        })),
        items: (db.query(SQL.items).all({ run: id }) as ItemRow[]).map(toItemDto),
      };
    },

    raw(db: Database, id: number): string | null {
      return (db.query(SQL.raw).get({ id }) as { raw_output: string | null } | null)?.raw_output ?? null;
    },
  };
}

export type ReviewJobs = ReturnType<typeof createReviewJobs>;
