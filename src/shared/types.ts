// Forge-neutral types. The Bitbucket adapter maps its payloads to these.

export type PrRef = { project: string; repo: string; id: number };

export type Role = "REVIEWER" | "AUTHOR";

// name: the display name. login: the username.
export type User = { slug: string; name: string; login: string };

// `status` and `state` stay open strings: servers send values beyond the known ones.
export type Reviewer = User & { status: string; lastReviewedCommit?: string };

export type PullRequest = {
  ref: PrRef;
  version: number;
  title: string;
  description?: string;
  state: string;
  author: User;
  reviewers: Reviewer[];
  sourceHead: string;
  targetHead: string;
  sourceBranch: string;
  targetBranch: string;
  // Present only when the server link has the configured origin.
  webUrl?: string;
  updatedDate: number;
};

export type Comment = {
  id: number;
  version: number;
  // null for a root comment.
  parentId: number | null;
  // Equals `id` for a root comment.
  rootId: number;
  author: User;
  text: string;
  anchor?: unknown;
  threadResolved: boolean;
  createdAt: number;
  updatedAt: number;
};

export type ForgeErrorKind = "network" | "timeout" | "auth" | "forbidden" | "not_found" | "rate" | "server" | "shape";

export type ForgeErrorInfo = {
  kind: ForgeErrorKind;
  status?: number;
  // Raw Retry-After header value, only for kind `rate`.
  retryAfter?: string;
  endpoint: string;
  message: string;
};

export type IncompleteReason = ForgeErrorKind | "cursor" | "page_limit";

export type ListResult<T> =
  | { items: T[]; complete: true }
  | { items: T[]; complete: false; reason: IncompleteReason; error?: ForgeErrorInfo };

export type CommentStatus = "present" | "deleted";
