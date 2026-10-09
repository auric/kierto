import { describe, expect, test } from "bun:test";
import type { PrRow, SyncStatus } from "../../src/shared/dto";
import {
  ago,
  badges,
  filterRows,
  followCandidate,
  incompleteText,
  initials,
  repoCounts,
  statusInfo,
  unreadTotal,
  viewCounts,
} from "../../src/web/shell/model";

const row = (o: Partial<PrRow>): PrRow => ({
  id: 1,
  project: "PROJ1",
  repo: "repo",
  prId: 1,
  title: "A change",
  authorSlug: "other",
  authorName: "Other Person",
  role: "REVIEWER",
  state: "OPEN",
  status: "UNAPPROVED",
  sourceBranch: "feature",
  targetBranch: "main",
  webUrl: null,
  reviewers: [],
  onDashboard: true,
  followed: true,
  unread: 0,
  reasons: [],
  lastActivity: 0,
  checkpoint: null,
  ...o,
});

const texts = (p: PrRow) => badges(p).map((b) => b.text);

describe("badge text", () => {
  test("unread count and reasons are text", () => {
    expect(texts(row({ unread: 3, reasons: ["reply_to_you", "review_requested"] }))).toEqual(["3 new", "Reply to you", "Review requested"]);
    expect(texts(row({ reasons: ["new_commits"] }))).toEqual(["New commits since your review"]);
  });

  test("a closed PR names its state", () => {
    expect(texts(row({ state: "MERGED", reasons: ["closed"] }))).toEqual(["Merged"]);
    expect(texts(row({ state: "DECLINED", reasons: ["closed"] }))).toEqual(["Declined"]);
    expect(texts(row({ state: "OTHER", reasons: ["closed"] }))).toEqual(["Closed"]);
  });

  test("an unfollowed dashboard row says so", () => {
    expect(texts(row({ followed: false }))).toEqual(["Not followed"]);
    expect(texts(row({}))).toEqual([]);
  });

  test("every badge has a tone and a text", () => {
    for (const b of badges(row({ unread: 1, reasons: ["reply_to_you", "new_commits", "closed"], followed: false }))) {
      expect(b.text.length).toBeGreaterThan(0);
    }
  });

  test("an incomplete check has text", () => {
    expect(incompleteText(null)).toBeNull();
    expect(incompleteText({ lastCompleteAt: 1, reason: null, error: null })).toBeNull();
    expect(incompleteText({ lastCompleteAt: 1, reason: "server", error: "500" })).toBe("Last check incomplete: Bitbucket server error");
  });
});

describe("sidebar counts", () => {
  const prs = [
    row({ id: 1, unread: 2 }),
    row({ id: 2, status: "APPROVED" }),
    row({ id: 3, role: "AUTHOR", status: null, repo: "other", unread: 1 }),
    row({ id: 4, state: "MERGED", reasons: ["closed"], unread: 4 }),
    row({ id: 5, followed: false, repo: "other" }),
  ];

  test("each view counts its rows", () => {
    expect(viewCounts(prs)).toEqual({ needs: 3, reviewing: 3, mine: 1, following: 4 });
    expect(viewCounts([])).toEqual({ needs: 0, reviewing: 0, mine: 0, following: 0 });
  });

  test("repositories list unread counts by name", () => {
    expect(repoCounts(prs)).toEqual([
      { repo: "PROJ1/other", unread: 1 },
      { repo: "PROJ1/repo", unread: 6 },
    ]);
    expect(unreadTotal(prs)).toBe(7);
  });

  test("the filter matches title, key, and author within the view and repository", () => {
    expect(filterRows(prs, "needs", null, "").map((p) => p.id)).toEqual([1, 3, 4]);
    expect(filterRows(prs, "needs", "PROJ1/other", "").map((p) => p.id)).toEqual([3]);
    expect(filterRows(prs, "following", null, "proj1/repo #1").map((p) => p.id)).toEqual([1, 2, 4]);
    expect(filterRows([row({ id: 9, authorName: "Ada Lovelace", title: null })], "following", null, "ada").map((p) => p.id)).toEqual([9]);
    expect(filterRows(prs, "needs", null, "zzz")).toEqual([]);
  });
});

describe("follow by URL in the filter", () => {
  const base = "https://bitbucket.example.test/context";

  test("a PR URL on the configured origin is a candidate", () => {
    expect(followCandidate("https://bitbucket.example.test/projects/PROJ/repos/app/pull-requests/12/overview", base)).toEqual({
      project: "PROJ",
      repo: "app",
      id: 12,
    });
    expect(followCandidate("  https://bitbucket.example.test/users/jdoe/repos/r/pull-requests/2  ", base)).toEqual({
      project: "~JDOE",
      repo: "r",
      id: 2,
    });
  });

  test("other text, other origins, and no config give no candidate", () => {
    expect(followCandidate("fix login", base)).toBeNull();
    expect(followCandidate("https://other.example.test/projects/PROJ/repos/app/pull-requests/12", base)).toBeNull();
    expect(followCandidate("https://bitbucket.example.test/projects/PROJ/repos/app", base)).toBeNull();
    expect(followCandidate("https://bitbucket.example.test/projects/PROJ/repos/app/pull-requests/12", null)).toBeNull();
  });
});

describe("row text helpers", () => {
  test("initials and relative time", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("Ada King Lovelace")).toBe("AL");
    expect(initials("jdoe")).toBe("JD");
    expect(initials(null)).toBe("?");
    expect(ago(1_000, 1_000)).toBe("now");
    expect(ago(0, 5 * 60_000)).toBe("5m");
    expect(ago(0, 3 * 3_600_000)).toBe("3h");
    expect(ago(0, 2 * 86_400_000)).toBe("2d");
  });
});

describe("check status text", () => {
  const s = (o: Partial<SyncStatus>): SyncStatus => ({
    running: false,
    state: "ok",
    lastCompleteAt: null,
    nextAt: null,
    error: null,
    ...o,
  });
  const at = new Date(2026, 0, 1, 9, 5).getTime();

  test("each state reads as text", () => {
    expect(statusInfo(s({ lastCompleteAt: at }), at)).toEqual({ text: "Checked 09:05", tone: "ok" });
    expect(statusInfo(s({ running: true }), at).text).toBe("Checking…");
    expect(statusInfo(s({ state: "offline", lastCompleteAt: at, nextAt: at + 41_200 }), at).text).toBe(
      "Offline. Last checked 09:05. Next try in 42 s.",
    );
    expect(statusInfo(s({ state: "auth" }), at).text).toBe("Bitbucket rejected the token");
    expect(statusInfo(s({ state: "unconfigured" }), at).text).toBe("Not configured");
    expect(statusInfo(s({ state: "error", error: "Cannot read the CA file (ENOENT)." }), at).text).toBe(
      "Cannot read the CA file (ENOENT).",
    );
  });
});
