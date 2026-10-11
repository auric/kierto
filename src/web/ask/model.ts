// Pure Ask rules (plan r2 UI-ASK). No DOM access, so bun test runs them directly.
import type { AskDto, RunKind } from "../../shared/dto";
import { coverageRows, limitText, RUN_TEXT, tokenTotal } from "../review/model";

export type AskView =
  | { kind: "running"; startedAt: number }
  // gaps: the coverage rows other than Read. answer: null only when the server stored no answer.
  | { kind: "answered"; at: number; tokens: number | null; gaps: [string, string[]][]; answer: string | null }
  | { kind: "failed"; text: string; raw: boolean }
  | { kind: "cancelled" };

// A usage limit shows the CLI message and no raw output, as on the run line.
export function askView(a: AskDto, runner: string): AskView {
  const r = a.run;
  switch (r.status) {
    case "running":
      return { kind: "running", startedAt: r.startedAt };
    case "cancelled":
      return { kind: "cancelled" };
    case "failed":
      return r.errorKind === "usage_limit"
        ? { kind: "failed", text: limitText(runner, r.errorText), raw: false }
        : { kind: "failed", text: `${RUN_TEXT.ask.failed} ${r.errorText ?? "No reason was recorded."}`, raw: r.hasRaw };
    default:
      return {
        kind: "answered",
        at: r.finishedAt ?? r.startedAt,
        tokens: tokenTotal(r.usage),
        gaps: r.summary ? coverageRows(r.summary.coverage).filter(([k]) => k !== "Read") : [],
        answer: a.answer,
      };
  }
}

// The fold head: the answer count, and the running ask. One run holds the slot at a time (A14).
export function askCount(asks: AskDto[]): string {
  if (!asks.length) return "";
  return asks.some((a) => a.run.status === "running") ? `${asks.length}, 1 running` : `${asks.length}`;
}

// The note under the box while a run holds the only slot. where: "this pull request" or the PR key. The server still decides.
export const busyText = (runner: string, kind: RunKind, where: string) =>
  `${runner} is ${RUN_TEXT[kind].doing} ${where}. One review runs at a time.`;
