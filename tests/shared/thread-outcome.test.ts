// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// docs/plans/thread-outcome.md WP-C: the fix note fields why and reply, and the fix decline input.
import { describe, expect, test } from "bun:test";
import { fixDeclineInput } from "../../src/shared/dto";
import { fixJsonSchema, fixResult, fixWhys, parseFixNotes } from "../../src/shared/review";

const coverage = { read: [], skipped: [], unavailable: [], notChecked: [] };

describe("fix notes", () => {
  test("a fix_json row stored before why and reply parses with the defaults", () => {
    const old = JSON.stringify([
      { thread: 7, fixed: true, reason: "Adds the null check." },
      { finding: 3, fixed: false, reason: "The code is already right." },
    ]);
    expect(parseFixNotes(old)).toEqual([
      { thread: 7, fixed: true, reason: "Adds the null check.", why: null, reply: "" },
      { finding: 3, fixed: false, reason: "The code is already right.", why: null, reply: "" },
    ]);
    expect(parseFixNotes(null)).toEqual([]);
  });

  test("the app-only why dropped parses from storage but not from the CLI", () => {
    const note = { thread: 7, fixed: true, reason: "x", why: "dropped", reply: "" };
    expect(parseFixNotes(JSON.stringify([note]))[0]?.why).toBe("dropped");
    expect(fixResult.safeParse({ summary: "s", threads: [note], edits: [], coverage }).success).toBe(false);
  });

  test("a CLI result without why and reply still parses", () => {
    const r = fixResult.parse({ summary: "s", threads: [{ thread: 7, fixed: false, reason: "r" }], edits: [], coverage });
    expect(r.threads[0]).toEqual({ thread: 7, fixed: false, reason: "r", why: null, reply: "" });
  });

  test("the CLI schema stays draft-07 and requires why and reply", () => {
    const s = fixJsonSchema() as {
      $schema: string;
      properties: { threads: { items: { required: string[]; properties: Record<string, { anyOf?: { enum?: string[] }[] }> } } };
    };
    expect(s.$schema).toBe("http://json-schema.org/draft-07/schema#");
    const item = s.properties.threads.items;
    expect(item.required).toEqual(expect.arrayContaining(["fixed", "reason", "why", "reply"]));
    expect(item.properties.why?.anyOf?.[0]?.enum).toEqual([...fixWhys]);
    expect(JSON.stringify(s)).not.toContain("dropped");
  });
});

describe("fix decline input", () => {
  test("names exactly one thread or one finding and needs a reason", () => {
    expect(fixDeclineInput.safeParse({ run: 1, thread: 7, reason: "Out of scope." }).success).toBe(true);
    expect(fixDeclineInput.safeParse({ run: 1, finding: 3, reason: "Out of scope." }).success).toBe(true);
    expect(fixDeclineInput.safeParse({ run: 1, thread: 7, finding: 3, reason: "x" }).success).toBe(false);
    expect(fixDeclineInput.safeParse({ run: 1, reason: "x" }).success).toBe(false);
    expect(fixDeclineInput.safeParse({ run: 1, thread: 7, reason: "  " }).success).toBe(false);
  });
});
