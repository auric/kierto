import { describe, expect, test } from "bun:test";
import type { CommentDto, ExcerptLine } from "../../src/shared/dto";
import {
  anchorOf,
  buildThreads,
  fnv1a,
  hueOf,
  type Li,
  layout,
  mergeHighlights,
  names,
  newMessages,
  ordered,
  reveal,
  shownThreads,
  splitExcerpt,
  summary,
  type ThreadModel,
  turnText,
  visitText,
} from "../../src/web/pr/threads";

const c = (id: number, o: Partial<CommentDto> = {}): CommentDto => ({
  id,
  version: 0,
  parentId: null,
  rootId: id,
  authorSlug: "other",
  authorName: null,
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
// A reply to parent in the thread of root.
const r = (id: number, parent: number, root: number, authorSlug: string, o: Partial<CommentDto> = {}) =>
  c(id, { parentId: parent, rootId: root, authorSlug, ...o });
const none = new Set<number>();
const PR = { role: "REVIEWER" as const, authorSlug: "lena", authorName: "Lena Park" };
const build = (list: CommentDto[], hl: ReadonlySet<number> = none) => buildThreads(list, hl, "me", PR);
const one = (list: CommentDto[], hl: ReadonlySet<number> = none): ThreadModel => {
  const [t] = build(list, hl);
  if (!t) throw new Error("no thread");
  return t;
};
const closed = { spine: false, branches: none };

// The rendered tree as text: "id" for a message, "q" after a quoted one, "[fold]" for a closed fold row, children in parentheses.
function shape(lis: Li[]): string {
  return lis
    .map((li) => {
      const head = li.fold && !li.msg ? `[${li.fold.kind}]` : `${li.fold ? "^" : ""}${li.msg?.id}${li.quote ? "q" : ""}`;
      return li.kids.length ? `${head}(${shape(li.kids)})` : head;
    })
    .join(" ");
}

// A linear chain: 10 by me, then 11 to 15, each a reply to the one before, alternating lena and me.
const chain = () => [c(10, { authorSlug: "me" }), ...[11, 12, 13, 14, 15].map((id) => r(id, id - 1, 10, id % 2 ? "lena" : "me"))];

describe("threads and turn order", () => {
  const list = [
    c(1, { authorSlug: "dan", authorName: "Dan Ruiz" }),
    c(2, { authorSlug: "me" }),
    r(3, 2, 2, "lena"),
    c(4, { authorSlug: "me" }),
    c(5, { authorSlug: "dan", threadResolved: true }),
    c(6, { authorSlug: "me" }),
    r(7, 6, 6, "dan"),
  ];

  test("your turn, waiting, others, then resolved, newest first in each group", () => {
    expect(ordered(build(list), false).map((t) => [t.id, t.turn])).toEqual([
      [6, "your"],
      [2, "your"],
      [4, "wait"],
      [1, "other"],
      [5, "resolved"],
    ]);
  });

  test("the filter keeps your turn and new messages; resolved threads hide behind their button", () => {
    const threads = build(list, new Set([1]));
    expect(ordered(threads, true).map((t) => t.id)).toEqual([6, 2, 1]);
    expect(shownThreads(threads, false, false).map((t) => t.id)).toEqual([6, 2, 4, 1]);
    expect(shownThreads(threads, false, true).map((t) => t.id)).toEqual([6, 2, 4, 1, 5]);
  });

  test("turn words name the person: the newest other author, else the PR author", () => {
    const byId = new Map(build(list).map((t) => [t.id, t]));
    const text = (id: number) => {
      const t = byId.get(id);
      return t ? turnText(t) : null;
    };
    expect(text(2)).toBe("Your turn");
    expect(text(4)).toBe("Waiting on Lena");
    expect(text(1)).toBe("Between Dan");
    expect(text(5)).toBe("Resolved");
    expect(turnText(one([c(1, { authorSlug: "me" }), r(2, 1, 1, "kito", { authorName: "Kenji Ito" }), r(3, 2, 1, "me")]))).toBe(
      "Waiting on Kenji",
    );
  });

  test("the summary counts your turns, unresolved threads, and open tasks", () => {
    const tasks = [c(8, { task: "open" }), c(9, { task: "done" }), c(10, { task: "open", deleted: true, text: null })];
    expect(summary(build([...list, ...tasks]))).toEqual({ your: 2, unresolved: 7, tasks: 1 });
  });

  test("the new count and the open default follow the highlights, not the read state", () => {
    const [read, fresh] = build([c(1), c(2)], new Set([2]));
    expect([read?.fresh, read?.open]).toEqual([0, false]);
    expect([fresh?.fresh, fresh?.open]).toEqual([1, true]);
    expect(one([c(1, { authorSlug: "me" }), r(2, 1, 1, "lena")]).open).toBe(true);
  });
});

describe("reply tree", () => {
  test("replies under a deleted parent stay under the placeholder (A5)", () => {
    const t = one([c(1, { deleted: true, text: null }), r(2, 1, 1, "lena", { unread: true }), r(3, 2, 1, "dan")]);
    expect(t.root).toMatchObject({ id: 1, deleted: true, text: null });
    expect(shape(layout(t, closed))).toBe("1(2(3))");
  });

  test("a reply whose parent is missing hangs under its root", () => {
    const threads = build([c(1), r(5, 4, 1, "lena")]);
    expect(threads.map((t) => t.id)).toEqual([1]);
    expect(shape(layout(threads[0] as ThreadModel, closed))).toBe("1(5)");
  });

  test("a second answer to the same message quotes it; the first does not", () => {
    const t = one([c(30, { authorSlug: "me" }), r(31, 30, 30, "lena"), r(32, 30, 30, "dan")]);
    expect(shape(layout(t, closed))).toBe("30(31 32q)");
  });

  test("levels stop at 4; deeper replies stay at level 4 and quote their parent", () => {
    expect(shape(layout(one(chain()), { spine: true, branches: none }))).toBe("10(^11(12(13 14q 15q)))");
  });

  test("a read main line folds its middle and keeps the root and the newest two", () => {
    const t = one(chain());
    expect(t.fold.get(11)).toEqual({ kind: "spine", n: 3, cont: 14 });
    expect(shape(layout(t, closed))).toBe("10([spine](14q(15)))");
  });

  test("a fold never hides a new message", () => {
    const ids = (lis: Li[]): number[] => lis.flatMap((li) => [...(li.msg ? [li.msg.id] : []), ...ids(li.kids)]);
    for (const fresh of [11, 12, 13, 14, 15]) expect(ids(layout(one(chain(), new Set([fresh])), closed))).toContain(fresh);
    // A new message at 13 keeps 13 to 15. Only 11 and 12 fold.
    expect(one(chain(), new Set([13])).fold.get(11)).toEqual({ kind: "spine", n: 2, cont: 13 });
    expect(one(chain(), new Set([11])).fold.size).toBe(0);
  });

  test("short main lines do not fold", () => {
    expect(one(chain().slice(0, 4)).fold.size).toBe(0);
  });

  test("a read side branch of more than 2 messages folds to one row with its people", () => {
    const side = [c(20, { authorSlug: "me", createdAt: 1 }), r(22, 20, 20, "dan", { createdAt: 2 }), r(23, 22, 20, "me", { createdAt: 3 })];
    const list = [...side, r(24, 23, 20, "dan", { createdAt: 4 }), r(21, 20, 20, "lena", { createdAt: 5 })];
    const t = one(list);
    expect(t.fold.get(22)).toEqual({ kind: "branch" });
    const [root] = layout(t, closed);
    expect(shape(layout(t, closed))).toBe("20([branch] 21q)");
    expect(root?.kids[0]?.fold).toMatchObject({ kind: "branch", count: 3, newest: 4 });
    expect(names(root?.kids[0]?.fold?.kind === "branch" ? root.kids[0].fold.people : [])).toBe("Dan and you");
    expect(shape(layout(t, { spine: false, branches: new Set([22]) }))).toBe("20(^22(23(24)) 21q)");
    // A new message in the branch keeps it open.
    expect(one(list, new Set([23])).fold.size).toBe(0);
  });

  test("reveal opens each fold that hides a message", () => {
    expect(reveal(one(chain()), 12)).toEqual({ spine: true, branches: [] });
    expect(reveal(one(chain()), 15)).toEqual({ spine: false, branches: [] });
    const t = one(
      [c(20, { authorSlug: "me", createdAt: 1 }), r(22, 20, 20, "dan", { createdAt: 2 }), r(23, 22, 20, "me", { createdAt: 3 })].concat([
        r(24, 23, 20, "dan", { createdAt: 4 }),
        r(21, 20, 20, "lena", { createdAt: 5 }),
      ]),
    );
    expect(reveal(t, 24)).toEqual({ spine: false, branches: [22] });
  });

  test("new messages come in thread order, then tree order", () => {
    const list = [c(1, { authorSlug: "dan" }), c(2, { authorSlug: "me" }), r(3, 2, 2, "lena"), r(4, 1, 1, "lena")];
    expect(newMessages(ordered(build(list, new Set([1, 3, 4])), false))).toEqual([
      [2, 3],
      [1, 1],
      [1, 4],
    ]);
  });
});

describe("helpers", () => {
  test("FNV-1a gives the reference values, and the hue is one of 8 slots", () => {
    expect(fnv1a("")).toBe(0x811c9dc5);
    expect(fnv1a("a")).toBe(0xe40c292c);
    expect(fnv1a("foobar")).toBe(0xbf9cf968);
    expect(hueOf("a")).toBe(4);
    for (const s of ["lena", "mira", "dan", "kito"]) expect(hueOf(s)).toBe(fnv1a(s) % 8);
  });

  test("names put others first and you last", () => {
    const p = (slug: string, name: string, me = false) => ({ slug, name, me });
    expect(names([p("dan", "Dan Ruiz"), p("me", "Jordan Doe", true), p("lena", "Lena Park")])).toBe("Dan, Lena, and you");
    expect(names([p("me", "Jordan Doe", true), p("lena", "Lena Park")])).toBe("Lena and you");
  });

  test("the last visit reads today, yesterday, or a date", () => {
    const now = new Date(2026, 9, 10, 14, 32).getTime();
    expect(visitText(new Date(2026, 9, 10, 9, 5).getTime(), now)).toBe("today 09:05");
    expect(visitText(new Date(2026, 9, 9, 18, 40).getTime(), now)).toBe("yesterday 18:40");
    const old = new Date(2026, 9, 2, 7, 0);
    expect(visitText(old.getTime(), now)).toBe(`${old.toLocaleDateString(undefined, { day: "numeric", month: "short" })} 07:00`);
  });

  test("an excerpt splits after the last commented line", () => {
    const l = (n: number, hit = false): ExcerptLine => ({ n, kind: "ctx", text: `line ${n}`, hit });
    expect(splitExcerpt([l(1), l(2, true), l(3, true), l(4)])).toEqual({ head: [l(1), l(2, true), l(3, true)], tail: [l(4)] });
    expect(splitExcerpt([l(1), l(2)])).toEqual({ head: [l(1), l(2)], tail: [] });
  });

  test("highlights keep the set captured at open and add new unread messages", () => {
    const open = mergeHighlights(none, [c(1, { unread: true }), c(2)]);
    expect([...open]).toEqual([1]);
    const read = mergeHighlights(open, [c(1), c(2)]);
    expect(read).toBe(open);
    expect([...mergeHighlights(read, [c(1), c(2), c(3, { unread: true })])]).toEqual([1, 3]);
  });

  test("anchors", () => {
    expect(anchorOf(c(1, { anchor: { path: "src/a.ts", line: 4, orphaned: true } }))).toEqual({
      path: "src/a.ts",
      line: 4,
      lineEnd: 4,
      orphaned: true,
    });
    // Gate A U2: a range anchor gives the span on the new side, not its end line 10.
    const range = {
      path: "sample1.md",
      line: 10,
      lineType: "CONTEXT",
      fileType: "FROM",
      multilineSpan: { srcSpanStart: 3, srcSpanEnd: 10, dstSpanStart: 3, dstSpanEnd: 12 },
    };
    expect(anchorOf(c(3, { anchor: range }))).toMatchObject({ line: 3, lineEnd: 12 });
    expect(anchorOf(c(1))).toBeNull();
    // Gate v3 U4: the forge line of a CONTEXT anchor is old line 7. The excerpt marks new line 9, so the thread shows 9.
    const ctx = { path: "sample1.md", line: 7, lineType: "CONTEXT", fileType: "TO" };
    const hit: ExcerptLine = { n: 9, kind: "ctx", text: "x", hit: true };
    expect(anchorOf(c(2, { anchor: ctx, excerpt: [hit] }))?.line).toBe(9);
    // Without the excerpt, the new line is unknown. A FROM anchor and an ADDED anchor keep their own line.
    expect(anchorOf(c(2, { anchor: ctx }))).toMatchObject({ path: "sample1.md", line: undefined });
    expect(anchorOf(c(2, { anchor: { ...ctx, fileType: "FROM" } }))?.line).toBe(7);
    expect(anchorOf(c(2, { anchor: { ...ctx, lineType: "ADDED" } }))?.line).toBe(7);
  });
});
