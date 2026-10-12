// Plan v3 WP11, replies.md WP18, and r2 UI-RR: the pure review UI rules. The log tree, the run line, the brief state,
// the Review runs view, the reply drafts, and the re-review.
import { describe, expect, test } from "bun:test";
import type { BriefDto, ProfileDto, PrRow, ReviewItemDto, RunDetail, RunDto } from "../../src/shared/dto";
import type { AnchoredFinding, Carried, Question, ReplyPayload } from "../../src/shared/review";
import type { RunEvent } from "../../src/shared/run-log";
import {
  agentInfo,
  agentPath,
  anchorNote,
  briefState,
  carriedNote,
  closedLabel,
  countText,
  draftExcerpt,
  latestByPr,
  latestReview,
  limitText,
  logTree,
  RUN_TEXT,
  repliesButton,
  replyCard,
  replyMap,
  rereviewCount,
  rereviewState,
  runLine,
  runRows,
  runWhy,
  tokenTotal,
  triageText,
} from "../../src/web/review/model";

const ev = (id: string, seq: number, o: Partial<RunEvent> = {}): RunEvent => ({
  id,
  seq,
  parent: null,
  tool: "Read",
  target: `src/${id}.ts`,
  status: "ok",
  note: null,
  agent: null,
  startedAt: 1000 + seq,
  endedAt: 1100 + seq,
  ...o,
});
const agent = (id: string, seq: number, name: string, o: Partial<RunEvent> = {}) =>
  ev(id, seq, { tool: "Agent", agent: name, target: `Check ${name}`, ...o });
const shape = (nodes: ReturnType<typeof logTree>): unknown[] => nodes.map((n) => (n.kids.length ? [n.e.id, shape(n.kids)] : n.e.id));

const PROFILES: ProfileDto[] = [
  { id: "general", name: "General", note: "", explain: false, maxTurns: 40 },
  { id: "security", name: "Security", note: "", explain: false, maxTurns: 40 },
  { id: "explain", name: "Explain", note: "", explain: true, maxTurns: 12 },
];

const run = (o: Partial<RunDto> = {}): RunDto => ({
  id: 1,
  pr: 7,
  kind: "review",
  profile: "general",
  profileName: "General",
  explain: null,
  note: "",
  status: "completed",
  errorKind: null,
  errorText: null,
  sourceHead: "a3f9e2100000000000000000000000000000000",
  targetHead: "b".repeat(40),
  mergeBase: "c".repeat(40),
  via: "pull-request-ref",
  sessionId: null,
  cliVersion: "2.1.295",
  model: "m",
  usage: null,
  summary: null,
  startedAt: 1_000,
  finishedAt: 61_000,
  stale: null,
  hasRaw: true,
  since: null,
  question: null,
  ...o,
});

const anchor = { state: "exact" as const, path: "src/a.ts", oldPath: null, line: 12, lineEnd: 12, excerpt: [] };
const finding = (id: number, o: Partial<ReviewItemDto> = {}, f: Partial<AnchoredFinding> = {}): ReviewItemDto => {
  const payload: AnchoredFinding = {
    path: "src/a.ts",
    side: "new",
    line: 12,
    lineEnd: null,
    anchorText: "x",
    severity: "major",
    category: "Correctness",
    body: "Body.",
    evidence: "",
    evidenceStatus: "code",
    confidence: "high",
    agent: null,
    anchor,
    ...f,
  };
  return {
    id,
    run: 1,
    kind: "finding",
    body: payload.body,
    payload,
    anchor: { ...payload.anchor, side: payload.side },
    status: "new",
    revision: 0,
    edited: false,
    ...o,
  };
};
const question = (id: number): ReviewItemDto => ({
  id,
  run: 1,
  kind: "question",
  body: "Why?",
  payload: { text: "Why?", why: "Because." } satisfies Question,
  anchor: null,
  status: "new",
  revision: 0,
  edited: false,
});
const detail = (r: RunDto, events: RunEvent[] = [], items: ReviewItemDto[] = []): RunDetail => ({ run: r, events, items });

describe("log tree", () => {
  test("a run without parents is a flat list in seq order", () => {
    expect(shape(logTree([ev("b", 2), ev("a", 1), ev("c", 3)]))).toEqual(["a", "b", "c"]);
  });

  test("events nest under the Agent call named by parent, at any depth", () => {
    const events = [
      ev("r1", 0),
      agent("ag1", 1, "correctness"),
      agent("ag2", 2, "concurrency"),
      ev("c1", 3, { parent: "ag1" }),
      agent("ag3", 4, "callers-scan", { parent: "ag2" }),
      ev("c2", 5, { parent: "ag3" }),
      ev("c3", 6, { parent: "ag2" }),
    ];
    expect(shape(logTree(events))).toEqual(["r1", ["ag1", ["c1"]], ["ag2", [["ag3", ["c2"]], "c3"]]]);
  });

  test("an unknown parent and a parent cycle fall back to the top level", () => {
    expect(shape(logTree([ev("a", 1, { parent: "gone" }), ev("b", 2)]))).toEqual(["a", "b"]);
    const cycle = logTree([ev("x", 1, { parent: "y" }), ev("y", 2, { parent: "x" }), ev("self", 3, { parent: "self" })]);
    expect(shape(cycle)).toEqual(["self", ["x", ["y"]]]);
  });

  test("an agent row counts its own finished calls, not nested agents or running calls", () => {
    const [ag] = logTree([
      agent("ag", 1, "concurrency", { status: "running", endedAt: null }),
      ev("c1", 2, { parent: "ag" }),
      ev("c2", 3, { parent: "ag", status: "running", endedAt: null }),
      agent("sub", 4, "callers-scan", { parent: "ag" }),
      ev("c3", 5, { parent: "sub" }),
    ]);
    expect(ag && agentInfo(ag)).toEqual({ calls: 1, words: "1 tool call so far" });
  });

  test("agentPath names the first agent with that name and its ancestors", () => {
    const events = [agent("ag2", 1, "concurrency"), agent("ag3", 2, "callers-scan", { parent: "ag2" }), agent("ag4", 3, "callers-scan")];
    expect(agentPath(events, "callers-scan")).toEqual(["ag3", "ag2"]);
    expect(agentPath(events, "nobody")).toEqual([]);
  });
});

describe("run line", () => {
  const events = [ev("r1", 0), agent("ag", 1, "x", { status: "running", endedAt: null }), ev("c1", 2, { parent: "ag" })];

  test("running: agents, finished tool calls, and the start", () => {
    expect(runLine(detail(run({ status: "running", finishedAt: null }), events), PROFILES)).toEqual({
      kind: "running",
      agents: 1,
      calls: 2,
      startedAt: 1_000,
    });
  });

  test("completed: verb, short head, counts, and tokens", () => {
    const usage = {
      costUsd: 0,
      turns: 3,
      durationMs: 1,
      tokens: { input_tokens: 6, output_tokens: 1897, cache_read_input_tokens: 12131, other: 5 },
    };
    const l = runLine(detail(run({ usage }), [], [finding(1), finding(2), question(3)]), PROFILES);
    expect(l).toMatchObject({ kind: "done", verb: "reviewed", head: "a3f9e21", at: 61_000, count: "2 findings, 1 question", gaps: false });
    expect(l.kind === "done" && l.tokens).toBe(14034);
    expect(runLine(detail(run({ profile: "explain" }), [], [question(1)]), PROFILES)).toMatchObject({
      verb: "explained",
      count: "1 question",
    });
    // The flag stored at the start wins over the current profile. null falls back to the current profile.
    expect(runLine(detail(run({ profile: "explain", explain: false })), PROFILES)).toMatchObject({ verb: "reviewed" });
    expect(runLine(detail(run({ profile: "gone", explain: true })), PROFILES)).toMatchObject({ verb: "explained" });
  });

  test("incomplete never says no issues; complete without items says no findings", () => {
    expect(runLine(detail(run({ status: "incomplete" })), PROFILES)).toMatchObject({ count: "No findings in what it read", gaps: true });
    expect(runLine(detail(run()), PROFILES)).toMatchObject({ count: "No findings", gaps: false });
    expect(countText([question(1)], true)).toBe("No findings in what it read, 1 question");
  });

  test("stale: the commits since the reviewed head, else the target branch", () => {
    const commits = ["new2", "new1", "a3f9e2100000000000000000000000000000000"].map((hash) => ({ hash, message: "", author: "", at: 0 }));
    const stale = (s: RunDto["stale"], c = commits) => {
      const l = runLine(detail(run({ stale: s })), PROFILES, c);
      return l.kind === "done" ? l.since : "?";
    };
    expect(stale({ source: true, target: false })).toBe("2 commits since");
    expect(stale({ source: true, target: true }, [])).toBe("New commits since");
    expect(stale({ source: false, target: true })).toBe("The target branch moved since");
    expect(stale(null)).toBeNull();
  });

  test("failed, usage limit, and cancelled", () => {
    const failed = run({ status: "failed", errorKind: "schema", errorText: "The result does not match the review schema." });
    expect(runLine(detail(failed), PROFILES)).toEqual({ kind: "failed", text: "The result does not match the review schema.", raw: true });
    expect(runLine(detail({ ...failed, errorText: null, hasRaw: false }), PROFILES)).toEqual({
      kind: "failed",
      text: "No reason was recorded.",
      raw: false,
    });
    const limit = run({ status: "failed", errorKind: "usage_limit", errorText: "Usage limit reached." });
    expect(runLine(detail(limit), PROFILES)).toEqual({ kind: "limit", text: "Usage limit reached." });
    const stopped = run({ status: "cancelled" });
    expect(runLine(detail(stopped, events), PROFILES)).toEqual({ kind: "cancelled", calls: 2 });
  });

  test("the usage limit line quotes the CLI message and says that nothing retries", () => {
    expect(limitText("Runner", "Usage limit reached. Your limit resets at 6pm.")).toBe(
      "Runner: Usage limit reached. Your limit resets at 6pm. Review Loop does not retry by itself.",
    );
    expect(limitText("Runner", null)).toBe("Runner usage limit reached. Review Loop does not retry by itself.");
  });

  test("tokens add the four usage counters and skip other fields", () => {
    expect(tokenTotal(null)).toBeNull();
    expect(tokenTotal({ costUsd: 0, turns: 0, durationMs: 0, tokens: {} })).toBeNull();
    expect(
      tokenTotal({ costUsd: 0, turns: 0, durationMs: 0, tokens: { input_tokens: 1, cache_creation_input_tokens: 2, output_tokens: "3" } }),
    ).toBe(3);
  });
});

describe("brief state", () => {
  const brief = (o: Partial<BriefDto> = {}): BriefDto => ({ note: "", profile: "general", updatedAt: null, ...o });

  test("r opens the composer only without a stored brief and without a run", () => {
    expect(briefState(brief(), null, null, 7, PROFILES).rerun).toBe("compose");
    expect(briefState(undefined, null, null, 7, PROFILES).rerun).toBe("compose");
    expect(briefState(brief({ updatedAt: 5 }), null, null, 7, PROFILES).rerun).toBe("start");
    expect(briefState(brief(), run(), null, 7, PROFILES).rerun).toBe("start");
  });

  test("the button names the stored profile, and the hint names r and the note", () => {
    const s = briefState(brief({ profile: "security", note: "Check X", updatedAt: 5 }), null, null, 7, PROFILES);
    expect(s.name).toBe("Security");
    expect(s.hint).toBe("Run the review brief: Security with your note. Key: r. Shift+R opens the brief.");
    expect(briefState(brief(), null, null, 7, PROFILES).hint).toBe("Open the review brief: task, your note, and profile. Key: r.");
    expect(briefState(brief({ profile: "over" }), null, null, 7, PROFILES).name).toBe("General");
  });

  test("busy names the PR of a running review", () => {
    expect(briefState(brief(), null, run({ pr: 9, status: "running" }), 7, PROFILES).busy).toEqual({ pr: 9, same: false });
    expect(briefState(brief(), null, run({ pr: 7, status: "running" }), 7, PROFILES).busy).toEqual({ pr: 7, same: true });
    expect(briefState(brief(), null, null, 7, PROFILES).busy).toBeNull();
  });
});

describe("drafts", () => {
  test("the excerpt marks the anchored lines on the finding's side", () => {
    const excerpt = [
      { n: 11, kind: "ctx" as const, text: "a" },
      { n: 12, kind: "del" as const, text: "old" },
      { n: 12, kind: "add" as const, text: "new" },
      { n: 13, kind: "add" as const, text: "next" },
      { n: 14, kind: "ctx" as const, text: "z" },
    ];
    const lines = draftExcerpt({ ...anchor, line: 12, lineEnd: 13, excerpt, side: "new" });
    expect(lines.map((l) => l.hit)).toEqual([false, false, true, true, false]);
  });

  test("anchor notes: outside, moved by you, moved, exact", () => {
    expect(anchorNote(finding(1, { anchor: { ...anchor, state: "outside", side: "new" } }))).toBe(
      "Outside the diff. Posts as a general comment with a link to a.ts:12.",
    );
    expect(anchorNote(finding(1, { anchor: { ...anchor, line: 14, lineEnd: 14, side: "new" } }))).toBe("You moved it from line 12.");
    expect(anchorNote(finding(1, {}, { line: 9, anchor: { ...anchor, state: "moved" } }))).toBe(
      "Moved from line 9: the quoted code is on line 12.",
    );
    expect(anchorNote(finding(1))).toBeNull();
  });

  test("triage text: each action says what happened to the item that loses the focus", () => {
    const accepted = finding(1, { status: "accepted" });
    expect(triageText(finding(1), accepted, "accept")).toBe("Accepted.");
    expect(triageText(finding(1), finding(1, { status: "discarded" }), "discard")).toBe("Discarded.");
    expect(triageText(accepted, finding(1), "restore")).toBe("Accept undone.");
    expect(triageText(finding(1, { status: "discarded" }), finding(1), "restore")).toBe("Restored.");
    expect(triageText(finding(1), accepted, "edit")).toBe("Saved and accepted.");
    expect(triageText(finding(1), finding(1, { anchor: { ...anchor, line: 13, lineEnd: 14, side: "new" } }), "move")).toBe(
      "Moved to line 13–14.",
    );
    expect(triageText(question(2), question(2), "move")).toBe("Moved.");
  });
});

describe("Review runs view", () => {
  const pr = (id: number, title: string): PrRow => ({ id, title, project: "P", repo: "r", prId: id, tasks: [] }) as unknown as PrRow;

  test("one row per PR with a run: running first, then the newest run", () => {
    const runs = [
      run({ id: 5, pr: 2, startedAt: 50 }),
      run({ id: 4, pr: 3, status: "running", startedAt: 40 }),
      run({ id: 3, pr: 2, startedAt: 30 }),
    ];
    const latest = latestByPr(runs);
    expect([...latest].map(([p, r]) => [p, r.id])).toEqual([
      [2, 5],
      [3, 4],
    ]);
    const rows = runRows([pr(1, "No run"), pr(2, "Two"), pr(3, "Three")], latest, "");
    expect(rows.map((p) => p.id)).toEqual([3, 2]);
    expect(runRows([pr(2, "Two"), pr(3, "Three")], latest, "thr").map((p) => p.id)).toEqual([3]);
  });

  test("the why-line names the profile and the outcome", () => {
    expect(runWhy(run({ status: "running" }))).toEqual({ error: null, lead: null, text: "General: reviewing now." });
    const summary = {
      summary: "Deadlock risk.",
      risks: [],
      coverage: { read: [], skipped: [], unavailable: [], notChecked: [] },
      dropped: [],
    };
    expect(runWhy(run({ summary }))).toEqual({ error: null, lead: "General:", text: "Deadlock risk." });
    expect(runWhy(run({ status: "incomplete", summary })).text).toBe("Deadlock risk. Coverage has gaps.");
    expect(runWhy(run({ status: "failed", errorKind: "usage_limit", errorText: "Resets at 6pm." }))).toEqual({
      error: "Usage limit",
      lead: null,
      text: "General: Resets at 6pm.",
    });
    expect(runWhy(run({ status: "failed", errorKind: "schema", errorText: "Bad." })).error).toBe("Failed");
    expect(runWhy(run({ status: "cancelled" })).text).toBe("General: you cancelled it.");
  });

  test("the why-line keeps the profile name of the run start after a rename", () => {
    expect(runWhy(run({ status: "cancelled", profile: "general", profileName: "Correctness" })).text).toBe(
      "Correctness: you cancelled it.",
    );
  });
});

describe("reply drafts", () => {
  const reply = (
    id: number,
    thread: number,
    replyTo: number,
    o: Partial<ReviewItemDto> = {},
    p: Partial<ReplyPayload> = {},
  ): ReviewItemDto => {
    const payload: ReplyPayload = {
      thread,
      action: "reply",
      body: "Fixed.",
      reason: "It asks for a change.",
      evidenceStatus: "code",
      replyTo,
      ...p,
    };
    return { id, run: 2, kind: "reply", body: payload.body, payload, anchor: null, status: "new", revision: 0, edited: false, ...o };
  };

  test("R14: the newest review run drives the drafts, even after a newer reply run", () => {
    const runs = [run({ id: 9, kind: "reply" }), run({ id: 8, kind: "reply" }), run({ id: 7 }), run({ id: 3 })];
    expect(latestReview(runs)?.id).toBe(7);
    expect(latestReview([run({ id: 9, kind: "reply" })])).toBeNull();
    expect(latestReview(undefined)).toBeNull();
  });

  test("the run line names the kind of the newest run", () => {
    const items = [
      reply(1, 101, 105),
      reply(2, 102, 205),
      reply(3, 103, 305, { body: "", status: "discarded" }, { action: "none", body: "" }),
    ];
    expect(runLine(detail(run({ kind: "reply" }), [], items), PROFILES)).toMatchObject({
      kind: "done",
      verb: "drafted replies on",
      count: "2 reply drafts, 1 thread needs no reply",
    });
    // An explain profile explains a review, but a reply run still drafts replies.
    expect(runLine(detail(run({ kind: "reply", profile: "explain" })), PROFILES)).toMatchObject({
      verb: "drafted replies on",
      count: "No reply drafts",
    });
    expect(countText([reply(3, 103, 305, {}, { action: "none" }), reply(4, 104, 405, {}, { action: "none" })], false, "reply")).toBe(
      "No reply drafts, 2 threads need no reply",
    );
    expect(RUN_TEXT.reply).toEqual({
      running: "Drafting replies…",
      failed: "Reply drafts failed.",
      cancelled: "the reply drafts",
      doing: "drafting replies for",
      now: "drafting replies",
    });
    expect(RUN_TEXT.review.running).toBe("Reviewing…");
    expect(runWhy(run({ kind: "reply", status: "running" })).text).toBe("General: drafting replies now.");
  });

  // Plan r2 section 7: an ask run is never labeled as a review. It has no items, so its count is empty.
  test("an ask run reads Answering… while it runs and answered a question on when done, with an empty count", () => {
    expect(RUN_TEXT.ask.running).toBe("Answering…");
    expect(RUN_TEXT.ask.doing).toBe("answering a question on");
    expect(runWhy(run({ kind: "ask", status: "running" })).text).toBe("General: answering a question now.");
    expect(runWhy(run({ kind: "review", status: "running" })).text).toBe("General: reviewing now.");
    // The Explain flag names a review "explained". An ask run keeps its own verb.
    expect(runLine(detail(run({ kind: "ask", profile: "explain", question: "Why?" })), PROFILES)).toMatchObject({
      kind: "done",
      verb: "answered a question on",
      count: "",
    });
    expect(countText([], false, "ask")).toBe("");
  });

  test("the thread-to-draft map keys reply items by thread and skips other kinds", () => {
    const m = replyMap([reply(1, 101, 105), finding(2), reply(3, 103, 305), question(4)]);
    expect([...m.keys()]).toEqual([101, 103]);
    expect(m.get(103)?.id).toBe(3);
    expect(replyMap(undefined).size).toBe(0);
  });

  test("a draft is stale when its parent is no longer the newest live message", () => {
    const it = reply(1, 101, 105);
    expect(replyCard(it, 105, false)).toEqual({ kind: "draft", it, stale: false });
    expect(replyCard(it, 106, false)).toEqual({ kind: "draft", it, stale: true });
    // Every message deleted: no newest message, so nothing to compare.
    expect(replyCard(it, null, false)).toEqual({ kind: "draft", it, stale: false });
  });

  test("card kinds: pending wins, none has no body, discarded folds, no item gives no card", () => {
    const none = reply(2, 101, 105, { body: "", status: "discarded" }, { action: "none", body: "" });
    const gone = reply(3, 101, 105, { status: "discarded" });
    expect(replyCard(reply(1, 101, 105), 105, true)).toEqual({ kind: "pending" });
    expect(replyCard(undefined, 105, true)).toEqual({ kind: "pending" });
    expect(replyCard(none, 106, false)).toEqual({ kind: "none", it: none, stale: true });
    expect(replyCard(gone, 106, false)).toEqual({ kind: "discarded", it: gone });
    // An edited none draft has a body, so it can be accepted.
    const written = reply(4, 101, 105, { body: "My answer.", status: "accepted" }, { action: "none", body: "" });
    expect(replyCard(written, 105, false)).toMatchObject({ kind: "draft", stale: false });
    expect(replyCard(undefined, 105, false)).toBeNull();
  });

  test("the Draft replies button: disabled at 0 and above the run cap, with the reason", () => {
    expect(repliesButton(0, "General")).toEqual({ disabled: true, hint: "No thread waits for your reply." });
    expect(repliesButton(1, "General")).toEqual({
      disabled: false,
      hint: "Draft a reply for the thread where it is your turn. Profile: General.",
    });
    expect(repliesButton(3, "Security").hint).toBe("Draft a reply for each of the 3 threads where it is your turn. Profile: Security.");
    expect(repliesButton(25, "General").disabled).toBe(false);
    expect(repliesButton(26, "General")).toEqual({
      disabled: true,
      hint: "26 threads wait for your reply. Draft at most 25 at a time: use Draft reply in each thread.",
    });
  });
});

describe("re-review", () => {
  const since = "1".repeat(40);
  const carried = (verdict: Carried["verdict"]): Partial<AnchoredFinding> & { carried: Carried } => ({
    carried: { from: 1, verdict, reason: "Why.", since },
  });
  // A finding copied by a re-review. The payload type of the DTO allows carried on every kind.
  const copy = (id: number, verdict: Carried["verdict"], o: Partial<ReviewItemDto> = {}) => finding(id, o, carried(verdict));

  test("the run line names the range and counts new, carried, and closed findings", () => {
    const r = run({ since: { head: since, incremental: true } });
    const items = [finding(1), copy(2, "open"), copy(3, "fixed", { status: "discarded" }), copy(4, "outdated", { status: "discarded" })];
    expect(runLine(detail(r, [], [...items, question(5)]), PROFILES)).toMatchObject({
      verb: "reviewed",
      head: "a3f9e21",
      count: "1 new, 1 carried, 2 fixed or outdated, 1 question",
      changes: { from: "1111111", full: false },
    });
    // The server fell back to the full change.
    expect(runLine(detail(run({ since: { head: since, incremental: false } })), PROFILES)).toMatchObject({
      count: "0 new, 0 carried, 0 fixed or outdated",
      changes: { from: "1111111", full: true },
    });
    expect(runLine(detail(run()), PROFILES)).toMatchObject({ changes: null, count: "No findings" });
    expect(rereviewCount([copy(1, "open", { status: "accepted" }), copy(2, "open", { status: "discarded" })])).toBe(
      "0 new, 2 carried, 0 fixed or outdated",
    );
  });

  test("the button shows only when the server takes a re-review", () => {
    const brief = (profile = "general"): BriefDto => ({ note: "", profile, updatedAt: 5 });
    const stale = { source: true, target: false };
    const done = run({
      summary: { summary: "S.", risks: [], coverage: { read: [], skipped: [], unavailable: [], notChecked: [] }, dropped: [] },
    });
    expect(rereviewState({ ...done, stale }, brief(), PROFILES)).toEqual({ since: "a3f9e21" });
    expect(rereviewState({ ...done, stale, status: "incomplete" }, brief(), PROFILES)).toEqual({ since: "a3f9e21" });
    const why = (r: RunDto | null, b: BriefDto | undefined = brief()) => {
      const s = rereviewState(r, b, PROFILES);
      return "why" in s ? s.why : s.since;
    };
    expect(why(null)).toBe("No review has run on this pull request yet. Press r to start one.");
    expect(why({ ...done, stale, status: "running", summary: null })).toBe("The review is still running.");
    expect(why({ ...done, stale, status: "failed", summary: null })).toBe("The last review has no result. Press r to review again.");
    // jobs.ts baseRun: COALESCE(explain, profile = 'explain') = 0.
    expect(why({ ...done, stale, explain: true })).toBe("The last run explained the change and gave no findings. Press r to review it.");
    expect(why({ ...done, stale, profile: "explain" })).toBe(
      "The last run explained the change and gave no findings. Press r to review it.",
    );
    expect(why({ ...done, stale, profile: "explain", explain: false })).toBe("a3f9e21");
    expect(why(done)).toBe("The source branch has no new commits since the last review.");
    expect(why({ ...done, stale: { source: false, target: true } })).toBe("The source branch has no new commits since the last review.");
    expect(rereviewState({ ...done, stale }, undefined, PROFILES)).toEqual({ why: "The review brief is still loading." });
    expect(why({ ...done, stale }, brief("explain"))).toBe("The Explain profile gives no findings. Pick a review profile first.");
  });

  test("closed rows name the verdict; carried drafts say what the re-review found", () => {
    expect(closedLabel(copy(1, "fixed", { status: "discarded" }))).toBe("Fixed in the new commits");
    expect(closedLabel(copy(1, "outdated", { status: "discarded", anchor: null }))).toBe("Outdated");
    expect(closedLabel(copy(1, "open", { status: "discarded" }))).toBe("Discarded");
    expect(closedLabel(finding(1, { status: "discarded" }))).toBe("Discarded");
    expect(carriedNote(copy(1, "open"))).toBe("Still open after the new commits.");
    expect(carriedNote(copy(1, "fixed"))).toBe("Fixed in the new commits. You restored it.");
    expect(carriedNote(finding(1))).toBeNull();
  });
});
