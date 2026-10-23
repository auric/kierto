// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The Explain page without a browser (docs/plans/review-v2/spec.md sections 3.1, 3.3, 3.5): diff link decoding, the Markdown links,
// the status of the page, the profile pick, the Markdown copy, and the Drafts questions.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseDiff } from "../../src/server/review/diffmap";
import { diffLinkOk } from "../../src/server/review/judge";
import type { ExplainDto, ProfileDto, ReviewItemDto, RunDto } from "../../src/shared/dto";
import type { ExplainResult } from "../../src/shared/review";
import { linesText, parseDiffLink, placeText, riskLink } from "../../src/web/explain/links";
import { AGAIN, explainMarkdown, explainProfiles, explainView, START, soFar } from "../../src/web/explain/model";
import { Markdown } from "../../src/web/pr/Markdown";
import { latestExplain, runLine, withQuestions } from "../../src/web/review/model";

// src/a.ts changes line 20 of 40, so the diff shows lines 17 to 23. src/old.ts moves to src/new.ts. "src/a b.ts" has a space.
const FILES = parseDiff(
  [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -17,7 +17,7 @@",
    " l17",
    " l18",
    " l19",
    "-l20 old",
    "+l20 new",
    " l21",
    " l22",
    " l23",
    "diff --git a/src/old.ts b/src/new.ts",
    "similarity index 50%",
    "rename from src/old.ts",
    "rename to src/new.ts",
    "--- a/src/old.ts",
    "+++ b/src/new.ts",
    "@@ -1,2 +1,2 @@",
    "-x",
    "+y",
    " z",
    "",
  ].join("\n"),
);

describe("diff links", () => {
  test("each link that the server keeps decodes to its file, side, and lines", () => {
    const cases: [string, ReturnType<typeof parseDiffLink>][] = [
      ["diff:src/a.ts#N20", { path: "src/a.ts", side: "new", line: 20, lineEnd: 20 }],
      ["diff:src/a.ts#N17-N23", { path: "src/a.ts", side: "new", line: 17, lineEnd: 23 }],
      ["diff:src/a.ts#N17-23", { path: "src/a.ts", side: "new", line: 17, lineEnd: 23 }],
      ["diff:src/a.ts#O20", { path: "src/a.ts", side: "old", line: 20, lineEnd: 20 }],
      ["diff:src/old.ts#O1", { path: "src/old.ts", side: "old", line: 1, lineEnd: 1 }],
      ["diff:src%2Fa.ts#N20", { path: "src/a.ts", side: "new", line: 20, lineEnd: 20 }],
    ];
    for (const [href, want] of cases) {
      // The server check (src/server/review/judge.ts diffLinkOk) takes the same link, so the page can open what the run kept.
      expect([href, diffLinkOk(href, FILES)]).toEqual([href, true]);
      expect([href, parseDiffLink(href)]).toEqual([href, want]);
    }
    // react-markdown encodes a space of the href (mdast-util-to-hast normalizeUri). The server reads the raw path.
    expect(parseDiffLink("diff:src/a%20b%C3%BC.ts#N1-N2")).toEqual({ path: "src/a bü.ts", side: "new", line: 1, lineEnd: 2 });
  });

  test("a link of another form, a mixed side, a reversed range, line 0, or a bad escape does not decode", () => {
    for (const href of [
      "diff:src/a.ts",
      "diff:src/a.ts#L20",
      "diff:src/a.ts#N20x",
      "diff:src/a.ts#N20-O21",
      "diff:src/a.ts#N21-N20",
      "diff:src/a.ts#N0",
      "diff:src/a%ZZ.ts#N20",
      "DIFF:src/a.ts#N20",
      "diff:#N1",
      "https://x.test/a#N1",
    ]) {
      expect([href, parseDiffLink(href)]).toEqual([href, null]);
      expect([href, diffLinkOk(href, FILES)]).toEqual([href, false]);
    }
  });

  test("a risk with a place links its lines; the words name the file and the lines", () => {
    const risk = { text: "t", path: "src/cache/flush.ts", side: "new" as const, line: 3, lineEnd: 5, anchorText: "a" };
    const l = riskLink(risk);
    expect(l).toEqual({ path: "src/cache/flush.ts", side: "new", line: 3, lineEnd: 5 });
    expect(placeText(l as NonNullable<typeof l>)).toBe("flush.ts, lines 3 to 5");
    expect(riskLink({ ...risk, lineEnd: null })).toEqual({ path: "src/cache/flush.ts", side: "new", line: 3, lineEnd: 3 });
    expect(linesText({ path: "a.ts", side: "old", line: 2, lineEnd: 2 })).toBe("old line 2");
    expect(riskLink({ ...risk, path: null, line: null, lineEnd: null })).toBeNull();
  });
});

describe("Markdown links (spec.md section 3.5)", () => {
  const text = "See [the lock](diff:src/a.ts#N20), [a space](<diff:src/a b.ts#N1>), [bad](diff:nope), and [j](javascript:alert(1)).";

  test("with links, a diff link is a button and a link that the page cannot open is its text", () => {
    const seen: string[] = [];
    const links = (href: string) => {
      seen.push(href);
      return parseDiffLink(href) ? () => {} : null;
    };
    const html = renderToStaticMarkup(<Markdown text={text} links={links} />);
    // react-markdown gives the href percent-encoded, and the page decodes it once.
    expect(seen).toEqual(["diff:src/a.ts#N20", "diff:src/a%20b.ts#N1", "diff:nope"]);
    expect(html).toMatch(/<button type="button" data-diff-link="true" class="[^"]*">the lock<\/button>/);
    expect(html).toMatch(/<button type="button" data-diff-link="true" class="[^"]*">a space<\/button>/);
    expect(html).toContain(", bad, and j.");
    expect(html).not.toContain("diff:");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
  });

  test("without links, a diff link is its text and never an href", () => {
    const html = renderToStaticMarkup(<Markdown text={text} />);
    expect(html).toContain("See the lock, a space, bad, and j.");
    expect(html).not.toContain("diff:");
    expect(html).not.toContain("<button");
  });
});

const run = (o: Partial<RunDto> = {}): RunDto => ({
  id: 9,
  pr: 7,
  kind: "explain",
  profile: "explain",
  profileName: "Explain",
  explain: true,
  note: "",
  status: "completed",
  errorKind: null,
  errorText: null,
  sourceHead: "abc1234def".padEnd(40, "0"),
  targetHead: "b".repeat(40),
  mergeBase: "c".repeat(40),
  via: "pull-request-ref",
  sessionId: null,
  cliVersion: "2.1.295",
  model: null,
  effort: null,
  effortDefault: null,
  effortNow: false,
  usage: null,
  summary: null,
  startedAt: 60_000,
  finishedAt: 300_000,
  stale: null,
  hasRaw: true,
  since: null,
  question: null,
  findings: 0,
  ...o,
});

const RESULT: ExplainResult = {
  summary: "The lock moves into the loop.",
  walkthrough: "## Locking\n\nSee [the lock](diff:src/a.ts#N20).",
  order: [{ path: "src/a.ts", why: "The lock moves here." }],
  files: [{ path: "src/a.ts", role: "core", summary: "Takes the lock per entry." }],
  risks: [
    { text: "A reader sees a partial batch.", path: "src/a.ts", side: "new", line: 20, lineEnd: null, anchorText: "l20 new" },
    { text: "No test covers it.", path: null, side: "new", line: null, lineEnd: null, anchorText: "" },
  ],
  glossary: [{ term: "Batch", meaning: "The dirty entries of one flush." }],
  questions: [{ text: "Must flush stay atomic?", why: "The description does not say." }],
  coverage: { read: ["src/a.ts"], skipped: [], unavailable: [], notChecked: [] },
};

describe("the status of the page (spec.md sections 3.1 and 7.1)", () => {
  test("no run: one primary button and the time line", () => {
    expect(explainView(null, "Claude")).toEqual({
      kind: "none",
      sentence: "Claude reads the change and writes a walkthrough. About 3 to 6 min.",
      primary: START,
      run: null,
      shown: null,
    });
  });

  test("a current result has no status sentence and no primary button", () => {
    const v = explainView({ run: run(), result: RESULT }, "Claude");
    expect([v.kind, v.sentence, v.primary]).toEqual(["done", null, null]);
    expect(v.shown?.result).toBe(RESULT);
  });

  test("AC-X7: a result for older heads says the PR changed and offers Explain again", () => {
    const v = explainView({ run: run({ stale: { source: true, target: false } }), result: RESULT }, "Claude");
    expect([v.kind, v.sentence, v.primary]).toEqual(["stale", "The PR changed after this walkthrough.", AGAIN]);
    expect(v.shown?.result).toBe(RESULT);
  });

  test("a running run names the actor and shows the earlier walkthrough meanwhile", () => {
    const previous = { run: run({ id: 8 }), result: RESULT };
    const v = explainView({ run: run({ status: "running", finishedAt: null }), result: null, previous }, "Claude");
    expect([v.kind, v.sentence, v.primary]).toEqual(["running", "Claude is reading the change.", null]);
    expect(v.shown).toBe(previous);
    expect(soFar(60_000, 60_000 + 59_000)).toBe("Under 1 min so far.");
    expect(soFar(60_000, 60_000 + 125_000)).toBe("2 min so far.");
  });

  test("a failed, limited, or cancelled run names the cause, offers Explain again, and keeps the earlier walkthrough", () => {
    const previous = { run: run({ id: 8 }), result: RESULT };
    const failed = explainView(
      { run: run({ status: "failed", errorText: "The CLI exited with code 1." }), result: null, previous },
      "Claude",
    );
    expect([failed.kind, failed.sentence, failed.primary]).toEqual([
      "failed",
      "The walkthrough failed. The CLI exited with code 1.",
      AGAIN,
    ]);
    expect(failed.shown).toBe(previous);
    const silent = explainView({ run: run({ status: "failed" }), result: null }, "Claude");
    expect([silent.sentence, silent.shown]).toEqual(["The walkthrough failed. No reason was recorded.", null]);
    const limit = explainView(
      { run: run({ status: "failed", errorKind: "usage_limit", errorText: "Resets at 5pm." }), result: null },
      "Claude",
    );
    expect(limit.sentence).toBe("Claude: Resets at 5pm. PR Review Inbox does not retry by itself.");
    const cancelled = explainView({ run: run({ status: "cancelled" }), result: null }, "Claude");
    expect([cancelled.kind, cancelled.sentence, cancelled.primary]).toEqual(["cancelled", "You cancelled the walkthrough.", AGAIN]);
    const unread = explainView({ run: run(), result: null } as ExplainDto, "Claude");
    expect([unread.kind, unread.primary]).toEqual(["failed", AGAIN]);
  });

  test("the profile pick: the profile of the shown run, then the brief profile, then the first Explain profile", () => {
    const p = (id: string, explain: boolean) => ({ id, name: id, explain }) as ProfileDto;
    const [general, explain, deep] = [p("general", false), p("explain", true), p("deep", true)];
    const list = [general, explain, deep];
    expect(explainProfiles(list, "general", undefined)).toEqual({ list: [explain, deep], pick: "explain" });
    expect(explainProfiles(list, "deep", undefined).pick).toBe("deep");
    expect(explainProfiles(list, "explain", "deep").pick).toBe("deep");
    expect(explainProfiles(list, "general", "gone").pick).toBe("explain");
    expect(explainProfiles([p("general", false)], "general", undefined)).toEqual({ list: [], pick: null });
  });
});

test("Copy as Markdown gives every part of the page in its order, with the walkthrough as the run wrote it", () => {
  expect(explainMarkdown(RESULT, "Batch cache writes", run())).toBe(
    [
      "# Walkthrough: Batch cache writes",
      "",
      "Head abc1234. The lock moves into the loop.",
      "",
      "## Read in this order",
      "",
      "1. `src/a.ts`: The lock moves here.",
      "",
      "## Walkthrough",
      "",
      "## Locking",
      "",
      "See [the lock](diff:src/a.ts#N20).",
      "",
      "## Risks",
      "",
      "- A reader sees a partial batch. (`src/a.ts`, line 20)",
      "- No test covers it.",
      "",
      "## Files",
      "",
      "- `src/a.ts` (Core): Takes the lock per entry.",
      "",
      "## Words used",
      "",
      "- **Batch**: The dirty entries of one flush.",
      "",
    ].join("\n"),
  );
});

describe("the explain run in the review record and the Drafts", () => {
  const item = (id: number, kind: ReviewItemDto["kind"], runId: number) =>
    ({ id, run: runId, kind, body: "b", payload: {}, anchor: null, status: "new", revision: 1, edited: false }) as unknown as ReviewItemDto;

  test("the Drafts take the questions of the newest explain run with a result after the review items", () => {
    const review = [item(1, "finding", 3), item(2, "question", 3)];
    expect(withQuestions(review, undefined)).toBe(review);
    expect(withQuestions(review, [])).toBe(review);
    expect(withQuestions(review, [item(5, "question", 9)]).map((i) => i.id)).toEqual([1, 2, 5]);
    const runs = [
      run({ id: 12, status: "running" }),
      run({ id: 11, status: "failed" }),
      run({ id: 10, status: "incomplete" }),
      run({ id: 9 }),
    ];
    expect(latestExplain(runs)?.id).toBe(10);
    expect(latestExplain([run({ kind: "review" })])).toBeNull();
  });

  test("a done explain row says that it explained the change, with its question count", () => {
    const r = run();
    expect(runLine(r, { run: r, events: [], items: [item(5, "question", 9)] }, [])).toMatchObject({
      kind: "done",
      result: "Explained the change, 1 question",
    });
    expect(runLine(r, undefined, [])).toMatchObject({ kind: "done", result: "Explained the change" });
  });
});
