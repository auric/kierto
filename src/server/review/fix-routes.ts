// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Fix it API (plan r3 S-APPLY): the clone routes, commit, and undo. Git in the user's clone runs no network command.
import type { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { validator } from "hono/validator";
import {
  type ApiError,
  CLONE_INSTRUCTION_FILES,
  type CloneDto,
  type CloneProblem,
  type CloneRowDto,
  cloneInput,
  type FixCommitDto,
  type FixCommitInput,
  type FixConflict,
  fixCommitInput,
  type GlobalInstructionsDto,
  globalInstructionsInput,
  type InstructionPreviewDto,
  type InstructionRepoDto,
  type InstructionsInput,
  instructionsInput,
} from "../../shared/dto";
import { isMe } from "../../shared/me";
import type { ReplyPayload } from "../../shared/review";
import { newestLive, type TurnMsg } from "../../shared/turn";
import type { PullRequest } from "../../shared/types";
import { openFolder } from "../context/attachments";
import type { Live } from "../live";
import type { Settings } from "../settings";
import {
  applyCheck,
  applyIndex,
  buildPatch,
  CLONE_TEXT,
  cacheCommit,
  checkClone,
  clonePath,
  cloneProblem,
  commitIndex,
  type FixCommitRow,
  fixRef,
  hooksFolder,
  identity,
  indexEntries,
  type PatchEdit,
  resetKeep,
  stagedPaths,
  toFixCommitDto,
  treeEntries,
} from "./clone";
import { GitError, git } from "./git";
import { GLOBAL_FILE, instructionSettings, projectInstructions, saveInstructionSettings } from "./instructions";
import { currentDrafts, keptText, type ReviewJobs, userDraft } from "./jobs";
import { cachePath, gitSetup, locked, longPath } from "./workspace";

type PrRow = {
  id: number;
  project: string;
  repo: string;
  pr_id: number;
  source_branch: string | null;
  source_head: string | null;
  target_head: string | null;
};
// source: the source head S of the run.
type RunRow = { run: number; kind: string; source: string; pr: number; project: string; repo: string; pr_id: number };
// Exactly one of thread and item is set. item: the review_item ID of a finding.
type EditRow = PatchEdit & { thread: number | null; item: number | null };
type CommitRow = FixCommitRow & { project: string; repo: string };

const SQL = {
  pr: "SELECT id, project, repo, pr_id, source_branch, source_head, target_head FROM pull_request WHERE id = $id",
  repos: `SELECT p.project, p.repo, MAX(p.id) AS pr, c.path AS clone FROM pull_request p
    LEFT JOIN repo_clone c ON c.project = p.project AND c.repo = p.repo GROUP BY p.project, p.repo ORDER BY p.project, p.repo`,
  clone: "SELECT path FROM repo_clone WHERE project = $project AND repo = $repo",
  saveClone: `INSERT INTO repo_clone (project, repo, path, updated_at) VALUES ($project, $repo, $path, $now)
    ON CONFLICT (project, repo) DO UPDATE SET path = excluded.path, updated_at = excluded.updated_at`,
  dropClone: "DELETE FROM repo_clone WHERE project = $project AND repo = $repo",
  // PUT /prs/:id/clone writes a row only for a stored PR, and the app never deletes a PR row.
  clones: `SELECT c.project, c.repo, c.path, MAX(p.id) AS pr FROM repo_clone c
    JOIN pull_request p ON p.project = c.project AND p.repo = c.repo GROUP BY c.project, c.repo ORDER BY c.project, c.repo`,
  run: `SELECT r.id AS run, r.kind, r.source_head AS source, p.id AS pr, p.project, p.repo, p.pr_id
    FROM review_run r JOIN pull_request p ON p.id = r.pr WHERE r.id = $id`,
  edits: "SELECT id, thread, item, path, old, new FROM fix_edit WHERE run = $run ORDER BY ord",
  byKey: "SELECT id FROM fix_commit WHERE idem_key = $key AND state <> 'undone'",
  commit: "SELECT c.*, p.pr_id, p.project, p.repo FROM fix_commit c JOIN pull_request p ON p.id = c.pr WHERE c.id = $id",
  insert: `INSERT INTO fix_commit (pr, run, idem_key, edits_json, mode, clone_path, branch, before_head, state, message, created_at, updated_at)
    VALUES ($pr, $run, $key, $edits, $mode, $clone, $branch, $before, 'staged', $message, $now, $now) RETURNING id`,
  committed: "UPDATE fix_commit SET state = 'committed', commit_hash = $hash, short_hash = $short, updated_at = $now WHERE id = $id",
  undone: "UPDATE fix_commit SET state = 'undone', updated_at = $now WHERE id = $id",
  remove: "DELETE FROM fix_commit WHERE id = $id",
  // jobs.ts supersede: a new reply draft replaces the open drafts of its thread that the user did not touch. Posted drafts stay.
  replaceable: `SELECT i.id FROM review_item i JOIN review_run r ON r.id = i.run
    WHERE r.pr = $pr AND i.kind = 'reply' AND i.thread = $thread AND i.status = 'new' AND i.edited = 0 ORDER BY i.id`,
  supersede: "UPDATE review_item SET status = 'discarded', revision = revision + 1 WHERE id = $id AND status = 'new'",
  thread: `SELECT comment_id AS id, root_id AS rootId, author_slug AS authorSlug, author_login AS authorLogin, created_at AS createdAt,
      tombstoned_at IS NOT NULL AS deleted, thread_resolved AS threadResolved FROM comment WHERE pr = $pr AND root_id = $root`,
  item: `INSERT INTO review_item (run, kind, payload_json, body, status, thread, edited)
    VALUES ($run, 'reply', $payload, $body, 'new', $thread, 0)`,
  // The fix run records each thread where the commit kept the user's draft. A second commit adds no second line.
  kept: `UPDATE review_run SET summary_json = json_insert(summary_json, '$.coverage.skipped[#]', $text)
    WHERE id = $run AND json_valid(summary_json) AND NOT EXISTS (SELECT 1 FROM json_each(summary_json, '$.coverage.skipped') WHERE value = $text)`,
  fixDrafts: "SELECT thread, payload_json FROM review_item WHERE kind = 'reply' AND json_extract(payload_json, '$.fix.id') = $id",
  discard: `UPDATE review_item SET status = 'discarded', revision = revision + 1
    WHERE kind = 'reply' AND status IN ('new', 'accepted') AND json_extract(payload_json, '$.fix.id') = $id`,
  openDraft: `SELECT 1 FROM review_item i JOIN review_run r ON r.id = i.run
    WHERE r.pr = $pr AND i.kind = 'reply' AND i.thread = $thread AND i.status IN ('new', 'accepted')`,
  bringBack: "UPDATE review_item SET status = 'new', revision = revision + 1 WHERE id = $id AND status = 'discarded'",
  pushed: "SELECT 1 FROM pr_commit WHERE pr = $pr AND hash = $hash",
  // docs/plans/fix-ux.md decision 3: the commit discards each open finding that it covers. In SQLite, SET reads the old status.
  fixed: `UPDATE review_item SET status = 'discarded', revision = revision + 1,
      payload_json = json_set(payload_json, '$.fixed', json_object('id', $id, 'commit', $commit, 'short', $short, 'was', status))
    WHERE id = $item AND kind = 'finding' AND status IN ('new', 'accepted') AND run IN (SELECT id FROM review_run WHERE pr = $pr)`,
  // Undo: a finding that the mark still discards gets its status back. A finding that the user restored keeps its status. A posted one stays.
  unfixed: `UPDATE review_item SET status = CASE WHEN status = 'discarded' THEN json_extract(payload_json, '$.fixed.was') ELSE status END,
      payload_json = json_remove(payload_json, '$.fixed'), revision = revision + 1
    WHERE kind = 'finding' AND status <> 'posted' AND json_extract(payload_json, '$.fixed.id') = $id`,
  // The runs of the findings that a commit covers. Their drafts change with the commit and the undo.
  findingRuns: `SELECT DISTINCT i.run FROM fix_edit e JOIN review_item i ON i.id = e.item
    WHERE e.id IN (SELECT value FROM json_each($edits)) ORDER BY i.run`,
};

const positiveId = (what: string) =>
  validator("param", (v: Record<string, string>, c) => {
    const id = Number(v.id);
    return Number.isSafeInteger(id) && id > 0 ? { id } : c.json<ApiError>({ error: `Invalid ${what} ID.` }, 400);
  });
const prParam = positiveId("pull request");
const runParam = positiveId("run");
const commitParam = positiveId("fix commit");

const unconfigured = { error: "Configure the Bitbucket URL and token first." } satisfies ApiError;
const notFound = (what: string) => ({ error: `${what} not found.` }) satisfies ApiError;
// Undo refuses a clone that moved. Only problems that a reset can break count.
const UNDO_BLOCKS: CloneProblem[] = ["missing", "not_repo", "detached", "branch", "dirty", "busy"];

type Out = { status: 200 | 201; dto: FixCommitDto } | { status: 404 | 409 | 502; body: ApiError | FixConflict };
const conflict = (error: string, problems: FixConflict["problems"] = []): Out => ({ status: 409, body: { error, problems } });

// openFolder: the tests pass a recorder.
export function createFixRoutes(opts: {
  review: ReviewJobs;
  settings: Settings;
  live: Live;
  openFolder?: (path: string) => Promise<boolean>;
}) {
  const { review, settings, live } = opts;
  const opener = opts.openFolder ?? openFolder;
  // syncCache keys the cache and its lock by the long path of the data folder.
  const dataDir = () => longPath(review.dataDir);
  const env = () => gitSetup(dataDir()).env;
  const cacheOf = (p: { project: string; repo: string; pr_id: number }) =>
    cachePath(dataDir(), { project: p.project, repo: p.repo, id: p.pr_id });
  const prRow = (db: Database, id: number) => db.query(SQL.pr).get({ id }) as PrRow | null;
  const cloneOf = (db: Database, p: { project: string; repo: string }) =>
    (db.query(SQL.clone).get({ project: p.project, repo: p.repo }) as { path: string } | null)?.path ?? null;
  const commitRow = (db: Database, id: number) => db.query(SQL.commit).get({ id }) as CommitRow | null;
  const dtoOf = (db: Database, id: number) => {
    const r = commitRow(db, id) as CommitRow;
    return toFixCommitDto(r, cacheOf(r));
  };
  // A commit or an undo changes the fix commits, the reply drafts, and the covered findings of the PR.
  const changed = (db: Database, dto: FixCommitDto) => {
    const found = db.query(SQL.findingRuns).all({ edits: JSON.stringify(dto.edits) }) as { run: number }[];
    live.broadcast("changed", { prs: [(commitRow(db, dto.id) as CommitRow).pr], runs: [dto.run, ...found.map((r) => r.run)] });
  };
  // GET and PUT: no network. The synced source head stands for the live head.
  const cloneState = (db: Database, pr: PrRow): Promise<CloneDto> =>
    checkClone(cloneOf(db, pr), { branch: pr.source_branch ?? "", ...(pr.source_head ? { live: pr.source_head } : {}) });

  function insert(
    db: Database,
    run: RunRow,
    key: string,
    ids: number[],
    input: FixCommitInput,
    at: { clone: string | null; branch: string | null; before: string },
  ) {
    const now = Date.now();
    const v = { pr: run.pr, run: run.run, key, edits: JSON.stringify(ids), mode: input.mode, message: input.message, now, ...at };
    return (db.query(SQL.insert).get(v) as { id: number }).id;
  }

  // One transaction: the commit, the superseded drafts of each thread, one "Fixed in" reply draft per thread, and the fixed mark of each finding.
  // A thread keeps a draft that the user edited or accepted: it gets no "Fixed in" draft, and the fix run records it in its coverage.
  function finish(db: Database, run: RunRow, id: number, edits: EditRow[], made: { commit: string; short: string }) {
    db.transaction(() => {
      db.query(SQL.committed).run({ id, hash: made.commit, short: made.short, now: Date.now() });
      for (const item of new Set(edits.flatMap((e) => (e.item === null ? [] : [e.item]))))
        db.query(SQL.fixed).run({ item, pr: run.pr, id, commit: made.commit, short: made.short });
      const me = settings.config()?.userSlug ?? null;
      const drafts = currentDrafts(db, run.pr);
      for (const thread of new Set(edits.flatMap((e) => (e.thread === null ? [] : [e.thread])))) {
        const msgs = db.query(SQL.thread).all({ pr: run.pr, root: thread }) as TurnMsg[];
        const last = newestLive(msgs);
        if (!last) continue;
        // The user asked for this fix, so a declined draft does not block the "Fixed in" draft.
        if (userDraft(drafts.get(thread), false)) {
          db.query(SQL.kept).run({ run: run.run, text: keptText(thread) });
          continue;
        }
        const replaced = (db.query(SQL.replaceable).all({ thread, pr: run.pr }) as { id: number }[]).map((r) => r.id);
        for (const r of replaced) db.query(SQL.supersede).run({ id: r });
        const root = msgs.find((m) => m.id === thread);
        const body = `Fixed in ${made.short}.`;
        const paths = [...new Set(edits.filter((e) => e.thread === thread).map((e) => e.path))];
        // The commit proposes to resolve the thread. Only a thread that the user started gets the tick by default.
        const payload: ReplyPayload = {
          thread,
          action: "reply",
          body,
          reason: "The app committed the fix.",
          evidenceStatus: "code",
          judgement: null,
          replyTo: last.id,
          fix: { id, commit: made.commit, ...(replaced.length > 0 && { replaced }) },
          resolve: true,
          resolveEvidence: `Commit ${made.short} changes ${paths.join(", ")}.`,
          resolveTick: !!root && isMe({ slug: root.authorSlug, login: root.authorLogin }, me),
          threadOpen: !msgs.some((m) => m.threadResolved),
          origin: "fix",
        };
        db.query(SQL.item).run({ run: run.run, payload: JSON.stringify(payload), body, thread });
      }
    })();
  }

  async function intoClone(db: Database, run: RunRow, clone: string, edits: EditRow[], key: string, ids: number[], input: FixCommitInput) {
    const forge = await settings.provider().catch(() => null);
    if (!forge) return { status: 409, body: unconfigured } satisfies Out;
    let live: PullRequest;
    try {
      live = await forge.getPullRequest({ project: run.project, repo: run.repo, id: run.pr_id });
    } catch {
      return { status: 502, body: { error: "Could not read the pull request on Bitbucket." } } satisfies Out;
    }
    const state = await checkClone(clone, { branch: live.sourceBranch, base: run.source, live: live.sourceHead });
    if (state.problems.length || !state.head) return conflict("The clone is not ready for the fix.", state.problems);
    const hooks = await hooksFolder(clone);
    const cache = cacheOf(run);
    const patch = await locked(cache, () => buildPatch(cache, env(), run.source, edits, hooks));
    if ("error" in patch) return conflict(patch.error);
    if (!(await applyCheck(clone, patch.patch))) return conflict(CLONE_TEXT.patch, [cloneProblem("patch")]);
    const id = insert(db, run, key, ids, input, { clone, branch: state.branch, before: state.head });
    try {
      await applyIndex(clone, patch.patch);
    } catch {
      db.query(SQL.remove).run({ id });
      return conflict(CLONE_TEXT.patch, [cloneProblem("patch")]);
    }
    let made: { commit: string; short: string };
    try {
      made = await commitIndex(clone, input.message);
      if (made.commit === state.head) throw new GitError("git commit made no commit.");
    } catch (e) {
      return conflict(
        `The commit failed. The edits stay staged. Fix the problem, then commit in your clone, or Undo. ${(e as Error).message}`,
      );
    }
    finish(db, run, id, edits, made);
    return { status: 201, dto: dtoOf(db, id) } satisfies Out;
  }

  // Runs under the cache lock.
  async function intoCache(
    db: Database,
    run: RunRow,
    clone: string | null,
    edits: EditRow[],
    key: string,
    ids: number[],
    input: FixCommitInput,
  ) {
    const cache = cacheOf(run);
    const patch = await buildPatch(cache, env(), run.source, edits);
    if ("error" in patch) return conflict(patch.error);
    const who = await identity(clone);
    if (!who) return conflict(CLONE_TEXT.identity, [cloneProblem("identity")]);
    const id = insert(db, run, key, ids, input, { clone: null, branch: null, before: run.source });
    try {
      const made = await cacheCommit(cache, env(), { base: run.source, tree: patch.tree }, input.message, who);
      await git([`--git-dir=${cache}`, "update-ref", fixRef(run.pr_id, id), made.commit, ""], { env: env() });
      finish(db, run, id, edits, made);
    } catch (e) {
      db.query(SQL.remove).run({ id });
      return conflict((e as Error).message);
    }
    return { status: 201, dto: dtoOf(db, id) } satisfies Out;
  }

  async function commit(db: Database, runId: number, input: FixCommitInput): Promise<Out> {
    const run = db.query(SQL.run).get({ id: runId }) as RunRow | null;
    if (run?.kind !== "fix") return { status: 404, body: notFound("Fix run") };
    const ids = [...new Set(input.edits)].sort((a, b) => a - b);
    const edits = (db.query(SQL.edits).all({ run: runId }) as EditRow[]).filter((e) => ids.includes(e.id));
    if (edits.length !== ids.length) return { status: 404, body: notFound("Fix edit") };
    const key = `${runId}:${input.mode}:${ids.join(",")}`;
    const clone = cloneOf(db, run);
    if (input.mode === "clone" && clone === null) return conflict(CLONE_TEXT.not_set, [cloneProblem("not_set")]);
    // Plan r3: apply, commit, and undo run under a per-clone lock, not in the run slot.
    return locked(input.mode === "clone" ? `clone:${clone}` : cacheOf(run), async (): Promise<Out> => {
      const done = db.query(SQL.byKey).get({ key }) as { id: number } | null;
      if (done) return { status: 200, dto: dtoOf(db, done.id) };
      return clone !== null && input.mode === "clone"
        ? intoClone(db, run, clone, edits, key, ids, input)
        : intoCache(db, run, clone, edits, key, ids, input);
    });
  }

  // A committed clone fix: HEAD still at the commit on its branch and a clean tree. Returns the refusal text.
  async function undoCommitted(r: CommitRow): Promise<string | null> {
    const path = r.clone_path as string;
    const state = await checkClone(path, { branch: r.branch ?? "" });
    const block = state.problems.find((p) => UNDO_BLOCKS.includes(p.kind));
    if (block) return block.text;
    if (state.head !== r.commit_hash) return "The clone HEAD moved since the fix commit. Undo it in your clone.";
    await resetKeep(path, r.before_head);
    return null;
  }

  // A staged clone fix: HEAD at the head before, and the index holds exactly the patch. Reverse-applies the patch.
  async function undoStaged(db: Database, r: CommitRow): Promise<string | null> {
    const path = r.clone_path as string;
    const run = db.query(SQL.run).get({ id: r.run }) as RunRow;
    const ids = JSON.parse(r.edits_json) as number[];
    const edits = (db.query(SQL.edits).all({ run: r.run }) as EditRow[]).filter((e) => ids.includes(e.id));
    const cache = cacheOf(r);
    const patch = await locked(cache, () => buildPatch(cache, env(), run.source, edits));
    if ("error" in patch) return patch.error;
    const state = await checkClone(path, { branch: r.branch ?? "" });
    const block = state.problems.find((p) => p.kind === "missing" || p.kind === "not_repo");
    if (block) return block.text;
    const differ = "The staged changes differ from the fix. Undo them in your clone.";
    if (state.head !== r.before_head) return differ;
    const staged = await stagedPaths(path);
    const want = await treeEntries(cache, env(), patch.tree, patch.paths);
    const have = await indexEntries(path, patch.paths);
    if (staged.length !== patch.paths.length || patch.paths.some((p) => !staged.includes(p) || have.get(p) !== want.get(p))) return differ;
    if (!(await applyCheck(path, patch.patch, true))) return differ;
    await applyIndex(path, patch.patch, true);
    return null;
  }

  async function undo(db: Database, id: number): Promise<Out> {
    const first = commitRow(db, id);
    if (!first) return { status: 404, body: notFound("Fix commit") };
    const cache = cacheOf(first);
    return locked(first.mode === "clone" ? `clone:${first.clone_path}` : cache, async (): Promise<Out> => {
      const r = commitRow(db, id) as CommitRow;
      if (r.state === "undone") return { status: 200, dto: toFixCommitDto(r, cache) };
      if (r.commit_hash && db.query(SQL.pushed).get({ pr: r.pr, hash: r.commit_hash }))
        return conflict("The commit is on the pull request already. Revert it in your clone.");
      if (r.mode === "cache") await git([`--git-dir=${cache}`, "update-ref", "-d", fixRef(r.pr_id, r.id)], { env: env() }).catch(() => "");
      else {
        const why = r.state === "committed" ? await undoCommitted(r) : await undoStaged(db, r);
        if (why) return conflict(why);
      }
      db.transaction(() => {
        db.query(SQL.undone).run({ id, now: Date.now() });
        const drafts = db.query(SQL.fixDrafts).all({ id }) as { thread: number; payload_json: string }[];
        db.query(SQL.discard).run({ id });
        // The drafts that the commit replaced come back. One open draft per thread: only the newest, and only into a thread without one.
        for (const d of drafts) {
          const replaced = (JSON.parse(d.payload_json) as ReplyPayload).fix?.replaced ?? [];
          if (replaced.length && !db.query(SQL.openDraft).get({ pr: r.pr, thread: d.thread }))
            db.query(SQL.bringBack).run({ id: Math.max(...replaced) });
        }
        db.query(SQL.unfixed).run({ id });
      })();
      return { status: 200, dto: dtoOf(db, id) };
    });
  }

  // A git failure in the clone is a conflict with its stderr tail, not a server error.
  const guarded = async (f: () => Promise<Out>): Promise<Out> => {
    try {
      return await f();
    } catch (e) {
      if (e instanceof GitError) return conflict(e.message);
      throw e;
    }
  };

  return new Hono()
    .get("/prs/:id/clone", prParam, async (c) => {
      const db = review.open();
      if (!db) return c.json(unconfigured, 409);
      const pr = prRow(db, c.req.valid("param").id);
      if (!pr) return c.json(notFound("Pull request"), 404);
      c.header("Cache-Control", "no-store");
      try {
        return c.json(await cloneState(db, pr), 200);
      } catch (e) {
        if (e instanceof GitError) return c.json<ApiError>({ error: e.message }, 409);
        throw e;
      }
    })
    .put(
      "/prs/:id/clone",
      prParam,
      validator("json", (v, c) => {
        const r = cloneInput.safeParse(v);
        return r.success ? r.data : c.json<ApiError>({ error: "Invalid clone path." }, 400);
      }),
      async (c) => {
        const db = review.open();
        if (!db) return c.json(unconfigured, 409);
        const pr = prRow(db, c.req.valid("param").id);
        if (!pr) return c.json(notFound("Pull request"), 404);
        const r = await clonePath(c.req.valid("json").path, review.dataDir);
        if ("error" in r) return c.json<ApiError>({ error: r.error }, 400);
        db.query(SQL.saveClone).run({ project: pr.project, repo: pr.repo, path: r.path, now: Date.now() });
        try {
          return c.json(await cloneState(db, pr), 200);
        } catch (e) {
          if (e instanceof GitError) return c.json<ApiError>({ error: e.message }, 409);
          throw e;
        }
      },
    )
    .delete("/prs/:id/clone", prParam, (c) => {
      const db = review.open();
      if (!db) return c.json(unconfigured, 409);
      const pr = prRow(db, c.req.valid("param").id);
      if (!pr) return c.json(notFound("Pull request"), 404);
      db.query(SQL.dropClone).run({ project: pr.project, repo: pr.repo });
      return c.body(null, 204);
    })
    .post("/prs/:id/clone/open-folder", prParam, async (c) => {
      // The path comes from the stored clone row only. 501: no file manager. The client then offers Copy.
      const db = review.open();
      if (!db) return c.json(unconfigured, 409);
      const pr = prRow(db, c.req.valid("param").id);
      if (!pr) return c.json(notFound("Pull request"), 404);
      const path = cloneOf(db, pr);
      if (path === null) return c.json<ApiError>({ error: CLONE_TEXT.not_set }, 404);
      if (!existsSync(path)) return c.json<ApiError>({ error: CLONE_TEXT.missing }, 409);
      if (!(await opener(path))) return c.json({ error: "No file manager opened the folder. Copy the path.", path }, 501);
      return c.body(null, 204);
    })
    .get("/instructions", (c) => {
      const db = review.open();
      if (!db) return c.json(unconfigured, 409);
      const rows = db.query(SQL.repos).all() as Omit<InstructionRepoDto, "settings">[];
      c.header("Cache-Control", "no-store");
      return c.json(
        rows.map((r): InstructionRepoDto => ({ ...r, settings: instructionSettings(db, r) })),
        200,
      );
    })
    .get("/instructions/global", (c) => {
      c.header("Cache-Control", "no-store");
      return c.json<GlobalInstructionsDto>({ on: settings.globalInstructions(), path: join(review.configDir(), GLOBAL_FILE) }, 200);
    })
    .put(
      "/instructions/global",
      validator("json", (v, c) => {
        const r = globalInstructionsInput.safeParse(v);
        return r.success ? r.data : c.json<ApiError>({ error: "Invalid global instructions switch." }, 400);
      }),
      async (c) => {
        if (!(await settings.saveGlobalInstructions(c.req.valid("json").on))) return c.json(unconfigured, 409);
        return c.json<GlobalInstructionsDto>({ on: settings.globalInstructions(), path: join(review.configDir(), GLOBAL_FILE) }, 200);
      },
    )
    .put(
      "/prs/:id/instructions",
      prParam,
      validator("json", (v, c) => {
        const r = instructionsInput.safeParse(v);
        return r.success ? r.data : c.json<ApiError>({ error: "Invalid project instructions." }, 400);
      }),
      (c) => {
        const db = review.open();
        if (!db) return c.json(unconfigured, 409);
        const pr = prRow(db, c.req.valid("param").id);
        if (!pr) return c.json(notFound("Pull request"), 404);
        saveInstructionSettings(db, pr, c.req.valid("json"));
        return c.json<InstructionsInput>(instructionSettings(db, pr), 200);
      },
    )
    .get("/prs/:id/instructions/preview", prParam, async (c) => {
      // Reads the sources as a run does, with no network. The target branch comes from the cache, at the synced target head.
      const db = review.open();
      if (!db) return c.json(unconfigured, 409);
      const pr = prRow(db, c.req.valid("param").id);
      if (!pr) return c.json(notFound("Pull request"), 404);
      const cache = cacheOf(pr);
      const cached = pr.target_head !== null && existsSync(cache);
      const b = await projectInstructions(
        db,
        pr,
        cached ? { cache, env: env(), commit: pr.target_head as string } : null,
        settings.globalInstructions() ? review.configDir() : null,
      );
      const isFile = (p: string) => {
        try {
          return statSync(p).isFile();
        } catch {
          return false;
        }
      };
      const found = b.clone ? CLONE_INSTRUCTION_FILES.filter((f) => isFile(join(b.clone as string, f))) : [];
      c.header("Cache-Control", "no-store");
      return c.json<InstructionPreviewDto>(
        {
          readAt: Date.now(),
          found,
          target: !b.settings.target ? "off" : cached ? "read" : "no-cache",
          files: b.files,
          bytes: b.bytes,
          text: b.text,
          notLoaded: b.notLoaded,
        },
        200,
      );
    })
    .get("/clones", (c) => {
      const db = review.open();
      if (!db) return c.json(unconfigured, 409);
      const rows = db.query(SQL.clones).all() as Omit<CloneRowDto, "missing">[];
      c.header("Cache-Control", "no-store");
      return c.json(
        rows.map((r): CloneRowDto => ({ ...r, missing: !existsSync(r.path) })),
        200,
      );
    })
    .post(
      "/fix-runs/:id/commit",
      runParam,
      validator("json", (v, c) => {
        const r = fixCommitInput.safeParse(v);
        return r.success ? r.data : c.json<ApiError>({ error: "Invalid fix commit." }, 400);
      }),
      async (c) => {
        const db = review.open();
        if (!db) return c.json(unconfigured, 409);
        const r = await guarded(() => commit(db, c.req.valid("param").id, c.req.valid("json")));
        if ("dto" in r) {
          changed(db, r.dto);
          return r.status === 201 ? c.json(r.dto, 201) : c.json(r.dto, 200);
        }
        if (r.status === 404) return c.json(r.body, 404);
        return r.status === 502 ? c.json(r.body, 502) : c.json(r.body, 409);
      },
    )
    .post("/fix-commits/:id/undo", commitParam, async (c) => {
      const db = review.open();
      if (!db) return c.json(unconfigured, 409);
      const r = await guarded(() => undo(db, c.req.valid("param").id));
      if ("dto" in r) {
        changed(db, r.dto);
        return c.json(r.dto, 200);
      }
      if (r.status === 404) return c.json(r.body, 404);
      return r.status === 502 ? c.json(r.body, 502) : c.json(r.body, 409);
    });
}
