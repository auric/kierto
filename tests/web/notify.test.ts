import { describe, expect, test } from "bun:test";
import type { ClaimedEvent } from "../../src/shared/dto";
import { planNotes } from "../../src/web/notify";

let n = 0;
const ev = (pr: number, o: Partial<ClaimedEvent> = {}): ClaimedEvent => ({
  id: ++n,
  pr,
  kind: "comment_new",
  ref: String(n),
  createdAt: n,
  digest: false,
  project: "PROJ1",
  repo: `repo-${pr}`,
  prId: pr * 10,
  title: `Change ${pr}`,
  ...o,
});

describe("planNotes", () => {
  test("no events give no notification", () => {
    expect(planNotes([], true)).toEqual([]);
  });

  test("one notification per PR, tagged with the PR key", () => {
    const notes = planNotes([ev(1), ev(2), ev(1), ev(1, { kind: "commits_pushed" })], false);
    expect(notes).toEqual([
      { title: "Change 1", body: "PROJ1/repo-1 #10: 2 new comments, new commits", tag: "PROJ1/repo-1 #10", pr: 1 },
      { title: "Change 2", body: "PROJ1/repo-2 #20: 1 new comment", tag: "PROJ1/repo-2 #20", pr: 2 },
    ]);
  });

  test("the first claim of a tab gives one digest", () => {
    expect(planNotes([ev(1), ev(2), ev(2)], true)).toEqual([
      { title: "Review Loop", body: "3 updates in 2 pull requests", tag: "digest", pr: null },
    ]);
  });

  test("a batch with a digest event gives one digest", () => {
    const notes = planNotes([ev(1), ev(2, { digest: true })], false);
    expect(notes.map((x) => x.pr)).toEqual([null]);
  });

  test("a PR without a title uses its key", () => {
    expect(planNotes([ev(3, { title: null, kind: "reviewer_added" })], false)[0]).toMatchObject({
      title: "PROJ1/repo-3 #30",
      body: "PROJ1/repo-3 #30: review requested",
    });
  });
});
