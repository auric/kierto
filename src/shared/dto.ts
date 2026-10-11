// API request and response shapes shared by server and UI.
import { z } from "zod";
import type { Anchor, AnchoredFinding, Question, Side, ValidatedResult } from "./review";
import type { RunErrorKind, RunEvent, RunStatus } from "./run-log";
import type { IncompleteReason, Reviewer, Role } from "./types";

export const taskSources = ["branch", "title", "description"] as const;

export type TaskSource = (typeof taskSources)[number];

// WP2 safety caps. The worker compiles the pattern, so a syntax check needs the worker too.
export const MAX_TASK_RULES = 20;
export const MAX_PATTERN = 200;

export const taskRuleInput = z.object({
  source: z.enum(taskSources),
  pattern: z.string().min(1).max(MAX_PATTERN),
  // Allowed parts before the dash. Absent: every key.
  keys: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
});

export type TaskRule = z.infer<typeof taskRuleInput>;

// timedOut: the rule ran past the budget. Sync skips it until the user edits it.
export type TaskRuleDto = TaskRule & { timedOut: boolean };

export const settingsInput = z.object({
  baseUrl: z.string().trim().min(1),
  // Absent or empty keeps the stored token. A new origin needs a token.
  token: z.string().trim().optional(),
  // Absent or empty means no CA file.
  caFile: z.string().trim().optional(),
  notifications: z.boolean().optional(),
  // Absent keeps the stored rules.
  taskRules: z.array(taskRuleInput).max(MAX_TASK_RULES).optional(),
  // Absent keeps the stored template. Empty clears it.
  taskLink: z.string().trim().max(2048).optional(),
});

export type SettingsInput = z.infer<typeof settingsInput>;

export type TokenStorage = "os" | "memory";

// Never holds the token.
export type SettingsDto = {
  baseUrl: string | null;
  user: string | null;
  tokenStored: boolean;
  tokenStorage: TokenStorage;
  caFile: string | null;
  notifications: boolean;
  taskRules: TaskRuleDto[];
  taskLink: string | null;
};

export type ApiError = { error: string };

// Values of sync_checkpoint.incomplete_reason. "gap": a comment is absent from complete activities, but its GET returns 200.
export type CheckpointReason = IncompleteReason | "gap";

export type CheckpointDto = { lastCompleteAt: number | null; reason: CheckpointReason | null; error: string | null };

// offline: no request reached the server. auth: 401, paused until the settings change. unconfigured: no settings or no token, paused.
// error: a local failure; a CA file error pauses until the settings change.
export type SyncState = "idle" | "ok" | "offline" | "auth" | "unconfigured" | "error";

export type SyncStatus = {
  running: boolean;
  state: SyncState;
  // Local clock in ms: the start of the last cycle that ended "ok".
  lastCompleteAt: number | null;
  // Local clock in ms. null while a cycle runs or polling is paused.
  nextAt: number | null;
  error: string | null;
};

// The inbox reason of a row. views.ts GROUPS maps each one to a list group. "triage" needs review drafts (M2).
export type Group = "your" | "triage" | "review" | "commits" | "comments" | "waiting" | "quiet" | "closed";

// The thread that the row opens at. msg: the first unread message, else the newest live message.
// author and snippet come from the newest live message. author: the display name, else the slug.
export type Cause = { thread: number; msg: number; author: string; snippet: string };

export type PrTask = { key: string; source: TaskSource; url: string | null };

// Metadata fields are null for a PR followed by URL until its first sync cycle.
export type PrRow = {
  id: number;
  project: string;
  repo: string;
  prId: number;
  title: string | null;
  authorSlug: string | null;
  authorName: string | null;
  role: Role | null;
  state: string | null;
  status: string | null;
  sourceBranch: string | null;
  targetBranch: string | null;
  webUrl: string | null;
  // Empty until the first sync cycle that writes the PR.
  // login: null for reviewers stored before the username was kept.
  reviewers: (Omit<Reviewer, "login"> & { login: string | null })[];
  onDashboard: boolean;
  followed: boolean;
  // 0 for an unfollowed PR.
  unread: number;
  group: Group;
  // The count of threads where it is my turn (src/shared/turn.ts).
  yourTurn: number;
  cause: Cause | null;
  // ms: the newest live message of the longest-waiting "wait" thread. null without a "wait" thread.
  waitSince: number | null;
  // ms: the last POST /api/prs/:id/seen. null before the first visit.
  seenAt: number | null;
  // D9: rule order, deduped, at most 10.
  tasks: PrTask[];
  // ms: the newest of the PR update and the comment updates.
  lastActivity: number;
  checkpoint: CheckpointDto | null;
};

// WP4 fills the optional forge fields below. The detail renders each part only when its field is present.
// hit: the commented line. kind: an added, removed, or context line of the diff.
export type ExcerptLine = { n: number; kind: "add" | "del" | "ctx"; text: string; hit: boolean };
// type: the change type from the forge, for example ADD, MODIFY, DELETE, MOVE.
export type ChangedFile = { path: string; type: string };
// author: the display name. at: ms. Newest first.
export type CommitDto = { hash: string; message: string; author: string; at: number };

// A deleted comment (D8) has text null and is never unread.
export type CommentDto = {
  id: number;
  version: number;
  parentId: number | null;
  rootId: number;
  authorSlug: string;
  authorName: string | null;
  // null for comments stored before the username was kept.
  authorLogin: string | null;
  text: string | null;
  anchor: unknown;
  threadResolved: boolean;
  createdAt: number;
  updatedAt: number;
  unread: boolean;
  deleted: boolean;
  // Root comments of inline threads only.
  excerpt?: ExcerptLine[];
  task?: "open" | "done";
  // The app posted this comment: "run" from review drafts, "reply" from the reply composer.
  posted?: "run" | "reply";
};

export type PrDetail = { pr: PrRow; description: string | null; comments: CommentDto[]; files?: ChangedFile[]; commits?: CommitDto[] };

export type FollowState = { id: number; followed: boolean; archivedAt: number | null };

export type ClaimedEvent = {
  id: number;
  pr: number;
  kind: "comment_new" | "commits_pushed" | "reviewer_added";
  ref: string;
  createdAt: number;
  // true: the event came after a sync gap of more than 2 minutes. Show one summary per PR.
  digest: boolean;
  project: string;
  repo: string;
  prId: number;
  title: string | null;
};

const positiveInt = z.number().int().positive();
const version = z.number().int().nonnegative();

export const readInput = z.object({
  pr: positiveInt,
  items: z.array(z.object({ id: positiveInt, version })).max(10_000),
});
export const followInput = z.object({ followed: z.boolean() });
export const archiveInput = z.object({ archived: z.boolean() });
export const followUrlInput = z.object({ url: z.string().trim().min(1).max(2048) });

// ---------- Review (plan v3 WP10) ----------

export const profileIds = ["general", "over", "security", "explain"] as const;
export type ProfileId = (typeof profileIds)[number];
export const MAX_NOTE = 20_000;

// PUT /api/prs/:id/brief. POST /api/prs/:id/review runs the stored brief.
export const briefInput = z.object({ note: z.string().max(MAX_NOTE), profile: z.enum(profileIds) });
export type BriefInput = z.infer<typeof briefInput>;
// updatedAt: null for a PR without a stored brief. The defaults then apply.
export type BriefDto = BriefInput & { updatedAt: number | null };

// The runner check without paths. kind auth: authMethod is not claude.ai.
export type RunnerCheckDto = { ok: true; version: string } | { ok: false; kind: "unavailable" | "auth"; message: string };
export type ProfileDto = { id: ProfileId; name: string; note: string; explain: boolean; maxTurns: number };

export type RunUsage = { costUsd: number; turns: number; durationMs: number; tokens: Record<string, unknown> };
// dropped: findings that the validator could not anchor. They show as coverage only.
export type RunSummary = Pick<ValidatedResult, "summary" | "risks" | "coverage" | "dropped">;

export type RunDto = {
  id: number;
  pr: number;
  profile: ProfileId;
  note: string;
  status: RunStatus;
  errorKind: RunErrorKind | null;
  errorText: string | null;
  sourceHead: string;
  targetHead: string;
  mergeBase: string | null;
  via: "pull-request-ref" | "branch" | null;
  sessionId: string | null;
  cliVersion: string | null;
  model: string | null;
  usage: RunUsage | null;
  // Ended runs with a valid result only.
  summary: RunSummary | null;
  startedAt: number;
  finishedAt: number | null;
  // Computed on read: a head of the PR differs from the reviewed head. null: both heads are the same.
  stale: { source: boolean; target: boolean } | null;
  hasRaw: boolean;
};

export type ItemStatus = "new" | "accepted" | "discarded" | "posted";

export type ReviewItemDto = {
  id: number;
  run: number;
  kind: "finding" | "question";
  body: string;
  // finding: the AnchoredFinding as validated. question: the Question.
  payload: AnchoredFinding | Question;
  // Findings only: the current anchor.
  anchor: (Anchor & { side: Side }) | null;
  status: ItemStatus;
  revision: number;
  edited: boolean;
};

// POST /api/items/:id. revision: the item revision on screen. A mismatch gives 409 with ItemConflict.
// Every change raises the revision. edit also accepts the item. move takes a line of moveChoices(excerpt, side).
export const itemActionInput = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["accept", "discard", "restore"]), revision: version }),
  z.object({ action: z.literal("edit"), revision: version, body: z.string().trim().min(1).max(MAX_NOTE) }),
  z.object({ action: z.literal("move"), revision: version, line: positiveInt }),
]);
export type ItemActionInput = z.infer<typeof itemActionInput>;
// item: the current item, for a reload.
export type ItemConflict = ApiError & { item: ReviewItemDto };

// GET /api/prs/:id/post-plan (plan v3 WP12). Confirm (WP13) posts these bodies byte for byte.
// lineType: the diff kind of the line. Old-side and outside findings post in the general comment (D3).
// reply: parentId is the comment that the reply answers.
export type PostDestination =
  | { kind: "inline"; path: string; srcPath: string | null; line: number; lineEnd: number; lineType: "add" | "ctx" }
  | { kind: "general" }
  | { kind: "reply"; parentId: number };
export type PlannedPost = {
  run: number;
  sourceHead: string;
  targetHead: string;
  mergeBase: string | null;
  destination: PostDestination;
  body: string;
  items: { id: number; revision: number }[];
  // A live root comment by another user on the same path and line.
  duplicate: { commentId: number; author: string } | null;
};
// posts: per run in run order, the inline comments in item order, then the general comment.
export type PostPlanDto = { pr: number; posts: PlannedPost[] };

// ---------- Outbox (plan v3 WP13a) ----------

// POST /api/prs/:id/confirm. items: every item of the confirmed posts, with the revisions on screen.
// A planned post is sent only when all of its items are here. Any other mismatch gives 409.
export const confirmInput = z.object({
  items: z
    .array(z.object({ id: positiveInt, revision: version }))
    .min(1)
    .max(1000),
});
export type ConfirmInput = z.infer<typeof confirmInput>;

// POST /api/prs/:id/replies. seen: the newest live message of the thread on screen, else 409 with ReplyConflict.
// key: a UUID made when the composer opens. The same key never sends twice.
export const replyPostInput = z.object({
  parentId: positiveInt,
  body: z.string().trim().min(1).max(MAX_NOTE),
  seen: positiveInt,
  key: z.uuid(),
});
export type ReplyPostInput = z.infer<typeof replyPostInput>;
export type ReplyConflict = ApiError & { newest: number };

// pending: not sent yet. sent: the request is out. unknown: no clear answer; the app checks the remote comments, then the user decides.
export type PostState = "pending" | "sent" | "unknown" | "failed" | "confirmed";

// One comment to send. The row binds the body, the destination, and the item revisions. run: null for a manual reply.
export type PostDto = {
  id: number;
  pr: number;
  run: number | null;
  destination: PostDestination;
  body: string;
  items: { id: number; revision: number }[];
  state: PostState;
  // The remote comment, set when the state is confirmed.
  remoteId: number | null;
  remoteVersion: number | null;
  attempts: number;
  lastError: string | null;
  // An unknown post that the app checks against the remote comments now.
  checking: boolean;
  createdAt: number;
  updatedAt: number;
};

// warning: the target branch moved after the review (D2). The comments stay on the reviewed commits.
export type ConfirmDto = { posts: PostDto[]; warning: string | null };

// GET /api/runs/:id. events: the run log in seq order.
export type RunDetail = { run: RunDto; events: RunEvent[]; items: ReviewItemDto[] };

// POST /api/prs/:id/review gives 409 with this body while another review runs (A14).
export type RunConflict = ApiError & { running: { run: number; pr: number } };

// GET /api/meta. Product names only, never a setting value.
export type MetaDto = {
  forge: { name: string };
  // check: the cached runner check. null before the first check. Each run refreshes it.
  // login: the command that signs the runner in with the subscription.
  runner: { name: string; short: string; initials: string; login: string; check: RunnerCheckDto | null };
  // Run log labels, keyed by RunEvent.tool.
  tools: Record<string, string>;
  profiles: ProfileDto[];
  // Context sources (Release 2, plan v3 section 8). Empty in Release 1.
  context: { id: string; name: string }[];
};

// POST /api/settings/task-rules/preview. Absent prs: the first 20 listed PRs.
export const taskPreviewInput = z.object({
  rules: z.array(taskRuleInput).max(MAX_TASK_RULES),
  sample: z.object({ branch: z.string().optional(), title: z.string().optional(), description: z.string().optional() }).optional(),
  prs: z.array(positiveInt).max(20).optional(),
});

export type TaskPreviewInput = z.infer<typeof taskPreviewInput>;

export type FoundTask = { key: string; source: TaskSource };

// Index i of rules belongs to rule i of the request. A 400 carries the same rules array with the syntax errors.
export type TaskPreviewDto = {
  rules: { error: string | null; timedOut: boolean }[];
  sample: FoundTask[] | null;
  prs: { id: number; project: string; repo: string; prId: number; title: string | null; tasks: FoundTask[] }[];
};

export type TaskPreviewError = ApiError & { rules: TaskPreviewDto["rules"] };
