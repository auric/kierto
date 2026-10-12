import { describe, expect, test } from "bun:test";
import type { PrRow } from "../../src/shared/dto";
import { byInbox, VIEWS } from "../../src/shared/views";

const row = (o: Partial<PrRow>): PrRow => ({
  id: 1,
  project: "PROJ1",
  repo: "repo",
  prId: 1,
  title: "A change",
  authorSlug: "other",
  authorName: "Other",
  role: "REVIEWER",
  state: "OPEN",
  status: "UNAPPROVED",
  sourceBranch: "feature",
  targetBranch: "main",
  webUrl: null,
  sourceBranchUrl: null,
  targetBranchUrl: null,
  reviewers: [],
  onDashboard: true,
  followed: true,
  unread: 0,
  group: "quiet",
  yourTurn: 0,
  cause: null,
  waitSince: null,
  seenAt: null,
  tasks: [],
  lastActivity: 0,
  checkpoint: null,
  ...o,
});

const views = (r: PrRow) => (Object.keys(VIEWS) as (keyof typeof VIEWS)[]).filter((v) => VIEWS[v](r));

describe("view predicates", () => {
  test("an open review that I did not approve needs me", () => {
    expect(views(row({}))).toEqual(["needs", "reviewing", "following"]);
    expect(views(row({ status: "NEEDS_WORK" }))).toEqual(["needs", "reviewing", "following"]);
  });

  test("an approved review needs me only with unread messages", () => {
    expect(views(row({ status: "APPROVED" }))).toEqual(["reviewing", "following"]);
    expect(views(row({ status: "APPROVED", unread: 2 }))).toEqual(["needs", "reviewing", "following"]);
  });

  test("my own PR shows in My PRs", () => {
    expect(views(row({ role: "AUTHOR", status: null }))).toEqual(["mine", "following"]);
  });

  test("an unfollowed dashboard PR shows only in its role view", () => {
    expect(views(row({ followed: false }))).toEqual(["reviewing"]);
  });

  test("a merged PR with unread replies needs me and stays in Following (A15)", () => {
    expect(views(row({ state: "MERGED", unread: 2, onDashboard: false }))).toEqual(["needs", "following"]);
    expect(views(row({ state: "MERGED", onDashboard: false }))).toEqual(["following"]);
  });

  test("a read your-turn PR needs me", () => {
    expect(views(row({ status: "APPROVED", yourTurn: 1, group: "your" }))).toEqual(["needs", "reviewing", "following"]);
    expect(views(row({ status: "APPROVED", yourTurn: 1, followed: false }))).toEqual(["reviewing"]);
  });

  test("sort follows the reason order, then unread first, then the newest activity", () => {
    const list = [
      row({ id: 1, lastActivity: 5, group: "quiet" }),
      row({ id: 2, lastActivity: 1, unread: 1, group: "comments" }),
      row({ id: 3, lastActivity: 9, group: "comments" }),
      row({ id: 4, lastActivity: 0, group: "your" }),
      row({ id: 5, lastActivity: 7, group: "closed", unread: 0 }),
      row({ id: 6, lastActivity: 8, group: "waiting" }),
      row({ id: 7, lastActivity: 2, group: "review" }),
    ];
    expect(list.sort(byInbox).map((r) => r.id)).toEqual([4, 7, 2, 3, 6, 1, 5]);
  });
});
