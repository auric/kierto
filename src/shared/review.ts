// Review result (plan v3 WP9). zod parses the CLI output. reviewJsonSchema() feeds --json-schema.
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

// ---------- Validator output ----------

export type DiffKind = "add" | "del" | "ctx";

// n: the line number on the side of its kind. ctx lines use the number on the finding's side.
export type ExcerptLine = { n: number; kind: DiffKind; text: string };

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
