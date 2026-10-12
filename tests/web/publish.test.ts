// Plan v3 WP14a: the pure publish UI rules. Post states, confirm text, the place of outbox rows, and the reply draft store.
import { describe, expect, test } from "bun:test";
import type { CommentDto, PlannedPost, PostDestination, PostDto } from "../../src/shared/dto";
import {
  destLabel,
  destText,
  draftKey,
  editDraft,
  mergePosts,
  parentOf,
  parseDraft,
  planItems,
  postView,
  shownPosts,
  splitPosts,
} from "../../src/web/publish/model";

const inline: PostDestination = { kind: "inline", path: "src/cache/flush.ts", srcPath: null, line: 3, lineEnd: 3, lineType: "add" };
const general: PostDestination = { kind: "general" };
const reply = (parentId: number): PostDestination => ({ kind: "reply", parentId });

const post = (id: number, destination: PostDestination, o: Partial<PostDto> = {}): PostDto => ({
  id,
  pr: 1,
  run: destination.kind === "reply" ? null : 7,
  destination,
  body: `Body ${id}`,
  items: [],
  state: "pending",
  remoteId: null,
  remoteVersion: null,
  attempts: 0,
  lastError: null,
  checking: false,
  createdAt: 1,
  updatedAt: 1,
  ...o,
});

const comment = (id: number, o: Partial<CommentDto> = {}): CommentDto => ({
  id,
  version: 0,
  parentId: null,
  rootId: id,
  authorSlug: "alex",
  authorName: "Alex Smith",
  authorLogin: "alex",
  text: "Text",
  anchor: null,
  threadResolved: false,
  createdAt: 1,
  updatedAt: 1,
  unread: false,
  deleted: false,
  ...o,
});

describe("confirm text", () => {
  test("destText names each destination with its count", () => {
    const planned = (d: PostDestination) => ({ destination: d });
    expect(destText([planned(inline), planned(inline), planned(general)])).toBe("2 inline comments and 1 general comment");
    expect(destText([planned(general)])).toBe("1 general comment");
    expect(destText([planned(reply(5)), planned(reply(6))])).toBe("2 replies");
    expect(destText([planned(inline), planned(general), planned(reply(5))])).toBe("1 inline comment, 1 general comment and 1 reply");
  });

  test("a reply names the author of its parent and the place of the thread", () => {
    const root = comment(100, { anchor: { path: "src/cache/flush.ts", line: 3 } });
    const kid = comment(101, { parentId: 100, rootId: 100, authorName: null, authorSlug: "mlopez" });
    expect(destLabel(reply(101), [root, kid])).toEqual({ code: null, text: "Reply to mlopez in src/cache/flush.ts:3" });
    expect(parentOf(200, [comment(200)])).toEqual({ name: "Alex Smith", place: "the general comment" });
    expect(destLabel(reply(999), [root])).toEqual({ code: null, text: "Reply" });
    // Gate v3 U4: a CONTEXT anchor holds old line 7. The place names new line 9, the line that the excerpt marks.
    const ctx = comment(300, {
      anchor: { path: "sample1.md", line: 7, lineType: "CONTEXT", fileType: "TO" },
      excerpt: [{ n: 9, kind: "ctx", text: "x", hit: true }],
    });
    expect(parentOf(300, [ctx])?.place).toBe("sample1.md:9");
    expect(parentOf(300, [{ ...ctx, excerpt: undefined }])?.place).toBe("sample1.md");
    // Gate A U2: a range comment names its span.
    const span = { srcSpanStart: 3, srcSpanEnd: 10, dstSpanStart: 3, dstSpanEnd: 12 };
    const range = comment(400, { anchor: { path: "sample1.md", line: 10, lineType: "CONTEXT", fileType: "FROM", multilineSpan: span } });
    expect(parentOf(400, [range])?.place).toBe("sample1.md:3–12");
  });

  test("an inline destination shows the file name and the line range", () => {
    expect(destLabel(inline, [])).toEqual({ code: "flush.ts:3", text: "Inline comment" });
    expect(destLabel({ ...inline, lineEnd: 5 }, []).code).toBe("flush.ts:3–5");
    expect(destLabel(general, [])).toEqual({ code: null, text: "General comment" });
  });

  test("confirm sends every item of the plan with the revision on screen", () => {
    const p = (items: PlannedPost["items"]) =>
      ({
        run: 7,
        sourceHead: "a",
        targetHead: "b",
        mergeBase: null,
        destination: general,
        body: "",
        items,
        duplicate: null,
      }) as PlannedPost;
    expect(planItems([p([{ id: 1, revision: 2 }]), p([{ id: 3, revision: 0 }])])).toEqual([
      { id: 1, revision: 2 },
      { id: 3, revision: 0 },
    ]);
  });
});

describe("post states", () => {
  test("pending and sent show Posting with no action", () => {
    for (const state of ["pending", "sent"] as const)
      expect(postView(post(1, inline, { state }))).toMatchObject({ kind: "posting", actions: [] });
  });

  test("unknown shows Checking while the app reads the remote comments, then the reason", () => {
    expect(postView(post(1, inline, { state: "unknown", checking: true }))).toEqual({
      kind: "checking",
      text: "Outcome unknown. Checking.",
      reason: null,
      actions: ["again", "drop"],
    });
    expect(postView(post(1, inline, { state: "unknown", lastError: "No matching comment." }))).toMatchObject({
      kind: "unknown",
      reason: "No matching comment.",
      actions: ["again", "drop"],
    });
  });

  test("failed shows the reason; only an inline post can move to the general comment", () => {
    expect(postView(post(1, inline, { state: "failed", lastError: "HTTP 400" }))).toMatchObject({
      kind: "failed",
      reason: "HTTP 400",
      actions: ["again", "general", "drop"],
    });
    expect(postView(post(2, general, { state: "failed" }))).toMatchObject({
      reason: "No reason was recorded.",
      actions: ["again", "drop"],
    });
    expect(postView(post(3, reply(5), { state: "failed" })).actions).toEqual(["again", "drop"]);
  });

  test("confirmed shows Posted", () => {
    expect(postView(post(1, inline, { state: "confirmed", remoteId: 9 }))).toMatchObject({ kind: "posted", actions: [] });
  });
});

describe("outbox rows", () => {
  test("a confirmed row shows until the synced comment with its ID arrives", () => {
    const rows = [
      post(1, inline, { state: "confirmed", remoteId: 50 }),
      post(2, inline, { state: "confirmed", remoteId: 51 }),
      post(3, general),
    ];
    expect(shownPosts(rows, [comment(50)]).map((p) => p.id)).toEqual([2, 3]);
    // A deleted comment still counts as synced.
    expect(shownPosts(rows, [comment(50), comment(51, { deleted: true })]).map((p) => p.id)).toEqual([3]);
  });

  test("a reply row goes to the thread of its parent; other rows and unknown parents go to the posts group", () => {
    const cs = [comment(100), comment(101, { parentId: 100, rootId: 100 })];
    const { threads, rest } = splitPosts([post(1, reply(101)), post(2, inline), post(3, reply(999)), post(4, reply(100))], cs);
    expect([...threads].map(([t, ps]) => [t, ps.map((p) => p.id)])).toEqual([[100, [1, 4]]]);
    expect(rest.map((p) => p.id)).toEqual([2, 3]);
  });

  test("new rows replace old rows of the same ID, in ID order", () => {
    const merged = mergePosts([post(2, inline), post(1, general)], [post(2, inline, { state: "confirmed" }), post(3, general)]);
    expect(merged.map((p) => [p.id, p.state])).toEqual([
      [1, "pending"],
      [2, "confirmed"],
      [3, "pending"],
    ]);
    expect(mergePosts(undefined, [post(1, inline)]).map((p) => p.id)).toEqual([1]);
  });
});

describe("reply draft store", () => {
  test("the key names the PR and the thread", () => {
    expect(draftKey(4, 1000003)).toBe("rl:reply:4:1000003");
  });

  test("only a complete draft parses", () => {
    expect(parseDraft(JSON.stringify({ text: "Hi", key: "k", used: false }))).toEqual({ text: "Hi", key: "k", used: false });
    for (const raw of [null, "", "{", "[]", JSON.stringify({ text: "Hi" }), JSON.stringify({ text: 1, key: "k", used: false })])
      expect(parseDraft(raw)).toBeNull();
  });

  test("a text change after a send gets a new key; the same text keeps the key", () => {
    const next = () => "new-key";
    expect(editDraft({ text: "a", key: "k", used: false }, "ab", next)).toEqual({ text: "ab", key: "k", used: false });
    expect(editDraft({ text: "a", key: "k", used: true }, "a", next)).toEqual({ text: "a", key: "k", used: true });
    expect(editDraft({ text: "a", key: "k", used: true }, "ab", next)).toEqual({ text: "ab", key: "new-key", used: false });
  });
});
