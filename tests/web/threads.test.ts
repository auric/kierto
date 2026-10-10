import { describe, expect, test } from "bun:test";
import type { CommentDto } from "../../src/shared/dto";
import { anchorOf, buildThreads, mergeHighlights, openThreads } from "../../src/web/pr/threads";

const c = (id: number, o: Partial<CommentDto> = {}): CommentDto => ({
  id,
  version: 0,
  parentId: null,
  rootId: id,
  authorSlug: "other",
  authorName: "Other",
  authorLogin: null,
  text: `text ${id}`,
  anchor: null,
  threadResolved: false,
  createdAt: id,
  updatedAt: id,
  unread: false,
  deleted: false,
  ...o,
});
const none = new Set<number>();

describe("buildThreads", () => {
  test("threads sort oldest first by their newest message", () => {
    const list = [c(1), c(2), c(3, { parentId: 1, rootId: 1, createdAt: 30, updatedAt: 30 })];
    expect(buildThreads(list, none, none).map((t) => t.root.id)).toEqual([2, 1]);
  });

  test("a thread without a highlighted message is collapsed", () => {
    const list = [c(1), c(2), c(3, { parentId: 2, rootId: 2 })];
    const t = buildThreads(list, new Set([3]), none);
    expect(t.map((x) => [x.root.id, x.highlighted])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  test("the divider sits above the first thread that had unread messages at open", () => {
    const list = [c(1), c(2), c(3), c(4, { parentId: 1, rootId: 1, createdAt: 4, updatedAt: 4 })];
    // Order: 2, 3, 1 (newest 4). Unread at open: 3 and 4.
    const t = buildThreads(list, new Set([3, 4, 2]), new Set([3, 4]));
    expect(t.map((x) => [x.root.id, x.divider])).toEqual([
      [2, false],
      [3, true],
      [1, false],
    ]);
  });

  test("a new arrival highlights but does not move the divider", () => {
    const t = buildThreads([c(1), c(2)], new Set([1, 2]), new Set([2]));
    expect(t.map((x) => [x.root.id, x.highlighted, x.divider])).toEqual([
      [1, true, false],
      [2, true, true],
    ]);
    expect(buildThreads([c(1)], none, none)[0]?.divider).toBe(false);
  });

  test("replies under a deleted parent stay visible under the placeholder (A5)", () => {
    const list = [c(1, { deleted: true, text: null }), c(2, { parentId: 1, rootId: 1, unread: true }), c(3, { parentId: 2, rootId: 1 })];
    const [t] = buildThreads(list, mergeHighlights(none, list), none);
    expect(t?.root).toMatchObject({ id: 1, deleted: true, text: null });
    expect(t?.root.replies.map((r) => r.id)).toEqual([2]);
    expect(t?.root.replies[0]?.replies.map((r) => r.id)).toEqual([3]);
    expect(t?.highlighted).toBe(true);
  });

  test("a reply whose parent is missing hangs under its root", () => {
    const [t, ...rest] = buildThreads([c(1), c(5, { parentId: 4, rootId: 1 })], none, none);
    expect(rest).toEqual([]);
    expect(t?.root.replies.map((r) => r.id)).toEqual([5]);
  });
});

describe("highlights and helpers", () => {
  test("the captured set stays after read, and new unread messages join it", () => {
    const open = mergeHighlights(none, [c(1, { unread: true }), c(2)]);
    expect([...open]).toEqual([1]);
    const read = mergeHighlights(open, [c(1), c(2)]);
    expect(read).toBe(open);
    expect([...mergeHighlights(read, [c(1), c(2), c(3, { unread: true })])]).toEqual([1, 3]);
  });

  test("anchors and my open threads", () => {
    expect(anchorOf(c(1, { anchor: { path: "src/a.ts", line: 4, orphaned: true } }))).toEqual({
      path: "src/a.ts",
      line: 4,
      orphaned: true,
    });
    expect(anchorOf(c(1))).toBeNull();
    const list = [
      c(1, { authorSlug: "me" }),
      c(2, { authorSlug: "me", threadResolved: true }),
      c(3, { authorSlug: "me", parentId: 1, rootId: 1 }),
      c(4, { authorSlug: "me", deleted: true }),
      c(5),
    ];
    expect(openThreads(list, "me").map((x) => x.id)).toEqual([1]);
  });

  test("my open threads match the username or the slug, ignoring case", () => {
    const list = [c(1, { authorSlug: "jdoe", authorLogin: "J.Doe" }), c(2, { authorSlug: "jdoe" }), c(3)];
    expect(openThreads(list, "j.doe").map((x) => x.id)).toEqual([1]);
    expect(openThreads(list, "JDoe").map((x) => x.id)).toEqual([1, 2]);
  });
});
