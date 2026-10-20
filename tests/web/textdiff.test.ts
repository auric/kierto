// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// docs/plans/thread-outcome.md: the word diff of a revision against the user's reply text.
import { describe, expect, test } from "bun:test";
import { type DiffLine, wordDiff } from "../../src/web/lib/textdiff";

const show = (d: DiffLine[]) => d.map((l) => `${l.kind === "same" ? "=" : l.kind === "del" ? "-" : "+"}${l.text}`);
const join = (d: DiffLine[], drop: DiffLine["kind"]) =>
  d
    .filter((l) => l.kind !== drop)
    .map((l) => l.text)
    .join("");

describe("wordDiff", () => {
  test("a run of changed words shows as one removal and one addition; equal words split the runs", () => {
    expect(show(wordDiff("Thanks, I will fix it.", "Thanks, I fixed it in abc."))).toEqual([
      "=Thanks, I ",
      "-will fix it.",
      "+fixed it in abc.",
    ]);
    expect(show(wordDiff("Good point. I will add a test today.", "Good point. I added a test in abc."))).toEqual([
      "=Good point. I ",
      "-will add",
      "+added",
      "= a test ",
      "-today.",
      "+in abc.",
    ]);
    expect(show(wordDiff("Same text.", "Same text."))).toEqual(["=Same text."]);
    expect(show(wordDiff("", "New."))).toEqual(["+New."]);
    expect(show(wordDiff("Old.", ""))).toEqual(["-Old."]);
  });

  test("the parts join back to both texts, with line breaks", () => {
    const a = "First line.\n\nSecond  line with   spaces.";
    const b = "First line.\n\nSecond line, changed.\nThird line.";
    const d = wordDiff(a, b);
    expect(join(d, "add")).toBe(a);
    expect(join(d, "del")).toBe(b);
  });
});
