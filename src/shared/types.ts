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
  // The repository browse link of the target repository. Present only when it has the configured origin.
  repoUrl?: string;
  // The branch pages. The source branch of a PR from a fork is in the fork. Present only when the repository link has the configured origin.
  sourceBranchUrl?: string;
  targetBranchUrl?: string;
  updatedDate: number;
};

// A line of the diff around an inline comment. n: the new line number of an added or context line, the old one of a removed line.
// A context line of an old-side comment keeps its old number. hit: the commented line.
export type ExcerptLine = { n: number; kind: "add" | "del" | "ctx"; text: string; hit: boolean };

// The line of an inline root comment, numbered as its excerpt numbers it. undefined: no line, or a new-side CONTEXT anchor without an excerpt.
// Gate v3 U4: the forge line of a CONTEXT anchor is the old-side line, whatever fileType says.
export function commentLine(c: { anchor?: unknown; excerpt?: ExcerptLine[] }): number | undefined {
  const hit = c.excerpt?.find((l) => l.hit);
  if (hit) return hit.n;
  const a = c.anchor as { line?: unknown; lineType?: unknown; fileType?: unknown } | null | undefined;
  return typeof a?.line === "number" && (a.lineType !== "CONTEXT" || a.fileType === "FROM") ? a.line : undefined;
}

export type Comment = {
  id: number;
  version: number;
  // null for a root comment.
  parentId: number | null;
  // Equals `id` for a root comment.
  rootId: number;
  author: User;
  text: string;
  // Root comments only. A reply carries a copy of its root anchor on the forge (Gate v3 U16). The adapter drops it.
  anchor?: unknown;
  threadResolved: boolean;
  createdAt: number;
  updatedAt: number;
  // Open forge values. A task is severity BLOCKER. Done is state RESOLVED (Gate v3 U14).
  severity?: string;
  state?: string;
  // Inline root comments with a diff only.
  excerpt?: ExcerptLine[];
};

// at: the author time in ms. committedAt: the commit time in ms. authorSlug: null for an author with no forge account.
export type Commit = {
  hash: string;
  parents: string[];
  message: string;
  authorSlug: string | null;
  authorName: string;
  at: number;
  committedAt: number;
};

// srcPath: the old path of a moved or copied file. type: the forge change type, for example ADD, MODIFY, DELETE, MOVE.
export type Change = { path: string; srcPath: string | null; type: string };

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
