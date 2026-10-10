import { describe, expect, test } from "bun:test";
import { byThread, newestLive, type TurnMsg, threadTurn } from "../../src/shared/turn";

const ME = "me.user";
let next = 1;
const msg = (o: Partial<TurnMsg> = {}): TurnMsg => {
  const id = o.id ?? next++;
  return { id, rootId: 1, authorSlug: "other", authorLogin: null, createdAt: id * 10, deleted: false, threadResolved: false, ...o };
};
const mine = (o: Partial<TurnMsg> = {}) => msg({ authorSlug: "me-slug", authorLogin: ME, ...o });

describe("thread turn", () => {
  test("my message answered by someone else is my turn", () => {
    expect(threadTurn([mine({ id: 1 }), msg({ id: 2 })], ME, false)).toBe("your");
  });

  test("my newest message waits on others", () => {
    expect(threadTurn([msg({ id: 1 }), mine({ id: 2 })], ME, false)).toBe("wait");
  });

  test("a thread without my message on another PR is other", () => {
    expect(threadTurn([msg({ id: 1 }), msg({ id: 2, authorSlug: "third" })], ME, false)).toBe("other");
  });

  test("an author-only thread is mine when I authored the PR", () => {
    expect(threadTurn([msg({ id: 1 })], ME, true)).toBe("your");
    expect(threadTurn([msg({ id: 1 })], ME, false)).toBe("other");
  });

  test("the slug matches me too, case folded", () => {
    expect(threadTurn([msg({ id: 1, authorSlug: "ME.USER" }), msg({ id: 2 })], ME, false)).toBe("your");
  });

  test("a resolved thread is resolved", () => {
    expect(threadTurn([mine({ id: 1, threadResolved: true }), msg({ id: 2 })], ME, false)).toBe("resolved");
  });

  test("a deleted last message does not count", () => {
    expect(threadTurn([mine({ id: 1 }), msg({ id: 2, deleted: true })], ME, false)).toBe("wait");
    expect(threadTurn([mine({ id: 1 }), msg({ id: 2 }), mine({ id: 3, deleted: true })], ME, false)).toBe("your");
  });

  test("a deleted message of mine does not make the thread mine", () => {
    expect(threadTurn([mine({ id: 1, deleted: true }), msg({ id: 2 })], ME, false)).toBe("other");
  });

  test("a thread with no live message is other, also on my PR", () => {
    expect(threadTurn([mine({ id: 1, deleted: true }), msg({ id: 2, deleted: true })], ME, true)).toBe("other");
    expect(threadTurn([], ME, true)).toBe("other");
  });

  test("newest orders by created_at, then by comment ID", () => {
    const a = msg({ id: 5, createdAt: 100 });
    const b = mine({ id: 4, createdAt: 200 });
    expect(newestLive([b, a])).toBe(b);
    const c = msg({ id: 7, createdAt: 200 });
    expect(newestLive([c, b])).toBe(c);
    expect(threadTurn([a, b, c], ME, false)).toBe("your");
    expect(threadTurn([a, b, msg({ id: 3, createdAt: 200 })], ME, false)).toBe("wait");
  });

  test("no user matches nothing", () => {
    expect(threadTurn([mine({ id: 1 }), msg({ id: 2 })], null, false)).toBe("other");
  });

  test("messages group by root ID", () => {
    const m = [msg({ id: 1, rootId: 1 }), msg({ id: 2, rootId: 2 }), msg({ id: 3, rootId: 1 })];
    expect([...byThread(m)].map(([r, t]) => [r, t.map((x) => x.id)])).toEqual([
      [1, [1, 3]],
      [2, [2]],
    ]);
  });
});
