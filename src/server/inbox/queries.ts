// Inbox reads and writes (plan G5). Unread: followed, not tombstoned (D8), and ack_version IS NULL OR ack_version < version.
import type { Database } from "bun:sqlite";
import type { CheckpointDto, CheckpointReason, ClaimedEvent, CommentDto, FollowState, PrDetail, PrRow, Reason } from "../../shared/dto";
import type { Reviewer, Role } from "../../shared/types";
import { byInbox } from "../../shared/views";

const CLAIMED_TTL_MS = 30 * 86_400_000;
const UNREAD = "c.pr = p.id AND p.followed = 1 AND c.tombstoned_at IS NULL AND (c.ack_version IS NULL OR c.ack_version < c.version)";

const SQL = {
  rows: `SELECT p.id, p.project, p.repo, p.pr_id, p.title, p.author_slug, p.author_name, p.my_role, p.state, p.my_status, p.last_reviewed_commit,
      p.source_head, p.source_branch, p.target_branch, p.web_url, p.on_dashboard, p.followed, p.reviewers_json,
      (SELECT COUNT(*) FROM comment c WHERE ${UNREAD}) AS unread,
      EXISTS (SELECT 1 FROM comment c WHERE ${UNREAD}
        AND EXISTS (SELECT 1 FROM comment m WHERE m.pr = c.pr AND m.root_id = c.root_id AND (lower(m.author_slug) = lower($me) OR lower(m.author_login) = lower($me)))) AS reply,
      MAX(COALESCE(p.updated_date, 0), COALESCE((SELECT MAX(c.updated_at) FROM comment c WHERE c.pr = p.id), 0)) AS last_activity,
      k.scope IS NOT NULL AS has_checkpoint, k.last_complete_at, k.incomplete_reason, k.last_error
    FROM pull_request p LEFT JOIN sync_checkpoint k ON k.scope = 'pr:' || p.id
    WHERE p.archived_at IS NULL AND (p.followed = 1 OR p.on_dashboard = 1) AND ($id IS NULL OR p.id = $id)`,
  comments: `SELECT comment_id, version, parent_id, root_id, author_slug, author_name, text, anchor_json, thread_resolved, created_at, updated_at,
      ack_version, tombstoned_at FROM comment WHERE pr = $pr ORDER BY created_at, comment_id`,
  // A2: the ack never rises above the stored version, and never falls.
  read: `UPDATE comment SET ack_version = MIN(version, $version)
    WHERE pr = $pr AND comment_id = $id AND (ack_version IS NULL OR ack_version < MIN(version, $version))`,
  follow: "UPDATE pull_request SET followed = $followed, archived_at = IIF($followed = 1, NULL, archived_at) WHERE id = $id",
  archive: "UPDATE pull_request SET archived_at = IIF($archived = 1, COALESCE(archived_at, $now), NULL) WHERE id = $id",
  followState: "SELECT id, followed, archived_at FROM pull_request WHERE id = $id",
  followKey: `INSERT INTO pull_request (project, repo, pr_id, followed, archived_at, initialized_at) VALUES ($project, $repo, $pr_id, 1, NULL, NULL)
    ON CONFLICT (project, repo, pr_id) DO UPDATE SET followed = 1, archived_at = NULL RETURNING id`,
  // One statement, so two concurrent claims never return the same event.
  claim: `UPDATE event SET claimed_at = $now WHERE claimed_at IS NULL
    RETURNING id, pr, kind, ref, created_at, digest,
      (SELECT project FROM pull_request WHERE id = event.pr) AS project, (SELECT repo FROM pull_request WHERE id = event.pr) AS repo,
      (SELECT pr_id FROM pull_request WHERE id = event.pr) AS pr_id, (SELECT title FROM pull_request WHERE id = event.pr) AS title,
      (SELECT followed = 1 AND archived_at IS NULL FROM pull_request WHERE id = event.pr) AS shown`,
  cleanup: "DELETE FROM event WHERE claimed_at IS NOT NULL AND claimed_at < $cutoff",
  description: "SELECT description FROM pull_request WHERE id = $id",
  checkpoint: "SELECT last_complete_at, incomplete_reason, last_error FROM sync_checkpoint WHERE scope = $scope",
};

type RawRow = {
  id: number;
  project: string;
  repo: string;
  pr_id: number;
  title: string | null;
  author_slug: string | null;
  author_name: string | null;
  my_role: Role | null;
  state: string | null;
  my_status: string | null;
  last_reviewed_commit: string | null;
  source_head: string | null;
  source_branch: string | null;
  target_branch: string | null;
  web_url: string | null;
  reviewers_json: string | null;
  on_dashboard: number;
  followed: number;
  unread: number;
  reply: number;
  last_activity: number;
  has_checkpoint: number;
  last_complete_at: number | null;
  incomplete_reason: string | null;
  last_error: string | null;
};

type RawCheckpoint = { last_complete_at: number | null; incomplete_reason: string | null; last_error: string | null };

const toCheckpoint = (k: RawCheckpoint): CheckpointDto => ({
  lastCompleteAt: k.last_complete_at,
  reason: k.incomplete_reason as CheckpointReason | null,
  error: k.last_error,
});

function reasonsOf(r: RawRow): Reason[] {
  const out: Reason[] = [];
  const open = r.state === "OPEN";
  const reviewer = open && r.my_role === "REVIEWER";
  if (r.reply) out.push("reply_to_you");
  if (reviewer && r.my_status === "UNAPPROVED" && !r.last_reviewed_commit) out.push("review_requested");
  if (reviewer && r.last_reviewed_commit && r.last_reviewed_commit !== r.source_head) out.push("new_commits");
  if (r.state === "MERGED" || r.state === "DECLINED") out.push("closed");
  return out;
}

const toRow = (r: RawRow): PrRow => ({
  id: r.id,
  project: r.project,
  repo: r.repo,
  prId: r.pr_id,
  title: r.title,
  authorSlug: r.author_slug,
  authorName: r.author_name,
  role: r.my_role,
  state: r.state,
  status: r.my_status,
  sourceBranch: r.source_branch,
  targetBranch: r.target_branch,
  webUrl: r.web_url,
  reviewers: r.reviewers_json === null ? [] : (JSON.parse(r.reviewers_json) as Omit<Reviewer, "login">[]),
  onDashboard: r.on_dashboard === 1,
  followed: r.followed === 1,
  unread: r.unread,
  reasons: reasonsOf(r),
  lastActivity: r.last_activity,
  checkpoint: r.has_checkpoint ? toCheckpoint(r) : null,
});

const selectRows = (db: Database, me: string, id: number | null) => (db.query(SQL.rows).all({ me, id }) as RawRow[]).map(toRow);

export function listPrs(db: Database, me: string): PrRow[] {
  return selectRows(db, me, null).sort(byInbox);
}

// null for an unknown, archived, or unlisted PR.
export function prDetail(db: Database, me: string, id: number): PrDetail | null {
  const pr = selectRows(db, me, id)[0];
  if (!pr) return null;
  type Raw = {
    comment_id: number;
    version: number;
    parent_id: number | null;
    root_id: number;
    author_slug: string;
    author_name: string | null;
    text: string;
    anchor_json: string | null;
    thread_resolved: number;
    created_at: number;
    updated_at: number;
    ack_version: number | null;
    tombstoned_at: number | null;
  };
  const comments = (db.query(SQL.comments).all({ pr: id }) as Raw[]).map((c): CommentDto => {
    const deleted = c.tombstoned_at !== null;
    return {
      id: c.comment_id,
      version: c.version,
      parentId: c.parent_id,
      rootId: c.root_id,
      authorSlug: c.author_slug,
      authorName: c.author_name,
      text: deleted ? null : c.text,
      anchor: c.anchor_json === null ? null : JSON.parse(c.anchor_json),
      threadResolved: c.thread_resolved === 1,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      unread: pr.followed && !deleted && (c.ack_version === null || c.ack_version < c.version),
      deleted,
    };
  });
  const { description } = db.query(SQL.description).get({ id }) as { description: string | null };
  return { pr, description, comments };
}

export function markRead(db: Database, pr: number, items: { id: number; version: number }[]): number {
  return db.transaction(() => {
    let changed = 0;
    const q = db.query(SQL.read);
    for (const it of items) changed += q.run({ pr, id: it.id, version: it.version }).changes;
    return changed;
  })();
}

function followState(db: Database, id: number): FollowState | null {
  const r = db.query(SQL.followState).get({ id }) as { id: number; followed: number; archived_at: number | null } | null;
  return r && { id: r.id, followed: r.followed === 1, archivedAt: r.archived_at };
}

// Follow also clears archived_at. The sync engine clears initialized_at of unwatched PRs itself.
export function setFollowed(db: Database, id: number, followed: boolean): FollowState | null {
  db.query(SQL.follow).run({ id, followed: followed ? 1 : 0 });
  return followState(db, id);
}

export function setArchived(db: Database, id: number, archived: boolean, now: number): FollowState | null {
  db.query(SQL.archive).run({ id, archived: archived ? 1 : 0, now });
  return followState(db, id);
}

export function followKey(db: Database, key: { project: string; repo: string; pr_id: number }): FollowState {
  const { id } = db.query(SQL.followKey).get(key) as { id: number };
  return followState(db, id) as FollowState;
}

export function claimEvents(db: Database, now: number): ClaimedEvent[] {
  type Raw = Omit<ClaimedEvent, "createdAt" | "digest" | "prId"> & { created_at: number; digest: number; pr_id: number; shown: number };
  // Events of archived or unfollowed PRs stay claimed, so they never notify later.
  return (db.query(SQL.claim).all({ now }) as Raw[])
    .filter((e) => e.shown === 1)
    .map(({ created_at, digest, pr_id, shown: _, ...e }) => ({ ...e, createdAt: created_at, digest: digest === 1, prId: pr_id }))
    .sort((a, b) => a.id - b.id);
}

export function cleanupEvents(db: Database, now: number) {
  db.query(SQL.cleanup).run({ cutoff: now - CLAIMED_TTL_MS });
}

export function dashboardCheckpoint(db: Database): CheckpointDto | null {
  const k = db.query(SQL.checkpoint).get({ scope: "dashboard" }) as RawCheckpoint | null;
  return k && toCheckpoint(k);
}
