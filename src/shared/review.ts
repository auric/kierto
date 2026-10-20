// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Review and reply results (plan v3 WP9, replies.md WP17). zod parses the CLI output. reviewJsonSchema() and replyJsonSchema() feed --json-schema.
import { z } from "zod";

export const severities = ["blocker", "major", "minor", "nit"] as const;
export const evidenceStatuses = ["code", "reproduced", "unverified"] as const;
export const confidences = ["high", "medium", "low"] as const;
export const MAX_FINDINGS = 100;

const lineNo = z.number().int().min(1);

export const finding = z.object({
  path: z.string().describe("File path relative to the repository root, with / separators."),
  side: z.enum(["new", "old"]).describe("new: the line exists at the head commit. old: a removed line, numbered at the base commit."),
  line: lineNo.describe("First line of the range on that side."),
  lineEnd: lineNo.nullable().describe("Last line of the range, or null for one line."),
  anchorText: z.string().describe("Code copied verbatim from the lines line..lineEnd. It anchors the finding."),
  severity: z.enum(severities),
  category: z.string(),
  body: z.string(),
  evidence: z.string(),
  evidenceStatus: z.enum(evidenceStatuses),
  confidence: z.enum(confidences),
  agent: z.string().nullable().describe("Name of the subagent that found it, or null for the main agent."),
});

export const question = z.object({ text: z.string(), why: z.string() });

export const coverage = z.object({
  read: z.array(z.string()),
  skipped: z.array(z.string()),
  unavailable: z.array(z.string()),
  notChecked: z.array(z.string()),
});

export const reviewResult = z.object({
  summary: z.string().describe("One line."),
  risks: z.array(z.string()),
  questions: z.array(question),
  coverage,
  findings: z.array(finding).max(MAX_FINDINGS),
});

export type Side = Finding["side"];
export type Finding = z.infer<typeof finding>;
export type Question = z.infer<typeof question>;
export type Coverage = z.infer<typeof coverage>;
export type ReviewResult = z.infer<typeof reviewResult>;

// The CLI checks the schema with a default Ajv instance, which knows draft-07 only. A 2020-12 $schema fails every run.
export const reviewJsonSchema = (): Record<string, unknown> => z.toJSONSchema(reviewResult, { target: "draft-07" });

// ---------- Reply drafts (plan replies.md WP17) ----------

export const replyActions = ["reply", "none"] as const;
export const MAX_REPLY_THREADS = 25;
// docs/plans/fix-ux.md: valid and partly tick a thread in the Fix list at the start.
// valid to question: the user answers a point of another person. settled to followup: the user made the point or asked the question.
export const judgements = ["valid", "partly", "invalid", "question", "settled", "unsettled", "followup"] as const;
export type Judgement = (typeof judgements)[number];

export const replyDraft = z.object({
  thread: lineNo.describe("A thread number from the Threads line."),
  action: z.enum(replyActions).describe("reply: the user should answer. none: the thread needs no answer from the user."),
  body: z.string().describe("The reply as short Markdown in the user's voice. Empty for none."),
  reason: z.string().describe("One line: why this reply, or why no reply."),
  evidenceStatus: z.enum(evidenceStatuses),
  judgement: z
    .enum(judgements)
    .nullable()
    .describe(
      "For a point or question of another person: valid: the review point is right. partly: only a part of it is right. invalid: the code is right as it is. question: the newest message asks a question. For a point or question of the user: settled: the code or the answers settle it. unsettled: a part is still missing. followup: the user asks a new question. null: the newest message asks for no change and asks no question.",
    ),
  // The defaults keep results without these keys valid. --json-schema still lists them as required.
  resolve: z
    .boolean()
    .default(false)
    .describe(
      "true: the code at the head commit or the answer in the thread settles the review point, so the thread can be resolved. Only with judgement settled.",
    ),
  resolveEvidence: z
    .string()
    .default("")
    .describe("For resolve true: the proof in one line, such as path:line at the head commit or the message that settles it. Else empty."),
});

export const replyResult = z.object({
  summary: z.string().describe("One line."),
  replies: z.array(replyDraft).max(MAX_REPLY_THREADS),
  coverage,
});

export type ReplyDraft = z.infer<typeof replyDraft>;
export type ReplyResult = z.infer<typeof replyResult>;
// review: a review run. reply: a reply run. fix: a "Fixed in" draft. nofix: the reply of a fix note without a fix. session: an import of
// your session. resolve: a resolve proposal without a reply. user: a draft that the user wrote or declined a fix with.
export const replyOrigins = ["review", "reply", "fix", "nofix", "session", "resolve", "user"] as const;
export type ReplyOrigin = (typeof replyOrigins)[number];
// replyTo: the message that the reply answers. The post uses it as the parent.
// judgement: absent in drafts stored before Release 3. Read it as null.
// fix: a "Fixed in" reply. It posts only when the PR commits hold the commit (plan r3). replaced: the drafts that the commit
// discarded. Undo brings them back.
// resolve, resolveEvidence: the proposal to resolve the thread. Absent in drafts stored before it existed.
// resolveTick: the user's choice to resolve the thread after the post. Only a ticked draft resolves.
// threadOpen: the thread was open when the app stored the draft. Absent in drafts stored before it existed.
// origin: the writer of the draft (docs/plans/thread-outcome.md). Absent in drafts stored before it existed.
// declined: the fix run whose proposal the user declined with this draft, else null.
export type ReplyPayload = Omit<ReplyDraft, "judgement" | "resolve" | "resolveEvidence"> & {
  judgement?: Judgement | null;
  replyTo: number;
  fix?: { id: number; commit: string; replaced?: number[] };
  resolve?: boolean;
  resolveEvidence?: string;
  resolveTick?: boolean;
  threadOpen?: boolean;
  origin?: ReplyOrigin;
  declined?: { run: number } | null;
};

export const replyJsonSchema = (): Record<string, unknown> => z.toJSONSchema(replyResult, { target: "draft-07" });

// ---------- Fix runs (plan r3) ----------

export const MAX_FIX_EDITS = 50;
// The UTF-8 bytes of all old and new texts of one fix result.
export const MAX_FIX_BYTES = 200_000;
export const MAX_EDIT_TEXT = 20_000;

// docs/plans/fix-ux.md WP3: each note and each edit names exactly one thread or one finding. validateFix checks it.
const fixTarget = {
  thread: lineNo.optional().describe("A thread number from the Fix threads line. Leave it out for a finding."),
  finding: lineNo.optional().describe("A finding ID from the Fix findings line. Leave it out for a thread."),
};

export const fixEdit = z.object({
  ...fixTarget,
  path: z.string().describe("File path relative to the repository root, with / separators."),
  old: z
    .string()
    .max(MAX_EDIT_TEXT)
    .describe("Text copied verbatim from the file at the head commit. It must match exactly one place. Empty only for a new file."),
  new: z.string().max(MAX_EDIT_TEXT).describe("The text that replaces old."),
});

// docs/plans/thread-outcome.md: why a note gives no fix. The app adds "dropped" when validateFix drops every edit of a note.
export const fixWhys = ["already", "invalid", "scope", "decision", "risk", "unclear"] as const;
export type FixWhy = (typeof fixWhys)[number] | "dropped";

export const fixThread = z.object({
  ...fixTarget,
  fixed: z.boolean().describe("true: the edits of this thread or finding fix the review point."),
  reason: z.string().describe("One line: what the edits change, or why there is no fix."),
  // The defaults keep notes stored before these keys valid. --json-schema still lists them as required.
  why: z
    .enum(fixWhys)
    .nullable()
    .default(null)
    .describe(
      "For fixed false: already: the code already does what the comment asks. invalid: the review point is wrong. scope: the change belongs outside this pull request. decision: the user must choose between options. risk: the fix can break other code. unclear: the comment does not say what to change. null for fixed true.",
    ),
  reply: z
    .string()
    .default("")
    .describe("For fixed false on a thread: the reply to the thread as short Markdown in the user's voice. Else empty."),
});

export const fixResult = z.object({
  summary: z.string().describe("One line."),
  threads: z.array(fixThread).max(MAX_REPLY_THREADS).describe("One entry per thread and per finding."),
  edits: z.array(fixEdit).max(MAX_FIX_EDITS),
  coverage,
});

export type FixEdit = z.infer<typeof fixEdit>;
export type FixThread = z.infer<typeof fixThread>;
// A stored note. Only the app sets why to "dropped".
export type FixNote = Omit<FixThread, "why"> & { why: FixWhy | null };
export type FixResult = z.infer<typeof fixResult>;

export const fixJsonSchema = (): Record<string, unknown> => z.toJSONSchema(fixResult, { target: "draft-07" });

const fixNotes = z.array(
  fixThread.extend({
    why: z
      .enum([...fixWhys, "dropped"])
      .nullable()
      .default(null),
  }),
);
// review_run.fix_json. Notes stored before why and reply existed get the defaults.
export const parseFixNotes = (json: string | null): FixNote[] => (json ? fixNotes.parse(JSON.parse(json)) : []);

// The edit rules of every run that proposes edits: the fix agent (catalog.ts) and a session run that proposes fixes (consult.ts).
// edits.ts deniedPath enforces the path rules. workspace.ts sanitize gives the *.untrusted.md names.
export const FIX_EDIT_RULES = [
  "Copy old verbatim from the file in ./repo. old must match exactly one place in the file. Add nearby lines to old when the text occurs more than once.",
  "Leave old empty only for a new file.",
  "Never edit .claude folders, .mcp.json, CLAUDE.md, CLAUDE.local.md, AGENTS.md, .gitmodules, or the sources of git hooks: .githooks, .husky, and the pre-commit, lefthook, lint-staged, and commitlint configs.",
  "./repo shows CLAUDE.md, CLAUDE.local.md, and AGENTS.md as *.untrusted.md files. Never edit them under either name.",
];

// ---------- Re-review (plan r2 S-RR) ----------

export const verdicts = ["open", "fixed", "outdated"] as const;
export type Verdict = (typeof verdicts)[number];

export const earlierVerdict = z.object({
  id: lineNo.describe("An ID from the Earlier findings line."),
  status: z
    .enum(verdicts)
    .describe("open: the problem is still in the code. fixed: the new commits fix it. outdated: the code that it names is gone."),
  reason: z.string().describe("One line."),
  path: z.string().nullable().describe("The current path of an open finding when the file moved, else null."),
  line: lineNo.nullable().describe("The current first line of an open finding when the code moved, else null."),
});

export const MAX_EARLIER = 100;
export const rereviewResult = reviewResult.extend({ earlier: z.array(earlierVerdict).max(MAX_EARLIER) });

export type EarlierVerdict = z.infer<typeof earlierVerdict>;
export type RereviewResult = z.infer<typeof rereviewResult>;

export const rereviewJsonSchema = (): Record<string, unknown> => z.toJSONSchema(rereviewResult, { target: "draft-07" });

// A finding or question that a re-review copied from its base run. from: the source item ID. since: the head that the base run reviewed.
export type Carried = { from: number; verdict: Verdict; reason: string; since: string };

// docs/plans/fix-ux.md decision 3: a fix commit that covers an open finding discards it with this mark. id: the fix_commit ID.
// was: the status before the mark. An undo of the commit and a restore by the user return it. A restore keeps the mark.
export type FixedMark = { id: number; commit: string; short: string; was: "new" | "accepted" };

// docs/plans/session-consult.md part C: the verdict of the session that wrote the code. run: the consult run of the import.
// was: findings only, the status before a reject discarded it. replaced: reply drafts only, the open drafts that it replaced.
// A reject mark lives only while its discard holds: a restore or an undo removes it.
export type SessionMark = {
  run: number;
  verdict: "accept" | "reject" | "question";
  reason: string;
  was?: "new" | "accepted";
  replaced?: { id: number; was: "new" | "accepted" }[];
};

// ---------- Ask (plan r2 S-ASK) ----------

export const MAX_QUESTION = 4000;
export const MAX_ANSWER = 20_000;

export const askResult = z.object({
  answer: z.string().max(MAX_ANSWER).describe("The answer as Markdown."),
  coverage,
});

export type AskResult = z.infer<typeof askResult>;

export const askJsonSchema = (): Record<string, unknown> => z.toJSONSchema(askResult, { target: "draft-07" });

// ---------- Improve prompt ----------

// The server extends prompt with the profile prompt rule of dto.ts. dto.ts imports this module, so this module cannot import it.
export const improveResult = z.object({
  prompt: z.string(),
  reasons: z.array(z.string().trim().min(1)).describe("One short line for each change."),
});

// ---------- Validator output ----------

export type DiffKind = "add" | "del" | "ctx";

// n: the line number on the side of its kind. ctx lines use the number on the finding's side.
// hunk: a ctx line that the diff hunks show. Other ctx lines are outside the diff.
// old: the old-side number of a hunk ctx line on the new side. Bitbucket numbers a CONTEXT anchor on the old side (Gate v3 U4).
export type ExcerptLine = { n: number; kind: DiffKind; text: string; hunk?: true; old?: number };

// exact: the reported range holds the quote. moved: another range holds it. outside: a line of the range is not in the diff.
export type AnchorState = "exact" | "moved" | "outside";

export type Anchor = {
  state: AnchorState;
  // The path in the diff. oldPath is set only for a renamed file.
  path: string;
  oldPath: string | null;
  line: number;
  lineEnd: number;
  excerpt: ExcerptLine[];
};

export type AnchoredFinding = Finding & { anchor: Anchor };

// path: absolute, "..", or outside the snapshot. file: no such file on that side. match: the quote is not in the file.
// size: the file or the range is above the scan limits.
export type DropReason = "path" | "file" | "match" | "size";
export type DroppedFinding = Finding & { reason: DropReason };

export type ValidatedResult = Omit<ReviewResult, "findings"> & { findings: AnchoredFinding[]; dropped: DroppedFinding[] };

// A user move may pick only these lines: the excerpt lines that exist on the finding's side.
export const moveChoices = (excerpt: ExcerptLine[], side: Side): number[] =>
  excerpt.filter((l) => l.kind !== (side === "new" ? "del" : "add")).map((l) => l.n);

// The excerpt line n of the finding's side, if the diff shows it. Excerpts stored without the hunk flag count ctx lines as outside.
export const diffLine = (excerpt: ExcerptLine[], side: Side, n: number): ExcerptLine | undefined =>
  excerpt.find((l) => l.n === n && (l.kind === (side === "new" ? "add" : "del") || (l.kind === "ctx" && l.hunk === true)));
