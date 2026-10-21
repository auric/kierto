// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Thread history lines (docs/plans/thread-outcome.md section 10): the words, the time order, the untimed entries, the merge of a
// confirmed post into its message, and the revisions.
import { describe, expect, test } from "bun:test";
import type { CommentDto, ItemStatus, ReviewItemDto, ThreadHistoryDto } from "../../src/shared/dto";
import type { ReplyPayload, SessionMark } from "../../src/shared/review";
import { type HistoryLine, historyLines } from "../../src/web/pr/history";
import { buildThreads, type ThreadModel } from "../../src/web/pr/threads";

const ROOT = 1;
const NAMES = { ai: "Claude", forge: "Bitbucket" };

const c = (id: number, o: Partial<CommentDto> = {}): CommentDto => ({
  id,
  version: 0,
  parentId: id === ROOT ? null : ROOT,
  rootId: ROOT,
  authorSlug: id === ROOT ? "me" : "lena",
  authorName: id === ROOT ? "Jordan Doe" : "Lena Petrova",
  authorLogin: null,
  text: `Message ${id}`,
  anchor: null,
  threadResolved: false,
  createdAt: id * 10,
  updatedAt: id * 10,
  unread: false,
  deleted: false,
  ...o,
});

const threadOf = (comments: CommentDto[]): ThreadModel => {
  const t = buildThreads(comments, new Set(), "me", { role: "REVIEWER", authorSlug: null, authorName: null })[0];
  if (!t) throw new Error("no thread");
  return t;
};

type ItemOpts = {
  run?: number;
  status?: ItemStatus;
  body?: string;
  edited?: boolean;
  drafted?: ReviewItemDto["drafted"];
  payload?: Partial<ReplyPayload> & { session?: SessionMark };
};
const item = (id: number, o: ItemOpts = {}): ReviewItemDto => ({
  id,
  run: o.run ?? 7,
  kind: "reply",
  body: o.body ?? "The writer's reply.",
  payload: {
    thread: ROOT,
    action: "reply",
    body: "The writer's reply.",
    reason: "The reason.",
    evidenceStatus: "unverified",
    judgement: null,
    replyTo: 2,
    origin: "reply",
    ...o.payload,
  },
  anchor: null,
  status: o.status ?? "new",
  revision: 0,
  edited: o.edited ?? false,
  drafted: o.drafted ?? { kind: "reply", startedAt: 25, finishedAt: 30, head: "h" },
});

const dto = (o: Partial<ThreadHistoryDto> = {}): ThreadHistoryDto => ({
  thread: ROOT,
  drafts: [],
  fixes: [],
  commits: [],
  posts: [],
  ...o,
});
const post = (o: Partial<ThreadHistoryDto["posts"][number]> & { id: number }): ThreadHistoryDto["posts"][number] => ({
  at: 60,
  run: null,
  kind: "reply",
  state: "confirmed",
  error: null,
  remoteId: null,
  updatedAt: 65,
  resolve: null,
  ...o,
});

// "Actor text" of each line.
const words = (ls: HistoryLine[]) => ls.map((l) => `${l.actor ? `${l.actor} ` : ""}${l.text}`);
const line = (ls: HistoryLine[], key: string) => {
  const l = ls.find((x) => x.key === key);
  if (!l) throw new Error(`no line ${key}`);
  return l;
};

describe("historyLines", () => {
  test("messages, a draft that you edited and accepted, a fix, and a commit in time order", () => {
    const t = threadOf([c(1), c(2, { updatedAt: 45 }), c(3, { authorSlug: "me", authorName: "Jordan Doe", createdAt: 90, updatedAt: 90 })]);
    const draft = item(10, { status: "accepted", edited: true, body: "My own words.", payload: { touchedAt: 40 } });
    const ls = historyLines(
      dto({
        drafts: [{ at: 30, exact: true, item: draft, replacedBy: null }],
        fixes: [{ at: 50, run: 8, note: { thread: ROOT, fixed: true, reason: "Lock in finally.", why: null, reply: "" } }],
        commits: [{ at: 60, id: 3, run: 8, short: "abc1234", state: "undone", edits: 1, of: 2, pushed: false, undoneAt: 70 }],
      }),
      t,
      NAMES,
    );
    expect(words(ls)).toEqual([
      "You started the thread",
      "Lena Petrova replied",
      "Claude drafted a reply",
      "You edited the text and accepted the draft",
      "Lena Petrova edited the message",
      "Claude proposed a fix",
      "You committed abc1234: 1 of 2 edits of this thread",
      "You undid the fix commit abc1234",
      "You replied",
    ]);
    expect(ls.every((l) => l.exact)).toBe(true);
    expect(line(ls, "m1").detail).toBe("Message 1");
    expect(line(ls, "i10")).toMatchObject({ run: 7, detail: "The writer's reply.", tags: [] });
    expect(line(ls, "t10")).toMatchObject({ at: 40, diff: { before: "The writer's reply.", after: "My own words." } });
    expect(line(ls, "t10").run).toBeUndefined();
    expect(line(ls, "f8")).toMatchObject({ run: 8, detail: "Lock in finally." });
    // An undone commit gets no push state.
    expect(line(ls, "c3").tags).toEqual([]);
  });

  test("fix results: no fix with its why, dropped edits, and a pushed and an unpushed commit", () => {
    const t = threadOf([c(1), c(2)]);
    const ls = historyLines(
      dto({
        fixes: [
          { at: 30, run: 8, note: { thread: ROOT, fixed: false, reason: "It does that already.", why: "already", reply: "" } },
          { at: 40, run: 9, note: { thread: ROOT, fixed: true, reason: "r", why: "dropped", reply: "", drops: ["unrequested", "match"] } },
        ],
        commits: [
          { at: 50, id: 1, run: 9, short: "aaaaaaa", state: "committed", edits: 2, of: 2, pushed: true, undoneAt: null },
          { at: 60, id: 2, run: 9, short: "bbbbbbb", state: "committed", edits: 1, of: 1, pushed: false, undoneAt: null },
          { at: 70, id: 3, run: 9, short: null, state: "staged", edits: 1, of: 1, pushed: false, undoneAt: null },
        ],
      }),
      t,
      NAMES,
    );
    expect(line(ls, "f8")).toMatchObject({ text: "proposed no fix", tags: ["Already done"], detail: "It does that already." });
    expect(line(ls, "f9")).toMatchObject({ text: "proposed edits that could not be applied", tags: [], detail: "unrequested; match" });
    expect(line(ls, "c1")).toMatchObject({ text: "committed aaaaaaa: 2 of 2 edits of this thread", tags: [] });
    expect(line(ls, "c2")).toMatchObject({ text: "committed bbbbbbb: 1 of 1 edit of this thread", tags: ["Not on the pull request"] });
    expect(line(ls, "c3")).toMatchObject({ text: "staged 1 of 1 edit of this thread", tags: ["Commit not finished"] });
  });

  test("untimed entries: a decline, its Won't fix draft, a deleted message, a resolve without a time, and old drafts", () => {
    const t = threadOf([c(1, { threadResolved: true }), c(2, { deleted: true, text: null })]);
    const wont = item(11, {
      run: 8,
      body: "Won't fix: Out of scope.",
      drafted: { kind: "fix", startedAt: 28, finishedAt: 30, head: "h" },
      payload: { body: "Won't fix: Out of scope.", origin: "nofix", declined: { run: 8 } },
    });
    // A draft stored before origin and touchedAt existed.
    const old = item(12, { status: "accepted", payload: { origin: undefined } });
    const ls = historyLines(
      dto({
        drafts: [
          { at: 30, exact: false, item: wont, replacedBy: null },
          { at: 31, exact: true, item: old, replacedBy: null },
        ],
        fixes: [
          {
            at: 30,
            run: 8,
            note: { thread: ROOT, fixed: true, reason: "r", why: null, reply: "", declined: { reason: "Out of scope.", draft: 11 } },
          },
        ],
      }),
      t,
      NAMES,
    );
    expect(words(ls)).toEqual([
      "You started the thread",
      "Lena Petrova replied",
      "Claude proposed a fix",
      "You declined the fix",
      "Kierto drafted “Won't fix” from your decline",
      "Claude drafted a reply",
      "You accepted the draft",
      "The thread is resolved",
    ]);
    expect(line(ls, "m2")).toMatchObject({ tags: ["Deleted on Bitbucket"], exact: true });
    expect(line(ls, "m2").detail).toBeUndefined();
    expect(line(ls, "d8")).toMatchObject({ exact: false, detail: "Out of scope." });
    expect(line(ls, "i11")).toMatchObject({ exact: false, at: 30 });
    expect(line(ls, "i11").run).toBeUndefined();
    expect(line(ls, "t12")).toMatchObject({ exact: false, at: 31 });
    expect(line(ls, "resolved")).toMatchObject({ at: null, exact: false, actor: null });
  });

  test("a confirmed post merges into its message; unconfirmed posts and a failed resolve get their own lines", () => {
    const t = threadOf([
      c(1, { threadResolved: true, resolver: { slug: "me", name: "Jordan Doe", login: "me" }, resolvedAt: 95 }),
      c(2),
      c(3, { authorSlug: "me", authorName: "Jordan Doe", createdAt: 61, updatedAt: 61 }),
      c(4, { authorSlug: "me", authorName: "Jordan Doe", createdAt: 71, updatedAt: 71 }),
    ]);
    const posted = item(10, { status: "posted", payload: { touchedAt: 55 } });
    const ls = historyLines(
      dto({
        drafts: [{ at: 30, exact: true, item: posted, replacedBy: null }],
        posts: [
          post({ id: 1, run: 7, remoteId: 3, at: 60, resolve: { root: ROOT, state: "failed", error: "HTTP 403" }, updatedAt: 62 }),
          post({ id: 2, run: null, remoteId: 4, at: 70 }),
          post({ id: 3, state: "failed", error: "HTTP 500", at: 80 }),
          post({ id: 4, state: "unknown", at: 81 }),
          post({ id: 5, state: "sent", at: 82 }),
          post({ id: 6, run: 5, kind: "inline", remoteId: 1, at: 5 }),
        ],
      }),
      t,
      NAMES,
    );
    expect(words(ls)).toEqual([
      "You started the thread from a review run",
      "Lena Petrova replied",
      "Claude drafted a reply",
      "You accepted the draft",
      "You replied from a Kierto draft",
      "Kierto could not resolve the thread after the post",
      "You replied from Kierto",
      "You posted a reply",
      "You posted a reply",
      "You posted a reply",
      "You resolved the thread",
    ]);
    expect(line(ls, "m1").run).toBe(5);
    expect(line(ls, "m3").run).toBe(7);
    expect(line(ls, "m4").run).toBeUndefined();
    expect(line(ls, "i10").tags).toEqual(["Posted"]);
    expect(line(ls, "r1")).toMatchObject({ at: 62, error: true, detail: "HTTP 403" });
    expect(line(ls, "p3")).toMatchObject({ tags: ["Failed"], error: true, detail: "HTTP 500" });
    expect(line(ls, "p4").tags).toEqual(["State unknown"]);
    expect(line(ls, "p5").tags).toEqual(["Not confirmed yet"]);
    expect(ls.some((l) => l.key === "p1" || l.key === "p2" || l.key === "p6")).toBe(false);
    expect(line(ls, "resolved")).toMatchObject({ at: 95, exact: true });
  });

  test("revisions: waiting, kept, not used, and used (revisionOf); the replaced draft names the revision", () => {
    const t = threadOf([c(1), c(2)]);
    const mine = item(10, {
      status: "discarded",
      edited: true,
      body: "Mine.",
      payload: { discardedBy: "user", touchedAt: 35 },
    });
    const used = item(11, {
      run: 8,
      status: "accepted",
      body: "Mine.\n\nFixed in ccccccc.",
      drafted: { kind: "fix", startedAt: 40, finishedAt: 41, head: "h" },
      payload: {
        body: "Mine.\n\nFixed in ccccccc.",
        origin: "fix",
        fix: { id: 3, commit: "c".repeat(40), replaced: [10] },
        revisionOf: 10,
        touchedAt: 50,
      },
    });
    const ls = historyLines(
      dto({
        drafts: [
          { at: 30, exact: true, item: mine, replacedBy: null },
          { at: 45, exact: true, item: used, replacedBy: null },
        ],
      }),
      t,
      NAMES,
    );
    expect(line(ls, "i10").tags).toEqual(["Replaced by the revision"]);
    expect(line(ls, "i11")).toMatchObject({ actor: "Kierto", text: "revised your draft for the fix commit ccccccc", tags: [] });
    expect(line(ls, "t11")).toMatchObject({ text: "used the revision and accepted the draft", at: 50, exact: true });
    expect(line(ls, "t10")).toMatchObject({ text: "edited the text", at: 35 });

    const waiting = item(20, { status: "discarded", payload: { revises: 10 } });
    const kept = item(21, { status: "discarded", payload: { revises: 10, dropped: true } });
    expect(historyLines(dto({ drafts: [{ at: 50, exact: true, item: kept, replacedBy: null }] }), t, NAMES)[2]).toMatchObject({
      text: "revised your draft",
      tags: ["You kept your draft"],
      run: 7,
    });
    const both = historyLines(
      dto({
        drafts: [
          { at: 50, exact: true, item: kept, replacedBy: null },
          { at: 55, exact: true, item: { ...waiting, id: 22 }, replacedBy: null },
        ],
      }),
      t,
      NAMES,
    );
    expect(line(both, "i21").tags).toEqual(["Not used"]);
    expect(line(both, "i22").tags).toEqual(["Revision waiting"]);
  });

  test("draft fates and writers: replaced by a named writer, no reply needed, moved to the newest, judgements, and sessions", () => {
    const t = threadOf([c(1), c(2), c(3, { createdAt: 33, updatedAt: 33 })]);
    const replaced = item(10, { status: "discarded" });
    const session = item(11, {
      run: 9,
      drafted: { kind: "session", startedAt: 40, finishedAt: 42, head: "h" },
      payload: { origin: "session", session: { run: 9, verdict: "accept", reason: "r" } },
    });
    const none = item(12, { status: "discarded", body: "", payload: { body: "", discardedBy: "ai" } });
    const gone = item(13, { status: "discarded", payload: { discardedBy: "user" } });
    const moved = item(14, { status: "accepted", payload: { replyTo: 3, touchedAt: 60, judgement: "settled", origin: "review" } });
    const ls = historyLines(
      dto({
        drafts: [
          { at: 30, exact: true, item: replaced, replacedBy: 11 },
          { at: 42, exact: true, item: session, replacedBy: null },
          { at: 43, exact: true, item: none, replacedBy: null },
          { at: 44, exact: true, item: gone, replacedBy: null },
          { at: 45, exact: true, item: moved, replacedBy: null },
        ],
      }),
      t,
      NAMES,
    );
    expect(line(ls, "i10").tags).toEqual(["Replaced by the draft of your session"]);
    expect(line(ls, "i11")).toMatchObject({ actor: "Your session", text: "drafted a reply", run: 9 });
    expect(line(ls, "i12")).toMatchObject({ text: "found that no reply is needed", tags: [], detail: "The reason." });
    expect(line(ls, "i13").tags).toEqual(["Discarded by you"]);
    expect(line(ls, "i14")).toMatchObject({ text: "drafted an answer in the review", tags: ["Settled"] });
    expect(line(ls, "t14").text).toBe("accepted the draft and moved it to the newest message");
  });
});
