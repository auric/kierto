import { describe, expect, test } from "bun:test";
import { nextDelay, parseRetryAfter, prEvents, reconcile, roleOf } from "../../src/server/sync/reconcile";
import type { Comment, PullRequest } from "../../src/shared/types";

const ME = "jdoe";
const OTHER = "asmith";
const OLD_HEAD = "a".repeat(40);
const NEW_HEAD = "b".repeat(40);
const REVIEWED = "c".repeat(40);

const comment = (id: number, rootId: number, author: string, version = 0): Comment => ({
  id,
  version,
  parentId: id === rootId ? null : rootId,
  rootId,
  author: { slug: author, name: author, login: author },
  text: `text ${id}`,
  threadResolved: false,
  createdAt: 1,
  updatedAt: 1,
});

const pr = (over: Partial<PullRequest> = {}): PullRequest => ({
  ref: { project: "PROJ1", repo: "repo", id: 1 },
  version: 3,
  title: "t",
  state: "OPEN",
  author: { slug: OTHER, name: OTHER, login: OTHER },
  reviewers: [{ slug: ME, name: ME, login: ME, status: "UNAPPROVED", lastReviewedCommit: REVIEWED }],
  sourceHead: NEW_HEAD,
  targetHead: "d".repeat(40),
  sourceBranch: "s",
  targetBranch: "t",
  updatedDate: 1,
  ...over,
});

describe("roleOf", () => {
  test("author, reviewer, or neither", () => {
    expect(roleOf(pr({ author: { slug: ME, name: ME, login: ME }, reviewers: [] }), ME)).toBe("AUTHOR");
    expect(roleOf(pr(), ME)).toBe("REVIEWER");
    expect(roleOf(pr({ reviewers: [] }), ME)).toBeNull();
  });
});

describe("current user by username", () => {
  // X-AUSERNAME gives the username. It can differ from the slug in case and in form.
  const LOGIN = "J.Doe";
  const user = { slug: "jdoe", name: "Jordan Doe", login: LOGIN };
  const own = (id: number, rootId: number): Comment => ({ ...comment(id, rootId, OTHER), author: user });

  test("role, acknowledgement, events, and stored threads match the username or the slug, ignoring case", () => {
    expect(roleOf(pr({ author: user, reviewers: [] }), LOGIN)).toBe("AUTHOR");
    expect(roleOf(pr({ reviewers: [{ ...user, status: "UNAPPROVED" }] }), "JDOE")).toBe("REVIEWER");
    const stored = [{ id: 1, rootId: 1, author: "jdoe", login: "j.doe", live: false }];
    const fetched = [comment(2, 1, OTHER), own(3, 3), comment(4, 3, OTHER)];
    const r = reconcile({ me: LOGIN, role: "REVIEWER", initialized: true, stored, fetched });
    expect(r.rows.map((c) => c.ackVersion)).toEqual([null, 0, null]);
    expect(r.newCommentIds).toEqual([2, 4]);
  });
});

describe("reconcile", () => {
  const base = { me: ME, role: "REVIEWER" };

  test("before initialization every row is acknowledged and nothing notifies", () => {
    const r = reconcile({ ...base, initialized: false, stored: [], fetched: [comment(1, 1, OTHER, 2), comment(2, 1, ME)] });
    expect(r.rows.map((c) => c.ackVersion)).toEqual([2, 0]);
    expect(r.newCommentIds).toEqual([]);
  });

  test("after initialization only own comments are acknowledged", () => {
    const r = reconcile({ ...base, initialized: true, stored: [], fetched: [comment(1, 1, OTHER, 2), comment(2, 1, ME, 1)] });
    expect(r.rows.map((c) => c.ackVersion)).toEqual([null, 1]);
  });

  test("delete candidates are live stored comments absent from the fetch", () => {
    const stored = [
      { id: 1, rootId: 1, author: OTHER, login: null, live: true },
      { id: 2, rootId: 1, author: OTHER, login: null, live: true },
      { id: 3, rootId: 3, author: OTHER, login: null, live: false },
    ];
    expect(reconcile({ ...base, initialized: true, stored, fetched: [comment(1, 1, OTHER)] }).candidates).toEqual([2]);
  });

  test("on a reviewed PR a new comment notifies only in a thread that holds my comment", () => {
    const stored = [
      { id: 1, rootId: 1, author: OTHER, login: null, live: true },
      { id: 2, rootId: 1, author: ME, login: null, live: true },
      { id: 5, rootId: 5, author: OTHER, login: null, live: true },
    ];
    const fetched = [
      comment(1, 1, OTHER),
      comment(2, 1, ME),
      comment(3, 1, OTHER), // reply in my thread
      comment(4, 4, OTHER), // new root
      comment(5, 5, OTHER),
      comment(6, 5, OTHER), // reply in a thread without me
      comment(7, 7, OTHER), // root that I answer in the same fetch
      comment(8, 7, ME),
      comment(9, 1, ME), // own reply
    ];
    expect(reconcile({ ...base, initialized: true, stored, fetched }).newCommentIds).toEqual([3, 7]);
  });

  test("on my PR every new comment by another user notifies", () => {
    const fetched = [comment(1, 1, OTHER), comment(2, 2, OTHER), comment(3, 1, ME)];
    const r = reconcile({ me: ME, role: "AUTHOR", initialized: true, stored: [], fetched });
    expect(r.newCommentIds).toEqual([1, 2]);
  });

  test("a known ID never notifies again, also after a tombstone", () => {
    const stored = [{ id: 1, rootId: 1, author: OTHER, login: null, live: false }];
    const r = reconcile({ me: ME, role: "AUTHOR", initialized: true, stored, fetched: [comment(1, 1, OTHER, 1)] });
    expect(r.newCommentIds).toEqual([]);
  });
});

describe("prEvents", () => {
  const before = { role: "REVIEWER", sourceHead: OLD_HEAD, initialized: true, watched: true };

  test("reviewer_added needs an earlier complete dashboard and a role change", () => {
    expect(prEvents(null, pr(), ME, true)).toEqual([{ kind: "reviewer_added", ref: "3" }]);
    expect(prEvents({ ...before, role: null, sourceHead: NEW_HEAD }, pr(), ME, true)).toEqual([{ kind: "reviewer_added", ref: "3" }]);
    expect(prEvents(null, pr(), ME, false)).toEqual([]);
    expect(prEvents({ ...before, sourceHead: NEW_HEAD }, pr(), ME, true)).toEqual([]);
    expect(prEvents({ ...before, role: null, sourceHead: NEW_HEAD, watched: false }, pr(), ME, true)).toEqual([]);
  });

  test("commits_pushed needs an initialized reviewed PR with a new head", () => {
    expect(prEvents(before, pr(), ME, false)).toEqual([{ kind: "commits_pushed", ref: NEW_HEAD }]);
    expect(prEvents({ ...before, initialized: false }, pr(), ME, false)).toEqual([]);
    expect(prEvents({ ...before, sourceHead: null }, pr(), ME, false)).toEqual([]);
    expect(prEvents({ ...before, watched: false }, pr(), ME, false)).toEqual([]);
    expect(prEvents(before, pr({ reviewers: [{ slug: ME, name: ME, login: ME, status: "UNAPPROVED" }] }), ME, false)).toEqual([]);
    const reviewedHead = pr({ reviewers: [{ slug: ME, name: ME, login: ME, status: "APPROVED", lastReviewedCommit: NEW_HEAD }] });
    expect(prEvents(before, reviewedHead, ME, false)).toEqual([]);
    expect(prEvents({ ...before, role: "AUTHOR" }, pr({ author: { slug: ME, name: ME, login: ME }, reviewers: [] }), ME, false)).toEqual(
      [],
    );
  });
});

describe("scheduling math", () => {
  test("a normal delay is 60 s times 0.9 to 1.1", () => {
    expect(nextDelay(0, () => 0, 60_000)).toBeCloseTo(54_000);
    expect(nextDelay(0, () => 1, 60_000)).toBeCloseTo(66_000);
  });

  test("the delay follows the configured interval", () => {
    expect(nextDelay(0, () => 0, 300_000)).toBeCloseTo(270_000);
    expect(nextDelay(0, () => 1, 30_000)).toBeCloseTo(33_000);
    expect([1, 2].map((n) => nextDelay(n, () => 1, 300_000))).toEqual([600_000, 900_000]);
  });

  test("offline delays double with full jitter up to 15 min", () => {
    expect([1, 2, 3, 4, 5].map((n) => nextDelay(n, () => 1, 60_000))).toEqual([120_000, 240_000, 480_000, 900_000, 900_000]);
    expect(nextDelay(2, () => 0.5, 60_000)).toBe(120_000);
    expect(nextDelay(3, () => 0, 60_000)).toBe(0);
  });

  test("Retry-After accepts delta seconds only", () => {
    expect(parseRetryAfter("17")).toBe(17_000);
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT")).toBeUndefined();
    expect(parseRetryAfter("-1")).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
  });
});
