// Plan r2 UI-DIFF: the pure diff viewer rules. Thread and draft placement, the gap rows, and the focus targets.
import { describe, expect, test } from "bun:test";
import { parseDiff } from "../../src/server/review/diffmap";
import type { CommentDto, ReviewItemDto } from "../../src/shared/dto";
import {
  DRAFT_OUTSIDE,
  draftItem,
  fileOf,
  hidden,
  type Item,
  offId,
  olderHead,
  place,
  rowId,
  THREAD_OUTDATED,
  targetOf,
  threadItem,
  threadSpot,
} from "../../src/web/diff/model";

// Gate v3 U4 (activities-v3-after-write.json, comment 1000005): the CONTEXT anchor line 7 is the row source 7, destination 9.
const DIFF = [
  "diff --git a/sample1.md b/sample1.md",
  "--- a/sample1.md",
  "+++ b/sample1.md",
  "@@ -4,7 +4,9 @@",
  " line 4",
  " line 5",
  "+added 6",
  "+added 7",
  " line 6",
  " line 7",
  " line 8",
  "-line 9",
  "+changed 11",
  " line 10",
  "@@ -20,2 +22,2 @@",
  " line 20",
  "-line 21",
  "+changed 23",
  "",
].join("\n");
const rows = parseDiff(DIFF)[0]?.rows ?? [];
const at = (side: "old" | "new", n: number) => rows.findIndex((r) => r.kind !== (side === "new" ? "del" : "add") && r[side] === n);

const root = (anchor: unknown, excerpt?: CommentDto["excerpt"]) => ({ id: 5, root: { anchor, excerpt } });
const U4 = { path: "sample1.md", line: 7, lineType: "CONTEXT", fileType: "TO", diffType: "COMMIT", orphaned: false };

const draft = (o: Partial<ReviewItemDto> = {}, anchor: Partial<NonNullable<ReviewItemDto["anchor"]>> = {}): ReviewItemDto => ({
  id: 40,
  run: 3,
  kind: "finding",
  body: "Take the lock once, before the loop.",
  payload: {} as ReviewItemDto["payload"],
  anchor: { state: "exact", path: "sample1.md", oldPath: null, line: 6, lineEnd: 7, excerpt: [], side: "new", ...anchor },
  status: "new",
  revision: 1,
  edited: false,
  ...o,
});

describe("thread lines", () => {
  test("the excerpt hit wins; a ctx hit counts on the fileType side", () => {
    expect(threadSpot({ anchor: U4, excerpt: [{ n: 9, kind: "ctx", text: "line 7", hit: true }] })).toMatchObject({ side: "new", line: 9 });
    expect(threadSpot({ anchor: { ...U4, fileType: "FROM" }, excerpt: [{ n: 7, kind: "ctx", text: "line 7", hit: true }] })).toMatchObject({
      side: "old",
      line: 7,
    });
    expect(threadSpot({ anchor: U4, excerpt: [{ n: 9, kind: "del", text: "line 9", hit: true }] })).toMatchObject({ side: "old", line: 9 });
    expect(threadSpot({ anchor: U4, excerpt: [{ n: 6, kind: "add", text: "added 6", hit: true }] })).toMatchObject({
      side: "new",
      line: 6,
    });
  });

  test("without an excerpt, CONTEXT and REMOVED anchors count on the old side (Gate v3 U4)", () => {
    expect(threadSpot({ anchor: U4 })).toMatchObject({ side: "old", line: 7 });
    expect(threadSpot({ anchor: { ...U4, lineType: "REMOVED", line: 9 } })).toMatchObject({ side: "old", line: 9 });
    expect(threadSpot({ anchor: { ...U4, lineType: "ADDED", line: 6 } })).toMatchObject({ side: "new", line: 6 });
    // The excerpt and the anchor name the same row: source 7, destination 9.
    const viaAnchor = place(rows, true, [threadItem(root(U4)) as Item]);
    const viaExcerpt = place(rows, true, [threadItem(root(U4, [{ n: 9, kind: "ctx", text: "line 7", hit: true }])) as Item]);
    expect([...viaAnchor.at.keys()]).toEqual([at("old", 7)]);
    expect([...viaExcerpt.at.keys()]).toEqual([at("old", 7)]);
    expect(rows[at("old", 7)]).toMatchObject({ kind: "ctx", old: 7, new: 9 });
  });

  test("a general comment has no item; an orphaned or whole-file comment goes to the list", () => {
    expect(threadItem(root(null))).toBeNull();
    const p = place(rows, true, [
      threadItem(root({ ...U4, orphaned: true })) as Item,
      threadItem({ id: 6, root: { anchor: { path: "sample1.md" } } }) as Item,
    ]);
    expect(p.at.size).toBe(0);
    expect(p.off).toEqual([
      { kind: "thread", id: 5, why: THREAD_OUTDATED },
      { kind: "thread", id: 6, why: "A comment on the whole file." },
    ]);
  });

  test("a line without a row goes to the list; the reason depends on the loaded pages", () => {
    const item = threadItem(root({ ...U4, lineType: "ADDED", line: 15 })) as Item;
    expect(place(rows, true, [item]).off[0]?.why).toBe("Line 15 is not in the diff.");
    expect(place(rows, false, [item]).off[0]?.why).toBe("Line 15 is not in the lines shown.");
  });
});

describe("draft lines", () => {
  test("a range marks its rows and puts the card after the last one", () => {
    const p = place(rows, true, [draftItem(draft(), "h1", "h1") as Item]);
    expect([...p.marked].sort()).toEqual([at("new", 6), at("new", 7)]);
    expect([...p.at.keys()]).toEqual([at("new", 7)]);
    expect(targetOf(0, rows, p, { kind: "draft", id: 40 })).toBe("dl-0-n6");
  });

  test("an old-side draft sits on the removed row", () => {
    const p = place(rows, true, [draftItem(draft({}, { side: "old", line: 9, lineEnd: 9 }), "h1", "h1") as Item]);
    expect([...p.at.keys()]).toEqual([at("old", 9)]);
    expect(targetOf(0, rows, p, { kind: "draft", id: 40 })).toBe("dl-0-o9");
  });

  test("outside, older head, discarded, and anchorless drafts", () => {
    const outside = draftItem(draft({}, { state: "outside" }), "h1", "h1") as Item;
    const older = draftItem(draft({ id: 41 }), "a".repeat(40), "b".repeat(40)) as Item;
    const p = place(rows, true, [outside, older]);
    expect(p.off).toEqual([
      { kind: "draft", id: 40, why: DRAFT_OUTSIDE },
      { kind: "draft", id: 41, why: olderHead("a".repeat(40)) },
    ]);
    expect(olderHead("a".repeat(40))).toContain("aaaaaaa.");
    expect(targetOf(2, rows, p, { kind: "draft", id: 41 })).toBe(offId(2, { kind: "draft", id: 41 }));
    expect(draftItem(draft({ status: "discarded" }), "h1", "h1")).toBeNull();
    expect(draftItem(draft({ anchor: null }), "h1", "h1")).toBeNull();
  });
});

describe("rows", () => {
  test("gap rows count the unchanged lines before a hunk", () => {
    expect(hidden(undefined, rows[0] as (typeof rows)[number])).toBe(3);
    const second = rows.findIndex((r) => r.old === 20);
    expect(hidden(rows[second - 1], rows[second] as (typeof rows)[number])).toBe(9);
    for (let k = 1; k < second; k++) expect(hidden(rows[k - 1], rows[k] as (typeof rows)[number])).toBe(0);
    expect(hidden(rows[second], rows[second + 1] as (typeof rows)[number])).toBe(0);
  });

  test("row IDs take the new line, a removed row its old line", () => {
    expect(rows.map((r) => rowId(1, r)).slice(-3)).toEqual(["dl-1-n22", "dl-1-o21", "dl-1-n23"]);
  });

  test("a path finds its file by the new path, else by the old path", () => {
    const files = [
      { path: "b.ts", oldPath: "a.ts", binary: false, added: 1, removed: 1, rows: 2 },
      { path: null, oldPath: "gone.ts", binary: false, added: 0, removed: 3, rows: 3 },
    ];
    expect(fileOf(files, "b.ts")).toBe(0);
    expect(fileOf(files, "a.ts")).toBe(0);
    expect(fileOf(files, "gone.ts")).toBe(1);
    expect(fileOf(files, "other.ts")).toBe(-1);
  });
});
