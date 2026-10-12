// API request and response shapes shared by server and UI.
import { z } from "zod";
import {
  type Anchor,
  type AnchoredFinding,
  type Carried,
  type DiffKind,
  MAX_FIX_EDITS,
  MAX_QUESTION,
  MAX_REPLY_THREADS,
  type Question,
  type ReplyPayload,
  type Side,
  type ValidatedResult,
} from "./review";
import type { RunErrorKind, RunEvent, RunStatus } from "./run-log";
import type { ExcerptLine, IncompleteReason, Reviewer, Role } from "./types";

export type { ExcerptLine };

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

export const MAX_NOTE = 20_000;
export const MAX_PROFILES = 20;
// Seconds between sync cycles.
export const CHECK_CHOICES = [30, 60, 120, 300, 600, 900] as const;

const profileId = z.string().regex(/^[a-z0-9-]{1,40}$/);

// prompt: the profile part of both agent prompts. docs: the run gets the documentation servers.
export const profileInput = z.object({
  id: profileId,
  name: z.string().trim().min(1).max(60),
  note: z.string().trim().max(200),
  prompt: z.string().trim().min(1).max(MAX_NOTE),
  explain: z.boolean(),
  docs: z.boolean(),
  maxTurns: z.number().int().min(2).max(200),
});
export type ProfileInput = z.infer<typeof profileInput>;

export const profileList = z
  .array(profileInput)
  .min(1)
  .max(MAX_PROFILES)
  .refine((l) => new Set(l.map((p) => p.id)).size === l.length, "Profile IDs must be unique.");

export const settingsInput = z.object({
  baseUrl: z.string().trim().min(1),
  // Absent or empty keeps the stored token. A new origin needs a token.
  token: z.string().trim().optional(),
  // Absent or empty means no CA file.
  caFile: z.string().trim().optional(),
  notifications: z.boolean().optional(),
  // Absent keeps the stored value.
  markAi: z.boolean().optional(),
  // Absent keeps the stored rules.
  taskRules: z.array(taskRuleInput).max(MAX_TASK_RULES).optional(),
  // Absent keeps the stored template. Empty clears it.
  taskLink: z.string().trim().max(2048).optional(),
  // Absent keeps the stored value.
  checkSeconds: z
    .number()
    .refine((n) => (CHECK_CHOICES as readonly number[]).includes(n))
    .optional(),
  // Absent keeps the stored profiles. null restores the shipped profiles.
  profiles: profileList.nullable().optional(),
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
  markAi: boolean;
  taskRules: TaskRuleDto[];
  taskLink: string | null;
  checkSeconds: number;
  // With prompts. Meta lists them without.
  profiles: ProfileInput[];
  // baseUrl: null when Jira is not connected.
  jira: { baseUrl: string | null; caFile: string | null; tokenStored: boolean };
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
  // The branch pages on the forge. The source branch of a PR from a fork is in the fork. null until a sync cycle gets them.
  sourceBranchUrl: string | null;
  targetBranchUrl: string | null;
  // Empty until the first sync cycle that writes the PR.
  // login: null for reviewers stored before the username was kept.
  reviewers: (Omit<Reviewer, "login"> & { login: string | null })[];
  onDashboard: boolean;
  followed: boolean;
  // Local clock in ms. null for every row of GET /api/prs.
  archivedAt: number | null;
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
// type: the change type from the forge, for example ADD, MODIFY, DELETE, MOVE. srcPath: the old path of a moved or copied file.
export type ChangedFile = { path: string; srcPath: string | null; type: string };
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
  // true: the event came after a sync gap of more than 2 check intervals. Show one summary per PR.
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

export type ProfileId = string;

// PUT /api/prs/:id/brief. POST /api/prs/:id/review runs the stored brief.
export const briefInput = z.object({ note: z.string().max(MAX_NOTE), profile: profileId });
// A profile for one run only. Absent: the brief profile. The route refuses an ID that the settings do not list.
const runProfile = profileId.optional();
// The query of POST /api/prs/:id/review.
export const reviewRunInput = z.object({ profile: runProfile });
export type BriefInput = z.infer<typeof briefInput>;
// updatedAt: null for a PR without a stored brief. The defaults then apply.
export type BriefDto = BriefInput & { updatedAt: number | null };

// The runner check without paths. kind auth: authMethod is not claude.ai.
export type RunnerCheckDto = { ok: true; version: string } | { ok: false; kind: "unavailable" | "auth"; message: string };
export type ProfileDto = { id: ProfileId; name: string; note: string; explain: boolean; maxTurns: number };

export type RunUsage = { costUsd: number; turns: number; durationMs: number; tokens: Record<string, unknown> };
// dropped: findings that the validator could not anchor. They show as coverage only.
export type RunSummary = Pick<ValidatedResult, "summary" | "risks" | "coverage" | "dropped">;

export type RunKind = "review" | "reply" | "ask" | "fix";

export type RunDto = {
  id: number;
  pr: number;
  kind: RunKind;
  profile: ProfileId;
  // The profile name at the start of the run.
  profileName: string;
  // The profile explain flag at the start of the run. null for runs made before it was stored.
  explain: boolean | null;
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
  // A re-review: head is the head that the base run reviewed. incremental: false when the run fell back to the full change.
  since: { head: string; incremental: boolean } | null;
  // An ask run only.
  question: string | null;
  // Plan r3 Feature C: the fetched tasks at the start of the run. Absent for runs made before it was stored.
  tasks?: { key: string; fetchedAt: number }[];
  // The finding items of the run that a re-review did not find fixed or outdated. 0 for other run kinds.
  findings: number;
};

export type ItemStatus = "new" | "accepted" | "discarded" | "posted";

export type ReviewItemDto = {
  id: number;
  run: number;
  kind: "finding" | "question" | "reply";
  body: string;
  // finding: the AnchoredFinding as validated. question: the Question. reply: the ReplyPayload; body is empty for action none.
  // carried: the item came from the base run of a re-review.
  payload: (AnchoredFinding | Question | ReplyPayload) & { carried?: Carried };
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
// srcLine: the old-side line of a ctx line. Bitbucket reads the line of a CONTEXT anchor on the old side (Gate v3 U4).
// reply: parentId is the comment that the reply answers.
export type PostDestination =
  | { kind: "inline"; path: string; srcPath: string | null; line: number; lineEnd: number; lineType: "add" | "ctx"; srcLine?: number }
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
// posts: per run in run order, the inline comments and the replies in item order, then the general comment.
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

// POST /api/prs/:id/reply-run. Absent threads: every thread where it is my turn. A thread is the ID of its root comment.
export const replyRunInput = z.object({ threads: z.array(positiveInt).min(1).max(MAX_REPLY_THREADS).optional(), profile: runProfile });

// ---------- Ask (plan r2 S-ASK) ----------

// POST /api/prs/:id/ask. GET /api/prs/:id/asks gives AskDto[], newest first, at most 20.
export const askInput = z.object({ question: z.string().trim().min(1).max(MAX_QUESTION), profile: runProfile });
export type AskInput = z.infer<typeof askInput>;
// answer: null until the run ends with a valid result.
export type AskDto = { run: RunDto; answer: string | null };

// ---------- Task context (plan r2 S-JIRA) ----------

export const JIRA_KEY = /^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/;

// The listing of one issue attachment (plan r3 S-JMD). id: digits only. created: the timestamp text from the source.
export type AttachmentMeta = { id: string; filename: string; mimeType: string | null; size: number; created: string | null };

// created: the timestamp text from the source. commentsTotal: the comment count at the source. truncated: a size cap cut the text.
// format: "markdown" for text converted from rendered HTML. Absent: plain text (rows stored before Release 3).
export type IssueContext = {
  key: string;
  summary: string;
  status: string | null;
  description: string | null;
  comments: { author: string; created: string; body: string }[];
  commentsTotal: number;
  truncated: boolean;
  format?: "markdown";
  attachments?: AttachmentMeta[];
};

// A downloaded attachment (plan r3 S-ATT). include: the file goes to context/attachments/ of each run. downloadedAt: ms.
export type AttachmentDto = {
  id: string;
  filename: string;
  size: number;
  sha256: string;
  image: boolean;
  text: boolean;
  include: boolean;
  downloadedAt: number;
};
// fetchedAt: ms. files: the downloaded attachments.
export type TaskContextDto = IssueContext & { source: "jira"; fetchedAt: number; files: AttachmentDto[] };

// The :att route parameter.
export const ATT_ID = /^[0-9]{1,18}$/;
// PUT /api/prs/:id/task-context/:key/files/:att.
export const attachmentInput = z.object({ include: z.boolean() });

// Plan r3 caps. Per file and per PR on disk, then the run inclusion caps.
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const MAX_PR_ATTACHMENT_BYTES = 500 * 1024 * 1024;
export const RUN_IMAGE_BYTES = 5 * 1024 * 1024;
export const RUN_IMAGES = 20;
export const RUN_TEXT_BYTES = 256 * 1024;
export const RUN_TEXT_TOTAL = 1024 * 1024;

// PUT /api/settings/jira. Empty baseUrl disconnects Jira and clears the token. Absent or empty token keeps the stored token.
export const jiraSettingsInput = z.object({
  baseUrl: z.string().trim().max(2048),
  token: z.string().trim().optional(),
  caFile: z.string().trim().optional(),
});
export type JiraSettingsInput = z.infer<typeof jiraSettingsInput>;

// ---------- Diff (plan r2 S-DIFF) ----------

export const DIFF_PAGE_ROWS = 1000;

// Same shape as DiffRow in src/server/review/diffmap.ts.
export type DiffRowDto = { kind: DiffKind; old: number; new: number; text: string };
// path: null for a deleted file. oldPath: null for an added file. rows: the row count of the file.
export type DiffFileDto = { path: string | null; oldPath: string | null; binary: boolean; added: number; removed: number; rows: number };
// GET /api/prs/:id/diff and POST /api/prs/:id/diff/fetch.
export type DiffIndexDto = { sourceHead: string; targetHead: string; mergeBase: string; files: DiffFileDto[] };
// GET /api/prs/:id/diff/file?path=&start=. next: the start of the next page, or null on the last page.
export type DiffPageDto = {
  path: string | null;
  oldPath: string | null;
  binary: boolean;
  start: number;
  next: number | null;
  rows: DiffRowDto[];
};
// GET /api/prs/:id/diff gives 409 with this body when the cache does not hold the PR heads.
export type DiffFetchNeeded = ApiError & { fetch: true };

// ---------- Fix it (plan r3) ----------

// POST /api/prs/:id/fix-run. Absent threads: the newest valid or partly reply draft of each thread.
export const fixRunInput = z.object({ threads: z.array(positiveInt).min(1).max(MAX_REPLY_THREADS).optional(), profile: runProfile });

// One stored edit. added, removed: the line counts of rows.
export type FixEditDto = { id: number; thread: number; path: string; added: number; removed: number; rows: DiffRowDto[] };

export const fixModes = ["clone", "cache"] as const;
export type FixMode = (typeof fixModes)[number];
export type FixCommitState = "committed" | "staged" | "undone";

// edits: the fix_edit IDs. before: the head before the commit, or the parent in cache mode.
// fetch: cache mode only. The UI builds the git fetch command from it.
export type FixCommitDto = {
  id: number;
  run: number;
  mode: FixMode;
  edits: number[];
  branch: string | null;
  before: string;
  commit: string | null;
  short: string | null;
  state: FixCommitState;
  fetch: { cache: string; ref: string } | null;
  createdAt: number;
};

// GET /api/prs/:id/fixes gives FixDto[], newest first, at most 10.
export type FixDto = {
  run: RunDto;
  threads: { thread: number; fixed: boolean; reason: string }[];
  edits: FixEditDto[];
  commits: FixCommitDto[];
};

// POST /api/fix-runs/:run/commit. The server checks only the message length.
export const fixCommitInput = z.object({
  edits: z.array(positiveInt).min(1).max(MAX_FIX_EDITS),
  message: z.string().min(1).max(5000),
  mode: z.enum(fixModes),
});
export type FixCommitInput = z.infer<typeof fixCommitInput>;

export const cloneProblems = [
  "not_set",
  "missing",
  "not_repo",
  "detached",
  "branch",
  "no_base",
  "behind",
  "diverged",
  "dirty",
  "busy",
  "identity",
  "patch",
] as const;
export type CloneProblem = (typeof cloneProblems)[number];

// GET, PUT /api/prs/:id/clone. text: a fixed text per kind.
export type CloneDto = {
  path: string | null;
  problems: { kind: CloneProblem; text: string }[];
  branch: string | null;
  head: string | null;
};
// GET /api/clones: one row per repository with a clone folder. pr: a PR of the repository, for the /prs/:id/clone routes.
// missing: the folder does not exist now.
export type CloneRowDto = { project: string; repo: string; path: string; pr: number; missing: boolean };
// POST /api/fix-runs/:run/commit gives 409 with this body when a clone check fails.
export type FixConflict = ApiError & { problems: CloneDto["problems"] };
export const cloneInput = z.object({ path: z.string().trim().min(1).max(4096) });
export type CloneInput = z.infer<typeof cloneInput>;

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
  // Context sources (plan r2). Each source is listed whether it is set up or not. configured: the source has settings.
  context: { id: string; name: string; configured: boolean }[];
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
