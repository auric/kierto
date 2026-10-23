// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// docs/plans/review-v2/spec.md section 7.1, AC-UX2: no text of the task screens says "slice", "stack", "gate", "verdict", "candidate",
// "phase", "module", or "idem". The scan reads the source of src/web/tasks without its comments.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "../../src/web/tasks");
// A word after "." is a method of the code, such as Array.slice.
const WORDS = /(?<!\.)\b(slices?|stacks?|stacked|gates?|verdicts?|candidates?|phases?|modules?|idem)\b/gi;

// Removes // and /* */ comments. A "//" inside a string, such as a URL, does not occur in these files.
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

export function words(text: string): string[] {
  return [...code(text).matchAll(WORDS)].map((m) => m[0]);
}

describe("plain words on the task screens (AC-UX2)", () => {
  test("the scan finds a word in a string and skips comments", () => {
    expect(words('const a = "Open the stack"; // the gate\n/* phase */ <p>Verdict</p> b.slice(1)')).toEqual(["stack", "Verdict"]);
  });

  test("no file in src/web/tasks shows a forbidden word", () => {
    const files = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(8);
    const found = files.flatMap((f) => words(readFileSync(join(DIR, f), "utf8")).map((w) => `${f}: ${w}`));
    expect(found).toEqual([]);
  });
});
