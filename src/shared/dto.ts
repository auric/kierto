// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// API request and response shapes shared by server and UI.
import { z } from "zod";
import {
  type Anchor,
  type AnchoredFinding,
  type Carried,
  type DiffKind,
  type FixedMark,
  type FixNote,
  MAX_FIX_EDITS,
  MAX_QUESTION,
  MAX_REPLY_THREADS,
  type Question,
  type ReplyPayload,
  type SessionMark,
  type Side,
  type ValidatedResult,
} from "./review";
import type { RunErrorKind, RunEvent, RunStatus } from "./run-log";
import type { ExcerptLine, IncompleteReason, Reviewer, Role, User } from "./types";

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

export const MAX_PROFILE_SKILLS = 200;
// A Claude Code skill: "<skill>" in the user skills folder, or "<plugin>:<skill>". Each part is a folder name.
export const skillId = z.string().regex(/^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}:)?[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);

// GET /api/skills. version: the plugin version.
export type SkillDto = { id: string; name: string; description: string; source: "user" | "plugin"; version?: string };
const NOT_FOUND = "it is not found";
// The start error for an always-use skill that a run cannot get. The brief shows the same text.
export const alwaysSkillError = (id: string, reason = NOT_FOUND) =>
  `Skill ${id} is marked Always use, but ${reason}. ${reason === NOT_FOUND ? "Enable the plugin again" : "Fix the skill folder"}, or remove the Always use mark in Settings > Review profiles.`;

export const MAX_PROFILE_MCP = 10;
export const MAX_MCP_TOOLS = 100;
// A server or tool name goes into CLI flags as mcp__<server>__<tool>. src/server/review/claude.ts NAME has the same characters.
export const mcpName = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
// A server ID: the name of a user server, or <plugin>:<server> for a server of an enabled plugin. The plugin part is a skillId part.
export const mcpServerId = z.string().regex(/^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}:)?[A-Za-z0-9_-]{1,128}$/);
// One server of the user's Claude config or of an enabled plugin, and the tools that a run may call.
export const mcpPick = z.object({
  server: mcpServerId,
  tools: z
    .array(mcpName)
    .max(MAX_MCP_TOOLS)
    .transform((l) => [...new Set(l)]),
});
export type McpPick = z.infer<typeof mcpPick>;

// GET /api/mcp-servers. It never holds the URL, headers, command, args, or env of a server.
// name: the server ID. plugin: the plugin name of a plugin server.
export type McpServerDto = { name: string; transport: "stdio" | "http" | "sse"; source: "user" | "plugin"; plugin?: string };
// POST /api/mcp-servers/:name/tools. A hint is null when the server does not say.
export type McpToolDto = { name: string; description: string; readOnlyHint: boolean | null; destructiveHint: boolean | null };
// blocked: the server marks the tool as able to change data. No run allows it. unmarked: no readOnlyHint. The user must confirm it.
export type McpToolSafety = "blocked" | "unmarked" | "readOnly";
export const mcpToolSafety = (t: Pick<McpToolDto, "readOnlyHint" | "destructiveHint">): McpToolSafety =>
  t.destructiveHint === true || t.readOnlyHint === false ? "blocked" : t.readOnlyHint === true ? "readOnly" : "unmarked";

// The --effort choices of Claude Code 2.1.295 without "ultracode" (code.claude.com/docs/en/cli-reference).
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];
// A model alias such as opus, or a full model ID such as claude-opus-5-5 or opus[1m]. It goes into argv, so it never starts with "-".
export const modelName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,199}$/);
// auto: the main agent decides when to call rl-reviewer. always: it splits the changed files across rl-reviewer calls. off: no rl-reviewer.
export const REVIEWER_MODES = ["auto", "always", "off"] as const;
export type ReviewerMode = (typeof REVIEWER_MODES)[number];
// null model or effort: no flag and no agent field, so Claude Code uses its own default.
export const reviewerSetup = z.object({
  model: modelName.nullable().default(null),
  effort: z.enum(EFFORTS).nullable().default(null),
  mode: z.enum(REVIEWER_MODES).default("auto"),
});
export type ReviewerSetup = z.infer<typeof reviewerSetup>;
export const DEFAULT_REVIEWER: ReviewerSetup = { model: null, effort: null, mode: "auto" };

// prompt: the profile part of both agent prompts. docs: the run gets the documentation servers.
// skills: the run gets a copy of each skill in ./skills. Absent in profiles saved before skills existed.
// mcp: servers of the user's Claude config with the chosen tools. Absent in profiles saved before this field existed.
// model, effort: --model and --effort of every run of the profile. reviewer: the rl-reviewer agent of review runs. Absent in older profiles.
// alwaysSkills: chosen skills that every run reads first. A run does not start without them. Absent in older profiles.
// languageChecks: review runs get the checklists for the languages of the change. Absent in older profiles.
export const profilePrompt = z.string().trim().min(1).max(MAX_NOTE);
export const profileInput = z
  .object({
    id: profileId,
    name: z.string().trim().min(1).max(60),
    note: z.string().trim().max(200),
    prompt: profilePrompt,
    explain: z.boolean(),
    docs: z.boolean(),
    languageChecks: z.boolean().default(false),
    maxTurns: z.number().int().min(2).max(200),
    skills: z
      .array(skillId)
      .max(MAX_PROFILE_SKILLS)
      .default([])
      .transform((l) => [...new Set(l)]),
    alwaysSkills: z
      .array(skillId)
      .max(MAX_PROFILE_SKILLS)
      .default([])
      .transform((l) => [...new Set(l)]),
    mcp: z
      .array(mcpPick)
      .max(MAX_PROFILE_MCP)
      .default([])
      .refine((l) => new Set(l.map((m) => m.server)).size === l.length, "Each MCP server can occur only once."),
    model: modelName.nullable().default(null),
    effort: z.enum(EFFORTS).nullable().default(null),
    reviewer: reviewerSetup.default(() => ({ ...DEFAULT_REVIEWER })),
  })
  .refine((p) => p.alwaysSkills.every((id) => p.skills.includes(id)), {
    message: "Each always-use skill must be a chosen skill.",
    path: ["alwaysSkills"],
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
  // Absent keeps the stored value.
  markSeverity: z.boolean().optional(),
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
  // Absent keeps the stored value. docs/plans/session-consult.md part C: while it is off, the app reads no transcript.
  sessions: z.boolean().optional(),
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
  markSeverity: boolean;
  taskRules: TaskRuleDto[];
  taskLink: string | null;
  checkSeconds: number;
  // With prompts. Meta lists them without.
  profiles: ProfileInput[];
  // baseUrl: null when Jira is not connected.
  jira: { baseUrl: string | null; caFile: string | null; tokenStored: boolean };
  // The opt-in of "Ask your session" (docs/plans/session-consult.md part C). Default off.
  sessions: boolean;
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
  // The user page of the author on the forge (plan pr-view-v4 N2). null until a sync cycle gets it, or when it has another origin.
  authorUrl: string | null;
  // The server has the source and the target head. A run needs both (jobs.ts).
  synced: boolean;
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
  // The count of threads whose current open reply draft would post and is out of date or resolved since (src/shared/stale.ts).
  staleDrafts: number;
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
  // Root comments of resolved threads only, when the forge sent them (integration-check.md U56).
  resolver?: User;
  resolvedAt?: number;
  createdAt: number;
  updatedAt: number;
  unread: boolean;
  deleted: boolean;
  // Root comments of inline threads only.
  excerpt?: ExcerptLine[];
  task?: "open" | "done";
  // The app posted this comment: "run" from a review finding or question, "draft" from a reply draft, "reply" from the reply composer.
  posted?: "run" | "draft" | "reply";
  // Root comments of inline threads only: ms of the sync that saw the anchor turn orphaned. Absent: not orphaned, or orphaned at first sight.
  orphanedAt?: number;
};

// sourceHead: the source head of the last sync. null before the first sync.
export type PrDetail = {
  pr: PrRow;
  description: string | null;
  sourceHead: string | null;
  comments: CommentDto[];
  files?: ChangedFile[];
  commits?: CommitDto[];
};

export type FollowState = { id: number; followed: boolean; archivedAt: number | null };

export type ClaimedEvent = {
  id: number;
  pr: number;
  kind: "comment_new" | "commits_pushed" | "reviewer_added" | "draft_stale";
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
// The run setup of a profile for the brief. model, effort: the profile flags; null: no flag. skillCount, mcpCount: the picked items.
export type ProfileDto = {
  id: ProfileId;
  name: string;
  note: string;
  explain: boolean;
  maxTurns: number;
  model: string | null;
  effort: Effort | null;
  reviewerMode: ReviewerMode;
  skillCount: number;
  // The skill IDs that every run of the profile needs.
  alwaysSkills: string[];
  mcpCount: number;
};

export type RunUsage = { costUsd: number; turns: number; durationMs: number; tokens: Record<string, unknown> };
// dropped: findings that the validator could not anchor. They show as coverage only.
export type RunSummary = Pick<ValidatedResult, "summary" | "risks" | "coverage" | "dropped">;

// session: a direct consult of the user's own session (docs/plans/session-consult.md part C).
export type RunKind = "review" | "reply" | "ask" | "fix" | "session";

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
  // The model from the init event, else the --model value of the run. null: no init event and no --model value.
  model: string | null;
  // The --effort value of the run, or "default" for no flag. null for runs made before it was stored.
  effort: string | null;
  // effort "default" or null only: the effort that the user settings give. null: unknown.
  effortDefault: string | null;
  // true: effortDefault comes from the current settings, because the run stored none.
  effortNow: boolean;
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
  // The project instruction files that the run got. Absent for runs made before it was stored.
  instructions?: { files: InstructionFileDto[]; bytes: number; notLoaded?: string[] };
  // The skills that the run got. always: the profile marks the skill Always use. Absent for runs made before it was stored.
  skills?: { id: string; always: boolean }[];
  // The finding items of the run that a re-review did not find fixed or outdated. 0 for other run kinds.
  findings: number;
  // A running run before the CLI starts: indexing builds the codegraph index of the snapshot.
  phase?: "indexing";
  // A session run only: the transcript that it forked and the text that it got, with no transcript text. tokens: sessionTokens(bytes).
  // mode: consult.ts sessionModes, absent for runs made before part D. run: on a fix run that an import made from the proposal of a
  // session run (session-consult.md part D), that session run.
  consult?: {
    session: string;
    title: string | null;
    bytes: number;
    tokens: number;
    items: number;
    textBytes: number;
    mode?: "judge" | "fix";
    run?: number;
  };
};

export type ItemStatus = "new" | "accepted" | "discarded" | "posted";

export type ReviewItemDto = {
  id: number;
  run: number;
  kind: "finding" | "question" | "reply";
  body: string;
  // finding: the AnchoredFinding as validated. question: the Question. reply: the ReplyPayload; body is empty for action none.
  // carried: the item came from the base run of a re-review. fixed: findings only, a fix commit covers the finding.
  // session: the verdict of your session (docs/plans/session-consult.md part C).
  payload: (AnchoredFinding | Question | ReplyPayload) & { carried?: Carried; fixed?: FixedMark; session?: SessionMark };
  // Findings only: the current anchor.
  anchor: (Anchor & { side: Side }) | null;
  status: ItemStatus;
  revision: number;
  edited: boolean;
  // An open reply draft of GET reply-drafts and POST /api/items/:id: the newest revision of it (payload revises) that waits for
  // Use revision or Keep mine. Absent: none.
  revised?: ReviewItemDto;
  // Reply items only: the run that wrote the draft. head: the source head at the run start. finishedAt: null while it runs.
  drafted?: { kind: RunKind; startedAt: number; finishedAt: number | null; head: string };
};

// POST /api/items/:id. revision: the item revision on screen. A mismatch gives 409 with ItemConflict.
// Every change raises the revision. edit also accepts the item. move takes a line of moveChoices(excerpt, side).
export const itemActionInput = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["accept", "discard", "restore"]), revision: version }),
  z.object({ action: z.literal("edit"), revision: version, body: z.string().trim().min(1).max(MAX_NOTE) }),
  z.object({ action: z.literal("move"), revision: version, line: positiveInt }),
  // Reply drafts only: the tick of "Resolve after posting".
  z.object({ action: z.literal("resolve"), revision: version, resolve: z.boolean() }),
  // A "Fixed in" draft whose commit is not on the PR: drop the commit link and accept the draft, so it posts as a plain reply.
  z.object({ action: z.literal("plain"), revision: version }),
  // A revision (payload revises) of the user's draft. use-revision: the revision becomes the draft, not accepted, and the user's draft is
  // discarded. draft: the revision of the user's draft on screen. keep-mine: the revision goes, and the user's draft stays as it is.
  z.object({ action: z.literal("use-revision"), revision: version, draft: version }),
  z.object({ action: z.literal("keep-mine"), revision: version }),
  // An open reply draft: answer the newest live message of the thread with the same text. No AI run.
  z.object({ action: z.literal("reply-to-newest"), revision: version }),
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
  // Reply posts only: the root comment of the thread to resolve after the post. An empty body resolves without a reply.
  resolve?: number;
  // Reply posts with a body only: the thread was resolved at the draft and is resolved now, so the post reopens it first.
  // A thread resolved after the draft blocks the draft (BlockedDraft resolved-since).
  reopen?: "resolved";
};
// docs/plans/thread-outcome.md: a reply draft that confirm cannot post now. out-of-date: new messages or a deleted parent.
// resolved-since: the thread was resolved after the draft. unpushed: the fix commit is not on the PR yet. commit-gone: the clone
// branch of the fix no longer holds the fix commit, after a rebase, squash, or reset. thread: the root comment.
// revision: the item revision, for an item action. commit: the short hash of the fix commit, for unpushed and commit-gone.
export type BlockedReason = "out-of-date" | "resolved-since" | "unpushed" | "commit-gone";
export type BlockedDraft = { item: number; revision: number; thread: number; reason: BlockedReason; commit?: string };
// posts: per run in run order, the inline comments and the replies in item order, then the general comment.
// blocked: the drafts that the plan leaves out. Absent: none.
export type PostPlanDto = { pr: number; posts: PlannedPost[]; blocked?: BlockedDraft[] };

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
  // The resolve step after the comment step. pending: it waits for the comment or runs now. A failed step never posts the reply again.
  resolve?: { root: number; state: "pending" | "done" | "failed"; error: string | null };
};

// POST /api/prs/:id/resolve: resolve or reopen a thread now. thread: the root comment. seen: the newest live message on screen.
export const threadResolveInput = z.object({ thread: positiveInt, resolved: z.boolean(), seen: positiveInt });
export type ThreadResolveInput = z.infer<typeof threadResolveInput>;
// reason: messages: new messages arrived. changed: the comment changed on the forge (HTTP 409). forbidden: no permission.
// gone: the thread is deleted. ignored: the forge took the change, but the thread state stayed.
export type ThreadResolveError = ApiError & { reason: "messages" | "changed" | "forbidden" | "gone" | "ignored" };

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

// ---------- Improve prompt (Settings > Review profiles) ----------

// POST /api/profiles/improve: the profile fields as the editor shows them, and the user's goal. Empty prompt: write a new one.
export const improveInput = z.object({
  name: z.string().trim().max(60),
  note: z.string().trim().max(200),
  prompt: z.string().trim().max(MAX_NOTE),
  explain: z.boolean(),
  docs: z.boolean(),
  languageChecks: z.boolean(),
  model: modelName.nullable(),
  effort: z.enum(EFFORTS).nullable(),
  goal: z.string().trim().max(MAX_QUESTION),
});
export type ImproveInput = z.infer<typeof improveInput>;
// GET /api/profiles/improve/:id. The server keeps only the newest proposal.
export type ImproveDto =
  | { id: number; status: "running"; startedAt: number }
  | { id: number; status: "done"; prompt: string; reasons: string[] }
  | { id: number; status: "failed"; kind: RunErrorKind; text: string }
  | { id: number; status: "cancelled" };

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

// POST /api/prs/:id/fix-run. findings: review item IDs. Absent threads and findings: the newest valid or partly reply draft of each thread.
// docs/plans/fix-ux.md WP3: one run takes at most MAX_REPLY_THREADS threads and findings together. The route shows the refine message.
// anyway: "Fix anyway" (docs/plans/thread-outcome.md). The user wants edits despite a decision or risk note. Exactly one target.
const fixTargets = z.array(positiveInt).min(1).max(MAX_REPLY_THREADS).optional();
export const fixRunInput = z
  .object({ threads: fixTargets, findings: fixTargets, profile: runProfile, anyway: z.boolean().optional() })
  .refine((v) => (v.threads?.length ?? 0) + (v.findings?.length ?? 0) <= MAX_REPLY_THREADS, {
    message: `Pick at most ${MAX_REPLY_THREADS} threads and findings for one run.`,
  })
  .refine((v) => !v.anyway || (v.threads?.length ?? 0) + (v.findings?.length ?? 0) === 1, {
    message: "Fix anyway takes exactly one thread or finding.",
  });

// One stored edit. Exactly one of thread and finding is set. added, removed: the line counts of rows.
export type FixEditDto = {
  id: number;
  thread?: number;
  finding?: number;
  path: string;
  added: number;
  removed: number;
  rows: DiffRowDto[];
};

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

// GET /api/prs/:id/fixes gives FixDto[], newest first, at most 10. Each note names exactly one of thread and finding.
export type FixDto = {
  run: RunDto;
  threads: FixNote[];
  edits: FixEditDto[];
  commits: FixCommitDto[];
};

// GET /api/prs/:id/threads/:thread/history (docs/plans/thread-outcome.md section 10). The client merges it with the thread messages.
// at: ms. exact false: the time of the run, not of the draft itself ("Won't fix" from a decline).
// replacedBy: the item that replaced a discarded draft, else null. edits: the edits of this thread in the commit. of: the edits of this
// thread in the fix run. pushed: the PR commits list the commit. undoneAt: ms of the undo, else null.
// posts: replies in the thread, resolves of the thread, and the post that started the thread. error: last_error of the post.
export type ThreadHistoryDto = {
  thread: number;
  drafts: { at: number; exact: boolean; item: ReviewItemDto; replacedBy: number | null }[];
  fixes: { at: number; run: number; note: FixNote }[];
  commits: {
    at: number;
    id: number;
    run: number;
    short: string | null;
    state: FixCommitState;
    edits: number;
    of: number;
    pushed: boolean;
    undoneAt: number | null;
  }[];
  posts: {
    at: number;
    id: number;
    run: number | null;
    kind: PostDestination["kind"];
    state: PostState;
    error: string | null;
    remoteId: number | null;
    updatedAt: number;
    resolve: NonNullable<PostDto["resolve"]> | null;
  }[];
};

// POST /api/fix-runs/:run/commit. The server checks only the message length.
export const fixCommitInput = z.object({
  edits: z.array(positiveInt).min(1).max(MAX_FIX_EDITS),
  message: z.string().min(1).max(5000),
  mode: z.enum(fixModes),
});
export type FixCommitInput = z.infer<typeof fixCommitInput>;

// docs/plans/thread-outcome.md "Don't fix": decline the proposal of a fix run for one thread or one finding.
// reason: the text of the "Won't fix" reply draft.
export const fixDeclineInput = z
  .object({
    run: positiveInt,
    thread: positiveInt.optional(),
    finding: positiveInt.optional(),
    reason: z.string().trim().min(1).max(MAX_NOTE),
  })
  .refine((v) => (v.thread === undefined) !== (v.finding === undefined), { message: "Name exactly one thread or one finding." });
export type FixDeclineInput = z.infer<typeof fixDeclineInput>;
// Undo of a decline: the same run and target.
export const fixUndeclineInput = z
  .object({ run: positiveInt, thread: positiveInt.optional(), finding: positiveInt.optional() })
  .refine((v) => (v.thread === undefined) !== (v.finding === undefined), { message: "Name exactly one thread or one finding." });
export type FixUndeclineInput = z.infer<typeof fixUndeclineInput>;

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

// Project instructions per repository. The app reads these clone files only at the clone root.
export const CLONE_INSTRUCTION_FILES = ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md"] as const;
export const EXTRA_INSTRUCTIONS_MAX = 20_000;
export const instructionsInput = z.object({
  target: z.boolean(),
  local: z.array(z.enum(CLONE_INSTRUCTION_FILES)).max(CLONE_INSTRUCTION_FILES.length),
  extra: z.string().max(EXTRA_INSTRUCTIONS_MAX),
});
export type InstructionsInput = z.infer<typeof instructionsInput>;
// GET /api/instructions: one row per repository of a stored PR. pr: the newest PR of the repository. clone: null when not set.
export type InstructionRepoDto = { project: string; repo: string; pr: number; clone: string | null; settings: InstructionsInput };
// path: from the repository or clone root. Empty for the settings text.
// path: from the config folder for the global source.
export type InstructionFileDto = { source: "global" | "target" | "clone" | "settings"; path: string; bytes: number };
// GET and PUT /api/instructions/global: the switch for the global instruction file of the runner config folder. It applies to every repository.
// path: the file that runs read when the switch is on.
export const globalInstructionsInput = z.object({ on: z.boolean() });
export type GlobalInstructionsDto = { on: boolean; path: string };
// GET /api/prs/:id/instructions/preview. found: the clone files that exist now. target "no-cache": no run fetched the target branch yet.
export type InstructionPreviewDto = {
  readAt: number;
  found: string[];
  target: "read" | "no-cache" | "off";
  files: InstructionFileDto[];
  bytes: number;
  text: string;
  notLoaded: string[];
};

// GET /api/runs/:id. events: the run log in seq order.
export type RunDetail = { run: RunDto; events: RunEvent[]; items: ReviewItemDto[] };

// POST /api/prs/:id/review gives 409 with this body while another review runs (A14).
export type RunConflict = ApiError & { running: { run: number; pr: number } };

// sure: false when the source has a precedence that the runner docs do not state.
export type SettingValue = { value: string; sure: boolean };
// model: the model of a run without --model. null: the account default, which the app cannot see.
// effort: the effort of a run without --effort, by model choice. Key "": no --model. The other keys: each alias and each profile model text.
// An absent key: unknown.
export type RunnerDefaults = { model: SettingValue | null; effort: Record<string, SettingValue> };

// GET /api/meta. Product names, and the default model and effort of the runner. No other setting value.
export type MetaDto = {
  // The package.json version. commit: the commit of a compiled binary, null when Bun runs the source.
  app: { version: string; commit: string | null };
  forge: { name: string };
  // check: the cached runner check. null before the first check. Each run refreshes it.
  // login: the command that signs the runner in with the subscription. models: the model aliases that the settings offer.
  // modelExample: a full model ID for the placeholder of the model ID field.
  runner: {
    name: string;
    short: string;
    initials: string;
    login: string;
    models: string[];
    modelExample: string;
    check: RunnerCheckDto | null;
    // defaults: from the user settings file of the runner. null: the file is absent or unreadable.
    defaults: RunnerDefaults | null;
  };
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
