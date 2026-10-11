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

export const replyDraft = z.object({
  thread: lineNo.describe("A thread number from the Threads line."),
  action: z.enum(replyActions).describe("reply: the user should answer. none: the thread needs no answer from the user."),
  body: z.string().describe("The reply as short Markdown in the user's voice. Empty for none."),
  reason: z.string().describe("One line: why this reply, or why no reply."),
  evidenceStatus: z.enum(evidenceStatuses),
});

export const replyResult = z.object({
  summary: z.string().describe("One line."),
  replies: z.array(replyDraft).max(MAX_REPLY_THREADS),
  coverage,
});

export type ReplyDraft = z.infer<typeof replyDraft>;
export type ReplyResult = z.infer<typeof replyResult>;
// replyTo: the message that the reply answers. The post uses it as the parent.
export type ReplyPayload = ReplyDraft & { replyTo: number };

export const replyJsonSchema = (): Record<string, unknown> => z.toJSONSchema(replyResult, { target: "draft-07" });

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

export const rereviewResult = reviewResult.extend({ earlier: z.array(earlierVerdict).max(100) });

export type EarlierVerdict = z.infer<typeof earlierVerdict>;
export type RereviewResult = z.infer<typeof rereviewResult>;

export const rereviewJsonSchema = (): Record<string, unknown> => z.toJSONSchema(rereviewResult, { target: "draft-07" });

// A finding or question that a re-review copied from its base run. from: the source item ID. since: the head that the base run reviewed.
export type Carried = { from: number; verdict: Verdict; reason: string; since: string };

// ---------- Ask (plan r2 S-ASK) ----------

export const MAX_QUESTION = 4000;
export const MAX_ANSWER = 20_000;

export const askResult = z.object({
  answer: z.string().max(MAX_ANSWER).describe("The answer as Markdown."),
  coverage,
});

export type AskResult = z.infer<typeof askResult>;

export const askJsonSchema = (): Record<string, unknown> => z.toJSONSchema(askResult, { target: "draft-07" });

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
