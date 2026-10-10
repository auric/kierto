// API request and response shapes shared by server and UI.
import { z } from "zod";
import type { IncompleteReason, Reviewer, Role } from "./types";

export const settingsInput = z.object({
  baseUrl: z.string().trim().min(1),
  // Absent or empty keeps the stored token. A new origin needs a token.
  token: z.string().trim().optional(),
  // Absent or empty means no CA file.
  caFile: z.string().trim().optional(),
  notifications: z.boolean().optional(),
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

export type Reason = "reply_to_you" | "review_requested" | "new_commits" | "closed";

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
  reasons: Reason[];
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
