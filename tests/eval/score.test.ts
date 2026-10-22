// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// docs/plans/review-v2 AC-M1: the eval scorer gives the documented numbers on a hand-made result. No process, no file.
import { describe, expect, test } from "bun:test";
import { compareText, summaryText } from "../../scripts/eval/compare";
import { type CaseRun, displayGroup, type EvalItem, type EvalResult, overlaps, score } from "../../scripts/eval/score";

const item = (o: Partial<EvalItem> & Pick<EvalItem, "path" | "side" | "line" | "lineEnd">): EvalItem => ({
  anchorState: "exact",
  severity: "minor",
  finderSeverity: o.severity ?? "minor",
  verdict: null,
  check: null,
  group: "main",
  status: "new",
  title: "",
  body: "A finding.",
  category: "logic",
  module: null,
  trigger: null,
  confidence: "high",
  evidenceStatus: "code",
  agent: null,
  ...o,
});

const run = (c: string, repeat: number, items: EvalItem[], o: Partial<CaseRun> = {}): CaseRun => ({
  case: c,
  repeat,
  run: 1,
  status: "completed",
  errorKind: null,
  error: null,
  model: "claude-test",
  effort: "default",
  effortDefault: null,
  startedAt: 0,
  finishedAt: 0,
  minutes: 1,
  usage: null,
  items,
  dropped: [],
  questions: 0,
  ...o,
});

const usage = (costUsd: number) => ({ costUsd, turns: 3, durationMs: 1000, tokens: {} });

// Case a: bugs at a.ts:10-12 (major) and a.ts:30 (minor), a trap at a.ts:50-55.
// Case b: a bug on the old side of b.py:5-8 (minor), traps at b.py:20 and b.py:40-41.
// Each boundary item touches its bug range at exactly one line.
const RESULT: EvalResult = {
  format: 1,
  createdAt: "2026-10-22T00:00:00.000Z",
  commit: "abc",
  dirty: false,
  promptVersion: "1",
  cliVersion: "2.1.295",
  runner: "fake",
  profile: { id: "general", name: "General", revision: "0123456789" },
  volume: null,
  repeat: 2,
  cases: [
    {
      id: "a",
      title: "Case a",
      language: "typescript",
      changedLines: 200,
      base: "b1",
      head: "h1",
      bugs: [
        { id: "B1", path: "a.ts", side: "new", lines: [10, 12], severityMin: "major", module: "core", note: "n" },
        { id: "B2", path: "a.ts", side: "new", lines: [30, 30], severityMin: "minor", module: "core", note: "n" },
      ],
      traps: [{ id: "T1", path: "a.ts", side: "new", lines: [50, 55], why: "w" }],
    },
    {
      id: "b",
      title: "Case b",
      language: "python",
      changedLines: 180,
      base: "b2",
      head: "h2",
      bugs: [{ id: "B1", path: "b.py", side: "old", lines: [5, 8], severityMin: "minor", module: "core", note: "n" }],
      traps: [
        { id: "T1", path: "b.py", side: "new", lines: [20, 20], why: "w" },
        { id: "T2", path: "b.py", side: "new", lines: [40, 41], why: "w" },
      ],
    },
  ],
  runs: [
    run(
      "a",
      1,
      [
        item({ path: "a.ts", side: "new", line: 12, lineEnd: 14, severity: "major" }),
        item({ path: "a.ts", side: "new", line: 52, lineEnd: 52 }),
        item({ path: "a.ts", side: "new", line: 70, lineEnd: 70, severity: "nit" }),
        item({ path: "a.ts", side: "new", line: 30, lineEnd: 30, verdict: "refuted", check: "unchecked", group: "hidden" }),
      ],
      { minutes: 4, usage: usage(0.5) },
    ),
    run(
      "b",
      1,
      [
        item({ path: "b.py", side: "old", line: 8, lineEnd: 8, severity: "nit" }),
        item({ path: "b.py", side: "new", line: 5, lineEnd: 8, severity: "major" }),
      ],
      { minutes: 6, usage: usage(1.5) },
    ),
    run(
      "a",
      2,
      [
        item({ path: "a.ts", side: "new", line: 9, lineEnd: 9, severity: "blocker" }),
        item({ path: "a.ts", side: "new", line: 29, lineEnd: 30 }),
      ],
      { minutes: 8, usage: usage(0.7) },
    ),
    run("b", 2, [], { status: "failed", minutes: 1 }),
  ],
};

describe("eval score (AC-M1)", () => {
  test("ranges overlap with both ends inclusive", () => {
    expect(overlaps([1, 3], [3, 5])).toBe(true);
    expect(overlaps([3, 5], [1, 3])).toBe(true);
    expect(overlaps([4, 4], [4, 4])).toBe(true);
    expect(overlaps([1, 2], [3, 4])).toBe(false);
  });

  test("suite numbers pool the cases of each repeat, then give mean, min, and max", () => {
    const s = score(RESULT).suite;
    // Repeat 1: 2 of 3 bugs found, 2 of 5 shown items match, 1 trap hit of 3 traps, 2 noise items in 2 cases.
    // Repeat 2: 1 of 3 bugs found, 1 of 2 shown items match, no trap hit, 1 noise item, case b failed.
    expect(s.recall).toEqual({ mean: 0.5, min: 1 / 3, max: 2 / 3 });
    expect(s.precision?.mean).toBeCloseTo(0.45, 10);
    expect(s.precision).toMatchObject({ min: 0.4, max: 0.5 });
    expect(s.trapRate?.mean).toBeCloseTo(1 / 6, 10);
    expect(s.trapRate).toMatchObject({ min: 0, max: 1 / 3 });
    expect(s.noise).toEqual({ mean: 0.75, min: 0.5, max: 1 });
    expect(s.severityOk).toEqual({ mean: 0.75, min: 0.5, max: 1 });
    // The refuted item of repeat 1 still counts as a candidate for bug a/B2.
    expect(s.candidateRecall?.mean).toBeCloseTo(2 / 3, 10);
    expect(s.candidateRecall).toMatchObject({ min: 1 / 3, max: 1 });
    expect(s.minutes).toEqual({ mean: 4.75, min: 4.5, max: 5 });
    expect(s.costUsd?.mean).toBeCloseTo(0.85, 10);
    expect(s.notCompleted).toEqual({ mean: 0.5, min: 0, max: 1 });
  });

  test("case numbers use the repeats of that case", () => {
    const { a, b } = score(RESULT).cases;
    expect(a?.recall).toEqual({ mean: 0.5, min: 0.5, max: 0.5 });
    expect(a?.precision?.mean).toBeCloseTo(5 / 12, 10);
    expect(a?.candidateRecall).toEqual({ mean: 0.75, min: 0.5, max: 1 });
    expect(b?.recall).toEqual({ mean: 0.5, min: 0, max: 1 });
    // The failed repeat shows nothing, so it gives no precision and no severity number.
    expect(b?.precision).toEqual({ mean: 0.5, min: 0.5, max: 0.5 });
    expect(b?.severityOk).toEqual({ mean: 0, min: 0, max: 0 });
    expect(b?.costUsd).toEqual({ mean: 1.5, min: 1.5, max: 1.5 });
  });

  test("compare prints a table per metric with the delta", () => {
    const better: EvalResult = {
      ...RESULT,
      runs: RESULT.runs.map((r) =>
        r.case === "b" && r.repeat === 2 ? run("b", 2, [item({ path: "b.py", side: "old", line: 5, lineEnd: 5 })]) : r,
      ),
    };
    const text = compareText(RESULT, better);
    expect(text).toContain("recall: seeded bugs with a shown finding");
    // Recall goes from 50.0% to 66.7%: repeat 2 finds b/B1 too.
    expect(text).toMatch(/all cases\s+50\.0% \(33\.3% to 66\.7%\)\s+66\.7%\s+\+16\.7 pts/);
    expect(summaryText(RESULT)).toContain("prompt version 1");
  });
});

describe("display group (spec.md section 1.4)", () => {
  test("prompt version 1 shows every finding", () => {
    expect(displayGroup({ verdict: null, check: null, severity: "nit" }, null)).toBe("main");
    expect(displayGroup({ verdict: null, check: null, severity: "nit" }, "quiet")).toBe("main");
  });

  test("version 2 folds by check, severity, and volume", () => {
    const g = (
      verdict: string | null,
      check: "checked" | "unsure" | "unchecked",
      severity: "blocker" | "major" | "minor" | "nit",
      v: "quiet" | "balanced" | "thorough",
    ) => displayGroup({ verdict, check, severity }, v);
    expect(g("refuted", "unchecked", "major", "thorough")).toBe("hidden");
    expect(g("duplicate", "unchecked", "major", "balanced")).toBe("hidden");
    expect(g("confirmed", "checked", "major", "quiet")).toBe("main");
    expect(g(null, "unchecked", "blocker", "quiet")).toBe("main");
    expect(g("confirmed", "checked", "minor", "quiet")).toBe("fold");
    expect(g("confirmed", "checked", "minor", "balanced")).toBe("main");
    expect(g("confirmed", "checked", "nit", "balanced")).toBe("fold");
    expect(g("unsure", "unsure", "minor", "balanced")).toBe("fold");
    expect(g("unsure", "unsure", "minor", "thorough")).toBe("main");
    expect(g("confirmed", "checked", "nit", "thorough")).toBe("main");
  });
});
