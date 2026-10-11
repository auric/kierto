// Plan v3 WP11: the pure review UI rules. The log tree, the run line, the brief state, and the Review runs view.
import { describe, expect, test } from "bun:test";
import type { BriefDto, ProfileDto, PrRow, ReviewItemDto, RunDetail, RunDto } from "../../src/shared/dto";
import type { AnchoredFinding, Question } from "../../src/shared/review";
import type { RunEvent } from "../../src/shared/run-log";
import {
  agentInfo,
  agentPath,
  anchorNote,
  briefState,
  countText,
  draftExcerpt,
  latestByPr,
  limitText,
  logTree,
  runLine,
  runRows,
  runWhy,
  tokenTotal,
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
    expect(s.hint).toBe(
      "Open the review brief: task, your note, and profile. Key: Shift+R. Key r runs the brief: Security with your note.",
    );
    expect(briefState(brief(), null, null, 7, PROFILES).hint).toBe("Open the review brief: task, your note, and profile. Key: Shift+R.");
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
    expect(runWhy(run({ status: "running" }), "General")).toEqual({ error: null, lead: null, text: "General: reviewing now." });
    const summary = {
      summary: "Deadlock risk.",
      risks: [],
      coverage: { read: [], skipped: [], unavailable: [], notChecked: [] },
      dropped: [],
    };
    expect(runWhy(run({ summary }), "General")).toEqual({ error: null, lead: "General:", text: "Deadlock risk." });
    expect(runWhy(run({ status: "incomplete", summary }), "General").text).toBe("Deadlock risk. Coverage has gaps.");
    expect(runWhy(run({ status: "failed", errorKind: "usage_limit", errorText: "Resets at 6pm." }), "General")).toEqual({
      error: "Usage limit",
      lead: null,
      text: "General: Resets at 6pm.",
    });
    expect(runWhy(run({ status: "failed", errorKind: "schema", errorText: "Bad." }), "General").error).toBe("Failed");
    expect(runWhy(run({ status: "cancelled" }), "General").text).toBe("General: you cancelled it.");
  });
});
