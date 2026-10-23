// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// docs/plans/review-v2/spec.md section 2.7: the chip of a linked PR and the "From the thread of" line of a suggestion.
import { describe, expect, test } from "bun:test";
import type { CommentDto } from "../../src/shared/dto";
import { chipText, fromText, THREAD_DELETED } from "../../src/web/pr/notes-model";
import { buildThreads } from "../../src/web/pr/threads";

const own = { project: "PROJ", repo: "repo" };
const c = (id: number, o: Partial<CommentDto> = {}): CommentDto =>
  ({
    id,
    version: 0,
    parentId: null,
    rootId: id,
    authorSlug: "anna",
    authorName: "Anna Kim",
    authorLogin: "anna",
    text: "t",
    createdAt: id,
    updatedAt: id,
    threadResolved: false,
    deleted: false,
    unread: false,
    ...o,
  }) as CommentDto;

describe("notes model", () => {
  test("the chip names the state of the linked PR, and the repository of another one", () => {
    expect(chipText({ ...own, prId: 45, title: "T", state: "OPEN" }, own)).toBe("PR #45 open");
    expect(chipText({ ...own, prId: 45, title: "T", state: "MERGED" }, own)).toBe("PR #45 merged");
    expect(chipText({ ...own, prId: 45, title: "T", state: "DECLINED" }, own)).toBe("PR #45 declined");
    expect(chipText({ ...own, prId: 45, title: null, state: "MISSING" }, own)).toBe("PR #45 not found");
    expect(chipText({ project: "OTHER", repo: "api", prId: 3, title: null, state: null }, own)).toBe("PR OTHER/api#3");
  });

  test("the thread line names the starter and the place; a deleted thread says so", () => {
    const threads = buildThreads(
      [
        c(40, { anchor: { path: "src/build.ts", line: 40, lineType: "ADDED", fileType: "TO" } }),
        c(50, { authorSlug: "jdoe", authorName: "J Doe", authorLogin: "jdoe" }),
        c(60, { deleted: true, text: null as unknown as string }),
      ],
      new Set(),
      "jdoe",
      { role: "REVIEWER", authorSlug: "anna", authorName: "Anna Kim" },
    );
    expect(fromText({ thread: 40 }, threads)).toBe("From the thread of Anna Kim on src/build.ts line 40");
    expect(fromText({ thread: 50 }, threads)).toBe("From your thread");
    expect(fromText({ thread: 60 }, threads)).toBe(THREAD_DELETED);
    expect(fromText({ thread: 99 }, threads)).toBe(THREAD_DELETED);
    expect(fromText({ thread: null }, threads)).toBeNull();
  });
});
