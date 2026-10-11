import { describe, expect, test } from "bun:test";
import { MAX_PATTERN, MAX_TASK_RULES, taskRuleInput } from "../../src/shared/dto";
import {
  ADD_ID,
  change,
  DEFAULT_PATTERN,
  type Draft,
  focusAfter,
  LIMITS,
  parseKeys,
  ruleId,
  ruleProblem,
  sameRules,
  syntaxText,
  toDrafts,
  toRules,
} from "../../src/web/settings/rules";

const stored = [
  { source: "branch" as const, pattern: "A-\\d+", keys: ["ABC", "XYZ"], timedOut: false },
  { source: "title" as const, pattern: "(B)-x", timedOut: true },
  { source: "description" as const, pattern: "C", timedOut: false },
];
const fields = (list: Draft[]) => list.map(({ source, pattern, keys }) => [source, pattern, keys]);

describe("rule editor model", () => {
  test("stored rules become drafts and back without loss", () => {
    const d = toDrafts(stored);
    expect(fields(d)).toEqual([
      ["branch", "A-\\d+", "ABC, XYZ"],
      ["title", "(B)-x", ""],
      ["description", "C", ""],
    ]);
    expect(d[1]?.timedOut).toBe(true);
    expect(toRules(d)).toEqual([
      { source: "branch", pattern: "A-\\d+", keys: ["ABC", "XYZ"] },
      { source: "title", pattern: "(B)-x" },
      { source: "description", pattern: "C" },
    ]);
    expect(sameRules(toRules(d), stored)).toBe(true);
    expect(new Set(d.map((r) => r.id)).size).toBe(3);
  });

  test("keys split on commas and spaces; an empty field means every key", () => {
    expect(parseKeys(" ABC,XYZ  QA ")).toEqual(["ABC", "XYZ", "QA"]);
    expect(parseKeys(" , ")).toBeUndefined();
  });

  test("add appends a title rule with the default pattern, up to the limit", () => {
    const d = change(toDrafts(stored), { act: "add" });
    expect(fields(d).at(-1)).toEqual(["title", DEFAULT_PATTERN, ""]);
    let full = d;
    for (let i = 0; i < 30; i++) full = change(full, { act: "add" });
    expect(full).toHaveLength(LIMITS.rules);
  });

  test("remove, move, and edit keep the other rules and their ids", () => {
    const d = toDrafts(stored);
    expect(fields(change(d, { act: "remove", i: 1 })).map((r) => r[1])).toEqual(["A-\\d+", "C"]);
    const moved = change(d, { act: "move", i: 2, d: -1 });
    expect(moved.map((r) => r.pattern)).toEqual(["A-\\d+", "C", "(B)-x"]);
    expect(moved.map((r) => r.id)).toEqual([0, 2, 1].map((i) => d[i]?.id ?? -1));
    expect(change(d, { act: "move", i: 0, d: -1 })).toBe(d);
    expect(change(d, { act: "move", i: 2, d: 1 })).toBe(d);
    const edited = change(d, { act: "edit", i: 1, patch: { pattern: "(B)-y" } });
    expect(edited[1]).toMatchObject({ id: d[1]?.id, pattern: "(B)-y", timedOut: false });
    expect(sameRules(toRules(edited), stored)).toBe(false);
  });

  test("focus keeps the place after each change", () => {
    expect(focusAfter({ act: "add" }, 4)).toBe(ruleId(3, "pattern"));
    expect(focusAfter({ act: "remove", i: 2 }, 2)).toBe(ruleId(1, "remove"));
    expect(focusAfter({ act: "remove", i: 0 }, 2)).toBe(ruleId(0, "remove"));
    expect(focusAfter({ act: "remove", i: 0 }, 0)).toBe(ADD_ID);
    expect(focusAfter({ act: "move", i: 2, d: -1 }, 3)).toBe(ruleId(1, "up"));
    // At the top the up button is disabled, so focus goes to down.
    expect(focusAfter({ act: "move", i: 1, d: -1 }, 3)).toBe(ruleId(0, "down"));
    expect(focusAfter({ act: "move", i: 0, d: 1 }, 3)).toBe(ruleId(1, "down"));
    expect(focusAfter({ act: "move", i: 1, d: 1 }, 3)).toBe(ruleId(2, "up"));
  });

  test("client problems and server errors read as text", () => {
    const base = toDrafts(stored)[0] as Draft;
    expect(ruleProblem(base)).toBeNull();
    expect(ruleProblem({ ...base, pattern: "" })).toBe("Enter a pattern.");
    expect(ruleProblem({ ...base, pattern: "x".repeat(201) })).toBe("Use 200 characters or fewer.");
    expect(ruleProblem({ ...base, keys: Array.from({ length: 51 }, (_, i) => `K${i}`).join(",") })).toBe("Use 50 keys or fewer.");
    expect(ruleProblem({ ...base, keys: "K".repeat(65) })).toBe("Use keys of 64 characters or fewer.");
    expect(syntaxText("Invalid regular expression: missing )")).toBe("This is not a valid regular expression: missing ).");
  });

  test("the limits match the shared request schema", () => {
    expect(LIMITS.rules).toBe(MAX_TASK_RULES);
    expect(LIMITS.pattern).toBe(MAX_PATTERN);
    const keys = (n: number, len = 3) => Array.from({ length: n }, (_, i) => `${i}`.padStart(len, "K"));
    const ok = (k: string[]) => taskRuleInput.safeParse({ source: "title", pattern: "x", keys: k }).success;
    expect(ok(keys(LIMITS.keys))).toBe(true);
    expect(ok(keys(LIMITS.keys + 1))).toBe(false);
    expect(ok(keys(1, LIMITS.key))).toBe(true);
    expect(ok(keys(1, LIMITS.key + 1))).toBe(false);
  });
});
