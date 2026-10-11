// API request and response shapes shared by server and UI.
import { z } from "zod";
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
};

export type PrDetail = { pr: PrRow; description: string | null; comments: CommentDto[] };

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

// GET /api/meta. Product names only, never a setting value.
export type MetaDto = { forge: { name: string } };

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
