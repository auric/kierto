// Plan r2 UI-ASK: the pure Ask rules. The state of each answer, the fold count, and the busy note.
import { describe, expect, test } from "bun:test";
import type { AskDto, RunDto } from "../../src/shared/dto";
import { askCount, askView, busyText } from "../../src/web/ask/model";

const run = (o: Partial<RunDto> = {}): RunDto => ({
  id: 1,
  pr: 7,
  kind: "ask",
  profile: "general",
  profileName: "General",
  explain: false,
  note: "",
  status: "completed",
  errorKind: null,
  errorText: null,
  sourceHead: "a".repeat(40),
  targetHead: "b".repeat(40),
  mergeBase: "c".repeat(40),
  via: "pull-request-ref",
  sessionId: null,
  cliVersion: "2.1.295",
  model: "m",
  effort: null,
  effortDefault: null,
  usage: { costUsd: 0, turns: 3, durationMs: 9000, tokens: { input_tokens: 1200, output_tokens: 300 } },
  summary: {
    summary: "flush() has two callers.",
    risks: [],
    coverage: { read: ["src/a.ts"], skipped: [], unavailable: [], notChecked: [] },
    dropped: [],
  },
  startedAt: 1_000,
  finishedAt: 61_000,
  stale: null,
  hasRaw: true,
  since: null,
  question: "Which callers of flush() are not updated?",
  findings: 0,
  ...o,
});
const ask = (o: Partial<RunDto> = {}, answer: string | null = "flush() has two callers.\n\nBoth are updated."): AskDto => ({
  run: run(o),
  answer,
});

describe("ask", () => {
  test("a finished answer has its time, its tokens, and only the coverage gaps", () => {
    expect(askView(ask(), "Claude Code")).toEqual({
      kind: "answered",
      at: 61_000,
      tokens: 1500,
      gaps: [],
      answer: "flush() has two callers.\n\nBoth are updated.",
    });
    const gaps = ask({
      status: "incomplete",
      summary: {
        summary: "x",
        risks: [],
        coverage: {
          read: ["src/a.ts"],
          skipped: ["src/big.ts: above the read limit"],
          unavailable: ["MCP server git: failed"],
          notChecked: [],
        },
        dropped: [],
      },
    });
    expect(askView(gaps, "Claude Code")).toMatchObject({
      kind: "answered",
      gaps: [
        ["Skipped", ["src/big.ts: above the read limit"]],
        ["Unavailable", ["MCP server git: failed"]],
      ],
    });
  });

  test("a failed ask names the question, a usage limit shows the CLI message without raw output", () => {
    expect(askView(ask({ status: "failed", errorKind: "schema", errorText: "Bad shape." }, null), "Claude Code")).toEqual({
      kind: "failed",
      text: "The question failed. Bad shape.",
      raw: true,
    });
    expect(askView(ask({ status: "failed", errorKind: "process", errorText: null, hasRaw: false }, null), "Claude Code")).toEqual({
      kind: "failed",
      text: "The question failed. No reason was recorded.",
      raw: false,
    });
    expect(askView(ask({ status: "failed", errorKind: "usage_limit", errorText: "Resets at 6pm." }, null), "Claude Code")).toEqual({
      kind: "failed",
      text: "Claude Code: Resets at 6pm. Review Loop does not retry by itself.",
      raw: false,
    });
  });

  test("a running and a cancelled ask", () => {
    expect(askView(ask({ status: "running", finishedAt: null }, null), "Claude Code")).toEqual({ kind: "running", startedAt: 1_000 });
    expect(askView(ask({ status: "cancelled" }, null), "Claude Code")).toEqual({ kind: "cancelled" });
  });

  test("the fold head counts the answers and names the running one", () => {
    expect(askCount([])).toBe("");
    expect(askCount([ask(), ask({ id: 2 })])).toBe("2");
    expect(askCount([ask({ id: 3, status: "running" }), ask()])).toBe("2, 1 running");
  });

  test("the busy note names what holds the slot, never a review for an ask", () => {
    expect(busyText("Claude", "ask", "this pull request")).toBe(
      "Claude is answering a question on this pull request. One review runs at a time.",
    );
    expect(busyText("Claude", "review", "PROJ/repo #12")).toBe("Claude is reviewing PROJ/repo #12. One review runs at a time.");
    expect(busyText("Claude", "reply", "PROJ/repo #12")).toBe("Claude is drafting replies for PROJ/repo #12. One review runs at a time.");
  });
});
