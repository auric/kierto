// Polling sync (plan G4): dashboard, PR states, comments, delete checks, events. One cycle at a time.
import type { CheckpointReason, SyncState, SyncStatus } from "../../shared/dto";
import { isMe } from "../../shared/me";
import type { ForgeErrorInfo, IncompleteReason, PrRef, PullRequest } from "../../shared/types";
import { ForgeError } from "../bitbucket/client";
import type { ForgeProvider } from "../bitbucket/provider";
import type { Live } from "../live";
import { log } from "../log";
import type { Settings } from "../settings";
import { type NewEvent, nextDelay, parseRetryAfter, prEvents, reconcile, roleOf, type StoredComment } from "./reconcile";

const DIGEST_GAP_MS = 120_000;
const NETWORK = new Set(["network", "timeout"]);

export type Timers = { set(fn: () => unknown, ms: number): unknown; clear(handle: unknown): void };

type Params = Record<string, string | number | null>;
type PrKey = { id: number; project: string; repo: string; pr_id: number };
type Outcome = { state: SyncState; error?: string; pause?: boolean; retryAfterMs?: number };
type Tally = { startedAt: number; changed: Set<number>; events: number };

class Cancelled extends Error {}
class Unauthorized extends Error {}

const SQL = {
  forget: "UPDATE pull_request SET initialized_at = NULL WHERE initialized_at IS NOT NULL AND (followed = 0 OR archived_at IS NOT NULL)",
  polled: "SELECT id, project, repo, pr_id FROM pull_request WHERE followed = 1 AND archived_at IS NULL ORDER BY id",
  away: "SELECT id, project, repo, pr_id FROM pull_request WHERE followed = 1 AND archived_at IS NULL AND on_dashboard = 0 ORDER BY id",
  prBefore:
    "SELECT id, my_role, source_head, initialized_at, followed, archived_at FROM pull_request WHERE project = $project AND repo = $repo AND pr_id = $pr_id",
  prUpsert: `INSERT INTO pull_request (project, repo, pr_id, title, description, author_slug, author_name, my_role, my_status, last_reviewed_commit,
      state, pr_version, source_head, target_head, source_branch, target_branch, web_url, updated_date, on_dashboard, reviewers_json)
    VALUES ($project, $repo, $pr_id, $title, $description, $author_slug, $author_name, $my_role, $my_status, $last_reviewed_commit,
      $state, $pr_version, $source_head, $target_head, $source_branch, $target_branch, $web_url, $updated_date, $on_dashboard, $reviewers_json)
    ON CONFLICT (project, repo, pr_id) DO UPDATE SET title = excluded.title, description = excluded.description,
      author_slug = excluded.author_slug, author_name = excluded.author_name, my_role = excluded.my_role, my_status = excluded.my_status,
      last_reviewed_commit = excluded.last_reviewed_commit, state = excluded.state, pr_version = excluded.pr_version,
      source_head = excluded.source_head, target_head = excluded.target_head, source_branch = excluded.source_branch,
      target_branch = excluded.target_branch, web_url = excluded.web_url, updated_date = excluded.updated_date, on_dashboard = excluded.on_dashboard,
      reviewers_json = excluded.reviewers_json
    RETURNING id`,
  offDashboard:
    "UPDATE pull_request SET on_dashboard = 0 WHERE on_dashboard = 1 AND id NOT IN (SELECT value FROM json_each($ids)) RETURNING id",
  prState: "SELECT my_role, initialized_at FROM pull_request WHERE id = $id",
  watched: "SELECT id FROM pull_request WHERE id = $id AND followed = 1 AND archived_at IS NULL",
  stored:
    "SELECT comment_id AS id, root_id AS rootId, author_slug AS author, author_login AS login, tombstoned_at IS NULL AS live FROM comment WHERE pr = $pr",
  // A3: a lower or equal version never overwrites. ack_version stays unless this write acknowledges the new version. commentMeta writes the anchor and the resolved flag.
  commentUpsert: `INSERT INTO comment (pr, comment_id, version, parent_id, root_id, author_slug, author_name, author_login, text, anchor_json,
      thread_resolved, created_at, updated_at, ack_version)
    VALUES ($pr, $comment_id, $version, $parent_id, $root_id, $author_slug, $author_name, $author_login, $text, $anchor_json,
      $thread_resolved, $created_at, $updated_at, $ack_version)
    ON CONFLICT (pr, comment_id) DO UPDATE SET version = excluded.version, parent_id = excluded.parent_id, root_id = excluded.root_id,
      author_slug = excluded.author_slug, author_name = excluded.author_name, author_login = excluded.author_login, text = excluded.text, updated_at = excluded.updated_at,
      ack_version = COALESCE(excluded.ack_version, comment.ack_version)
    WHERE excluded.version > comment.version`,
  // Bitbucket can change orphaned and threadResolved without a new version. The stored row with the highest version wins; at an equal version, the latest complete fetch wins.
  commentMeta: `UPDATE comment SET anchor_json = $anchor_json, thread_resolved = $thread_resolved
    WHERE pr = $pr AND comment_id = $comment_id AND version <= $version AND (anchor_json IS NOT $anchor_json OR thread_resolved IS NOT $thread_resolved)`,
  tombstone: "UPDATE comment SET tombstoned_at = $now WHERE pr = $pr AND comment_id = $id AND tombstoned_at IS NULL",
  initialized: "UPDATE pull_request SET initialized_at = COALESCE(initialized_at, $now) WHERE id = $id",
  event: "INSERT INTO event (pr, kind, ref, created_at, digest) VALUES ($pr, $kind, $ref, $now, $digest) ON CONFLICT DO NOTHING",
  lastComplete: "SELECT last_complete_at FROM sync_checkpoint WHERE scope = $scope",
  checkpointDone: `INSERT INTO sync_checkpoint (scope, last_complete_at, incomplete_reason, last_error, updated_at) VALUES ($scope, $now, $reason, $error, $now)
    ON CONFLICT (scope) DO UPDATE SET last_complete_at = excluded.last_complete_at, incomplete_reason = excluded.incomplete_reason,
      last_error = excluded.last_error, updated_at = excluded.updated_at`,
  // An incomplete fetch keeps last_complete_at.
  checkpointFail: `INSERT INTO sync_checkpoint (scope, incomplete_reason, last_error, updated_at) VALUES ($scope, $reason, $error, $now)
    ON CONFLICT (scope) DO UPDATE SET incomplete_reason = excluded.incomplete_reason, last_error = excluded.last_error, updated_at = excluded.updated_at`,
};

const refOf = (row: PrKey): PrRef => ({ project: row.project, repo: row.repo, id: row.pr_id });

export function createSyncEngine(opts: { settings: Settings; live: Live; now?: () => number; random?: () => number; timers?: Timers }) {
  const { settings, live } = opts;
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const timers: Timers = opts.timers ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };

  // A settings change bumps the generation. A cycle of an older generation must not touch the database again.
  let generation = 0;
  let started = false;
  let timer: unknown = null;
  let running: Promise<void> | null = null;
  let rerun: Promise<void> | null = null;
  // One provider, so its 2-slot semaphore covers every sync request.
  let provider: ForgeProvider | null = null;
  let failures = 0;
  const status: Omit<SyncStatus, "running"> = { state: "idle", lastCompleteAt: null, nextAt: null, error: null };

  async function cycle(gen: number, tally: Tally): Promise<Outcome> {
    const config = settings.config();
    const db = settings.db();
    if (!config || !db) return { state: "unconfigured", pause: true };
    if (!provider) {
      let built: ForgeProvider | null;
      try {
        built = await settings.provider();
      } catch (e) {
        // settings.provider() throws an fs error with a code for the CA file, and a plain Error for the URL.
        const code = (e as { code?: unknown }).code;
        return { state: "error", error: code ? `Cannot read the CA file (${code}).` : (e as Error).message, pause: true };
      }
      // A provider built from replaced settings must not reach the next cycle.
      if (gen !== generation) throw new Cancelled();
      if (!built) return { state: "unconfigured", pause: true };
      provider = built;
    }
    const forge = provider;
    const me = config.userSlug;
    const digest = status.lastCompleteAt === null || tally.startedAt - status.lastCompleteAt > DIGEST_GAP_MS ? 1 : 0;
    const problems: { kind: string; retryAfter?: string }[] = [];
    let reached = false;
    let broken: string | null = null;

    // bun:sqlite transactions are synchronous, so no settings change can run between this check and the commit.
    const tx = <T>(fn: () => T): T => {
      if (gen !== generation) throw new Cancelled();
      return db.transaction(fn)();
    };
    const run = (sql: string, params: Params) => db.query(sql).run(params);

    // Records a failed call and returns its message. A 401 ends the cycle.
    const failed = (kind: string, err?: ForgeErrorInfo): string => {
      if (kind === "auth") throw new Unauthorized();
      if (!NETWORK.has(kind)) reached = true;
      problems.push({ kind, retryAfter: err?.retryAfter });
      return err?.message ?? kind;
    };
    const checkpoint = (scope: string, done: boolean, reason: CheckpointReason | null, error: string | null) =>
      run(done ? SQL.checkpointDone : SQL.checkpointFail, { scope, reason, error, now: now() });
    const addEvents = (pr: number, list: NewEvent[]) => {
      let added = 0;
      for (const e of list) added += run(SQL.event, { pr, kind: e.kind, ref: e.ref, now: now(), digest }).changes;
      return added;
    };
    const savePr = (pr: PullRequest, onDashboard: boolean, dashboardSeen: boolean) => {
      const key = { project: pr.ref.project, repo: pr.ref.repo, pr_id: pr.ref.id };
      const row = db.query(SQL.prBefore).get(key) as {
        id: number;
        my_role: string | null;
        source_head: string | null;
        initialized_at: number | null;
        followed: number;
        archived_at: number | null;
      } | null;
      const mine = pr.reviewers.find((r) => isMe(r, me));
      const { id } = db.query(SQL.prUpsert).get({
        ...key,
        title: pr.title,
        description: pr.description ?? null,
        author_slug: pr.author.slug,
        author_name: pr.author.name,
        my_role: roleOf(pr, me),
        my_status: mine?.status ?? null,
        last_reviewed_commit: mine?.lastReviewedCommit ?? null,
        state: pr.state,
        pr_version: pr.version,
        source_head: pr.sourceHead,
        target_head: pr.targetHead,
        source_branch: pr.sourceBranch,
        target_branch: pr.targetBranch,
        web_url: pr.webUrl ?? null,
        updated_date: pr.updatedDate,
        on_dashboard: onDashboard ? 1 : 0,
        reviewers_json: JSON.stringify(
          pr.reviewers.map((r) => ({
            slug: r.slug,
            name: r.name,
            login: r.login,
            status: r.status,
            lastReviewedCommit: r.lastReviewedCommit,
          })),
        ),
      }) as { id: number };
      const before = row && {
        role: row.my_role,
        sourceHead: row.source_head,
        initialized: row.initialized_at !== null,
        watched: row.followed === 1 && row.archived_at === null,
      };
      return { id, events: addEvents(id, prEvents(before, pr, me, dashboardSeen)) };
    };

    // Archive and unfollow stop polling, so a later follow must import the missed history silently.
    tx(() => run(SQL.forget, {}));

    // Step 1: the dashboard. Its transaction also writes commits_pushed and reviewer_added.
    const lists = await Promise.all([forge.listDashboard("REVIEWER"), forge.listDashboard("AUTHOR")]);
    let dashboardDone = false;
    let incomplete: { reason: IncompleteReason; message: string } | null = null;
    for (const l of lists) {
      if (l.complete) {
        reached = true;
        continue;
      }
      const message = failed(l.reason, l.error);
      incomplete ??= { reason: l.reason, message };
    }
    if (incomplete) {
      const { reason, message } = incomplete;
      tx(() => checkpoint("dashboard", false, reason, message));
      // The PR calls go to the same unreachable host. Each would wait up to 30 s before it fails.
      if (NETWORK.has(reason)) return outcome();
    } else {
      const items = lists.flatMap((l) => l.items);
      const written = tx(() => {
        const seen =
          (db.query(SQL.lastComplete).get({ scope: "dashboard" }) as { last_complete_at: number | null } | null)?.last_complete_at != null;
        const ids: number[] = [];
        let events = 0;
        for (const pr of items) {
          const r = savePr(pr, true, seen);
          ids.push(r.id);
          events += r.events;
        }
        for (const r of db.query(SQL.offDashboard).all({ ids: JSON.stringify(ids) }) as { id: number }[]) ids.push(r.id);
        checkpoint("dashboard", true, null, null);
        return { ids, events };
      });
      for (const id of written.ids) tally.changed.add(id);
      tally.events += written.events;
      dashboardDone = true;
    }

    // Step 2: followed PRs off the dashboard get the single-PR GET, for MERGED, DECLINED, and the current role.
    const skip = new Set<number>();
    if (dashboardDone) {
      for (const row of tx(() => db.query(SQL.away).all({}) as PrKey[])) {
        if (gen !== generation) throw new Cancelled();
        try {
          const pr = await forge.getPullRequest(refOf(row));
          reached = true;
          // The stored key wins, so the update always hits this row.
          const r = tx(() => savePr({ ...pr, ref: refOf(row) }, false, false));
          tally.changed.add(r.id);
          tally.events += r.events;
        } catch (e) {
          if (!(e instanceof ForgeError)) throw e;
          const message = failed(e.kind, e);
          skip.add(row.id);
          tx(() => checkpoint(`pr:${row.id}`, false, e.kind, message));
          tally.changed.add(row.id);
        }
      }
    }

    const syncPr = async (row: PrKey) => {
      const scope = `pr:${row.id}`;
      const ref = refOf(row);
      if (gen !== generation) throw new Cancelled();
      const r = await forge.listComments(ref);
      if (!r.complete) {
        const message = failed(r.reason, r.error);
        tx(() => checkpoint(scope, false, r.reason, message));
        tally.changed.add(row.id);
        return;
      }
      reached = true;
      // Only this engine writes my_role, initialized_at, and comment rows, and cycles never overlap. Follow state is checked again at commit.
      const { pr, stored } = tx(() => ({
        pr: db.query(SQL.prState).get({ id: row.id }) as { my_role: string | null; initialized_at: number | null },
        stored: (db.query(SQL.stored).all({ pr: row.id }) as (Omit<StoredComment, "live"> & { live: number })[]).map((s) => ({
          ...s,
          live: s.live === 1,
        })),
      }));
      const plan = reconcile({ stored, fetched: r.items, me, initialized: pr.initialized_at !== null, role: pr.my_role });

      // Step 4: a delete needs absence from a complete fetch plus a 404.
      const deleted: number[] = [];
      const gaps: number[] = [];
      let unsure: { reason: CheckpointReason; message: string } | null = null;
      for (const id of plan.candidates) {
        if (gen !== generation) throw new Cancelled();
        try {
          ((await forge.commentStatus(ref, id)) === "deleted" ? deleted : gaps).push(id);
          reached = true;
        } catch (e) {
          if (!(e instanceof ForgeError)) throw e;
          unsure = { reason: e.kind, message: failed(e.kind, e) };
        }
      }
      const reason = gaps.length ? "gap" : (unsure?.reason ?? null);
      const error = gaps.length ? `Present on Bitbucket but missing from the activities: ${gaps.join(", ")}` : (unsure?.message ?? null);

      // Step 5: one transaction per PR.
      const events = tx(() => {
        if (!db.query(SQL.watched).get({ id: row.id })) return null;
        const t = now();
        for (const c of plan.rows) {
          const anchor = c.anchor === undefined ? null : JSON.stringify(c.anchor);
          const resolved = c.threadResolved ? 1 : 0;
          run(SQL.commentUpsert, {
            pr: row.id,
            comment_id: c.id,
            version: c.version,
            parent_id: c.parentId,
            root_id: c.rootId,
            author_slug: c.author.slug,
            author_name: c.author.name,
            author_login: c.author.login,
            text: c.text,
            anchor_json: anchor,
            thread_resolved: resolved,
            created_at: c.createdAt,
            updated_at: c.updatedAt,
            ack_version: c.ackVersion,
          });
          run(SQL.commentMeta, { pr: row.id, comment_id: c.id, version: c.version, anchor_json: anchor, thread_resolved: resolved });
        }
        for (const id of deleted) run(SQL.tombstone, { pr: row.id, id, now: t });
        const added = addEvents(
          row.id,
          plan.newCommentIds.map((id) => ({ kind: "comment_new", ref: String(id) })),
        );
        run(SQL.initialized, { id: row.id, now: t });
        checkpoint(scope, true, reason, error);
        return added;
      });
      if (events === null) return;
      tally.changed.add(row.id);
      tally.events += events;
    };

    // Steps 3 to 5 for each followed, non-archived PR.
    // ponytail: one PR at a time; run two workers if the cycle time grows too long (plan R1).
    for (const row of tx(() => db.query(SQL.polled).all({}) as PrKey[])) {
      if (skip.has(row.id)) continue;
      try {
        await syncPr(row);
      } catch (e) {
        if (e instanceof Cancelled || e instanceof Unauthorized) throw e;
        broken = (e as Error).message;
        log(`Sync error on PR ${row.project}/${row.repo}/${row.pr_id}: ${broken}`);
      }
    }
    return outcome();

    function outcome(): Outcome {
      const waits = problems.map((p) => parseRetryAfter(p.retryAfter)).filter((ms) => ms !== undefined);
      const retryAfterMs = waits.length ? Math.max(...waits) : undefined;
      if (broken) return { state: "error", error: broken, retryAfterMs };
      if (problems.length && !reached) return { state: "offline", error: `No answer from Bitbucket (${problems[0]?.kind}).`, retryAfterMs };
      return { state: "ok", retryAfterMs };
    }
  }

  async function runCycle(gen: number): Promise<void> {
    status.nextAt = null;
    const tally: Tally = { startedAt: now(), changed: new Set(), events: 0 };
    let out: Outcome;
    try {
      out = await cycle(gen, tally);
    } catch (e) {
      if (e instanceof Cancelled || gen !== generation) return;
      out =
        e instanceof Unauthorized
          ? { state: "auth", error: "Bitbucket rejected the token.", pause: true }
          : { state: "error", error: (e as Error).message };
    }
    if (gen !== generation) return;
    // Step 6: everything below runs after the commits.
    live.broadcast("changed", { prs: [...tally.changed] });
    if (tally.events) live.broadcast("events", { count: tally.events });
    if (out.state !== "ok" && (out.state !== status.state || out.error !== status.error))
      log(`Sync ${out.state}${out.error ? `: ${out.error}` : ""}`);
    if (out.state === "offline") failures++;
    else if (out.state === "ok") {
      failures = 0;
      status.lastCompleteAt = tally.startedAt;
    }
    status.state = out.state;
    status.error = out.error ?? null;
    if (started && !out.pause) schedule(out.retryAfterMs ?? nextDelay(failures, random));
  }

  function clearTimer() {
    if (timer !== null) timers.clear(timer);
    timer = null;
  }

  function schedule(ms: number) {
    clearTimer();
    status.nextAt = now() + ms;
    timer = timers.set(launch, ms);
  }

  function launch(): Promise<void> {
    clearTimer();
    const p: Promise<void> = runCycle(generation).finally(() => {
      if (running === p) running = null;
    });
    running = p;
    return p;
  }

  function stop() {
    started = false;
    generation++;
    clearTimer();
    running = null;
    rerun = null;
    status.nextAt = null;
  }

  function start() {
    if (started) return;
    started = true;
    schedule(0);
  }

  // Runs synchronously inside the settings PUT, before the old database closes.
  settings.onSettingsChanged(() => {
    const was = started;
    stop();
    provider = null;
    failures = 0;
    if (was) start();
  });

  return {
    // The first cycle runs at once, then a setTimeout chain with no overlap.
    start,
    stop,
    // Starts a cycle now, or one more cycle after the running one. Resolves when that cycle ends. Never rejects.
    syncNow(): Promise<void> {
      if (rerun) return rerun;
      if (!running) return launch();
      const gen = generation;
      const r: Promise<void> = running.then(() => {
        if (rerun === r) rerun = null;
        if (gen === generation) return launch();
      });
      rerun = r;
      return r;
    },
    status: (): SyncStatus => ({ ...status, running: running !== null }),
  };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;
