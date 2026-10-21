// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// docs/plans/thread-outcome.md section 11: the stale reasons of a reply draft.
import { describe, expect, test } from "bun:test";
import { type StaleDraft, type StaleThread, staleReasons } from "../../src/shared/stale";
import { newestLive, type TurnMsg } from "../../src/shared/turn";

const draft = (o: Partial<StaleDraft["payload"]> = {}, body = "Thanks.", run: StaleDraft["drafted"] | null = undefined): StaleDraft => ({
  body,
  payload: { replyTo: 11, threadOpen: true, ...o },
  ...(run !== null && { drafted: run ?? { kind: "reply", startedAt: 100, head: "aaa" } }),
});
const thread = (o: Partial<StaleThread> = {}): StaleThread => ({ newest: 11, resolved: false, orphanedAt: null, ...o });
const msg = (id: number, createdAt: number, deleted = false): TurnMsg => ({
  id,
  rootId: 10,
  authorSlug: "alex",
  authorLogin: "alex",
  createdAt,
  deleted,
  threadResolved: false,
});

describe("staleReasons", () => {
  test("a current draft has no reason", () => {
    expect(staleReasons(draft(), thread(), "aaa")).toEqual([]);
  });

  test("out-of-date: a newer live message, a deleted parent, and a thread with every message deleted", () => {
    expect(staleReasons(draft(), thread({ newest: 12 }), "aaa")).toEqual(["out-of-date"]);
    // The parent 11 is deleted, so the root is the newest live message.
    const parentGone = newestLive([msg(10, 1), msg(11, 2, true)])?.id ?? null;
    expect(staleReasons(draft(), thread({ newest: parentGone }), "aaa")).toEqual(["out-of-date"]);
    const allGone = newestLive([msg(10, 1, true), msg(11, 2, true)])?.id ?? null;
    expect(allGone).toBeNull();
    expect(staleReasons(draft(), thread({ newest: allGone }), "aaa")).toEqual(["out-of-date"]);
  });

  test("resolved-since: needs text, threadOpen true, and a resolved thread", () => {
    expect(staleReasons(draft(), thread({ resolved: true }), "aaa")).toEqual(["resolved-since"]);
    expect(staleReasons(draft({}, "  "), thread({ resolved: true }), "aaa")).toEqual([]);
    expect(staleReasons(draft({ threadOpen: false }), thread({ resolved: true }), "aaa")).toEqual([]);
    expect(staleReasons(draft({ threadOpen: undefined }), thread({ resolved: true }), "aaa")).toEqual([]);
    expect(staleReasons(draft(), thread({ newest: 12, resolved: true }), "aaa")).toEqual(["out-of-date", "resolved-since"]);
  });

  test("code-changed: the anchor turned orphaned after the run start, and the PR head moved", () => {
    expect(staleReasons(draft(), thread({ orphanedAt: 200 }), "bbb")).toEqual(["code-changed"]);
    // The same head, an orphan before the run, an unknown head, or no orphan time gives nothing.
    expect(staleReasons(draft(), thread({ orphanedAt: 200 }), "aaa")).toEqual([]);
    expect(staleReasons(draft(), thread({ orphanedAt: 100 }), "bbb")).toEqual([]);
    expect(staleReasons(draft(), thread({ orphanedAt: 200 }), null)).toEqual([]);
    expect(staleReasons(draft(), thread(), "bbb")).toEqual([]);
    // A draft without its run cannot tell.
    expect(staleReasons(draft({}, "Thanks.", null), thread({ orphanedAt: 200 }), "bbb")).toEqual([]);
  });

  test("code-changed: a fix-run draft never gets it", () => {
    expect(
      staleReasons(draft({}, "Fixed in abc.", { kind: "fix", startedAt: 100, head: "aaa" }), thread({ orphanedAt: 200 }), "bbb"),
    ).toEqual([]);
    for (const kind of ["review", "session"] as const)
      expect(staleReasons(draft({}, "Thanks.", { kind, startedAt: 100, head: "aaa" }), thread({ orphanedAt: 200 }), "bbb")).toEqual([
        "code-changed",
      ]);
  });

  test("code-changed: a touch after the orphan time clears it, a touch before does not", () => {
    expect(staleReasons(draft({ touchedAt: 300 }), thread({ orphanedAt: 200 }), "bbb")).toEqual([]);
    expect(staleReasons(draft({ touchedAt: 200 }), thread({ orphanedAt: 200 }), "bbb")).toEqual([]);
    expect(staleReasons(draft({ touchedAt: 150 }), thread({ orphanedAt: 200 }), "bbb")).toEqual(["code-changed"]);
  });

  test("all three reasons come in block order", () => {
    expect(staleReasons(draft(), { newest: null, resolved: true, orphanedAt: 200 }, "bbb")).toEqual([
      "out-of-date",
      "resolved-since",
      "code-changed",
    ]);
  });
});
