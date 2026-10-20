// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// docs/plans/thread-outcome.md sections 3 and 4: the outcome of a thread, its markers, the writer priority, the reply count of Draft
// replies, and the conflict note when the reply draft and the fix result disagree.
import { describe, expect, test } from "bun:test";
import type { CommitDto, FixCommitDto, FixDto, FixEditDto, ReviewItemDto, RunDto } from "../../src/shared/dto";
import type { FixNote, ReplyPayload, SessionMark } from "../../src/shared/review";
import type { Turn } from "../../src/shared/turn";
import {
  conflictText,
  findingConflict,
  findingConflictText,
  type OutcomeInput,
  outcomeText,
  threadOutcome,
} from "../../src/web/review/outcome";

const T = 100;
const NEWEST = 109;
const HASH = "e".repeat(40);

const run = (id: number): RunDto => ({
  id,
  pr: 7,
  kind: "fix",
  profile: "general",
  profileName: "General",
  explain: false,
  note: "",
  status: "completed",
  errorKind: null,
  errorText: null,
  sourceHead: "a".repeat(40),
  targetHead: "b".repeat(40),
  mergeBase: "c".repeat(40),
  via: "pull-request-ref",
  sessionId: null,
  cliVersion: "2.1.295",
  model: "m",
  effort: null,
  effortDefault: null,
  effortNow: false,
  usage: null,
  summary: null,
  startedAt: 1_000,
  finishedAt: 2_000,
  stale: null,
  hasRaw: true,
  since: null,
  question: null,
  findings: 0,
});
const edit = (id: number, thread = T): FixEditDto => ({ id, thread, path: `src/${id}.ts`, added: 1, removed: 1, rows: [] });
const commit = (edits: number[], o: Partial<FixCommitDto> = {}): FixCommitDto => ({
  id: 9,
  run: 50,
  mode: "clone",
  edits,
  branch: "fix/flush-lock",
  before: "d".repeat(40),
  commit: HASH,
  short: "eeeeeee",
  state: "committed",
  fetch: null,
  createdAt: 3_000,
  ...o,
});
const note = (o: Partial<FixNote> = {}): FixNote => ({ thread: T, fixed: false, reason: "Why.", why: null, reply: "", ...o });
const fix = (o: Partial<FixDto> = {}): FixDto => ({ run: run(50), threads: [], edits: [], commits: [], ...o });
const reply = (p: Partial<ReplyPayload> = {}, o: Partial<ReviewItemDto> = {}, session?: SessionMark): ReviewItemDto => {
  const body = o.body ?? "Thanks.";
  return {
    id: 7,
    run: 40,
    kind: "reply",
    body,
    payload: {
      thread: T,
      action: body ? "reply" : "none",
      body,
      reason: "r",
      evidenceStatus: "code",
      replyTo: NEWEST,
      origin: "reply",
      ...p,
      ...(session && { session }),
    },
    anchor: null,
    status: "new",
    revision: 1,
    edited: false,
    ...o,
  };
};
const accept: SessionMark = { run: 60, verdict: "accept", reason: "A throw leaves the lock held." };
const reject: SessionMark = { run: 60, verdict: "reject", reason: "The caller releases it." };

const input = (o: Partial<OutcomeInput> & { turn?: Turn; newest?: number | null } = {}): OutcomeInput => ({
  thread: { id: T, turn: o.turn ?? "your", newest: o.newest === undefined ? NEWEST : o.newest },
  draft: o.draft,
  fixes: o.fixes,
  commits: o.commits,
  ticks: o.ticks ?? new Map(),
  author: o.author ?? true,
});
const of = (o: Parameters<typeof input>[0] = {}) => threadOutcome(input(o)).outcome;
const line = (o: Parameters<typeof input>[0] = {}) => outcomeText(of(o));

describe("outcome", () => {
  test("no draft and no fix: the turn decides Open, Waiting on them, or Resolved", () => {
    expect(of()).toMatchObject({ kind: "open", label: "Open", markers: [], needsReply: true });
    expect(of({ turn: "wait" })).toMatchObject({ kind: "waiting", label: "Waiting on them", needsReply: false });
    expect(of({ turn: "resolved" })).toMatchObject({ kind: "resolved", label: "Resolved", needsReply: false });
    expect(of({ turn: "other" }).kind).toBe("open");
    // A thread without a live message has nothing to answer.
    expect(of({ newest: null }).needsReply).toBe(false);
  });

  test("a reply draft states Answered, To fix, Settled, Follow-up asked, or No reply needed", () => {
    expect(line({ draft: reply() })).toBe("Answered");
    expect(line({ draft: reply({ judgement: "invalid" }) })).toBe("Answered");
    expect(line({ draft: reply({ judgement: "valid" }) })).toBe("To fix");
    expect(line({ draft: reply({ judgement: "partly" }) })).toBe("To fix");
    // Only the own PR can fix: a reviewer answers the point.
    expect(line({ draft: reply({ judgement: "valid" }), author: false })).toBe("Answered");
    expect(line({ draft: reply({ judgement: "settled" }) })).toBe("Settled");
    expect(line({ draft: reply({ judgement: "unsettled" }) })).toBe("Follow-up asked");
    expect(line({ draft: reply({ judgement: "followup" }) })).toBe("Follow-up asked");
    // A resolve proposal without text settles the thread. A draft without both says that no reply is needed.
    expect(line({ draft: reply({ origin: "resolve", resolve: true, resolveTick: true }, { body: "" }) })).toBe("Settled");
    expect(line({ draft: reply({}, { body: "" }) })).toBe("No reply needed");
    // validate.ts stores a reply-run draft with action none as discarded. It still states the outcome.
    expect(line({ draft: reply({}, { body: "", status: "discarded" }) })).toBe("No reply needed");
  });

  test("P8: a session accept without a reply is To fix, not No reply needed", () => {
    expect(line({ draft: reply({ judgement: "valid", origin: "session" }, { body: "" }, accept) })).toBe("To fix");
    expect(line({ draft: reply({ judgement: "valid", origin: "session" }, {}, accept) })).toBe("To fix");
  });

  test("the fix result: Fix proposed, Already done, Won't fix, Follow-up asked, Needs your decision, No fix proposed", () => {
    const proposed = fix({ threads: [note({ fixed: true, reason: "Use finally." })], edits: [edit(1)] });
    expect(line({ fixes: [proposed] })).toBe("Fix proposed");
    const why = (w: FixNote["why"]) => line({ fixes: [fix({ threads: [note({ why: w })] })] });
    expect(why("already")).toBe("Already done");
    expect(why("invalid")).toBe("Won't fix: Not valid");
    expect(why("scope")).toBe("Won't fix: Out of scope");
    expect(why("unclear")).toBe("Follow-up asked");
    expect(why("decision")).toBe("Needs your decision");
    expect(why("risk")).toBe("Needs your decision: Risky");
    expect(why("dropped")).toBe("Needs your decision: Edits could not be applied");
    // A note stored before why existed.
    expect(why(null)).toBe("No fix proposed");
    // A decision needs a choice, not a reply, so Draft replies does not count it.
    expect(of({ fixes: [fix({ threads: [note({ why: "decision" })] })] }).needsReply).toBe(false);
    // A staged commit holds the edits, but the commit did not finish.
    expect(line({ fixes: [{ ...proposed, commits: [commit([1], { state: "staged" })] }] })).toBe("Fix proposed");
  });

  test("a fix commit: Fixed in X when it holds every edit of the thread, Partly fixed in X when it holds a part", () => {
    const edits = [edit(1), edit(2)];
    const threads = [note({ fixed: true })];
    expect(of({ fixes: [fix({ threads, edits, commits: [commit([1, 2])] })] })).toMatchObject({ kind: "fixed", commit: "eeeeeee" });
    expect(line({ fixes: [fix({ threads, edits, commits: [commit([1])] })] })).toBe("Partly fixed in eeeeeee");
    // An undone commit frees its edits again.
    expect(line({ fixes: [fix({ threads, edits, commits: [commit([1, 2], { state: "undone" })] })] })).toBe("Fix proposed");
    // A "Fixed in" draft without the fix run in the list still says Fixed in.
    expect(line({ draft: reply({ origin: "fix", fix: { id: 9, commit: HASH } }) })).toBe("Fixed in eeeeeee");
  });

  test("a decline: Won't fix with your reason, from the note or from the Won't fix draft", () => {
    const declined = fix({ threads: [note({ fixed: true, declined: { reason: "The caller releases it.", draft: 7 } })], edits: [edit(1)] });
    expect(line({ fixes: [declined] })).toBe("Won't fix: The caller releases it.");
    const wont = reply({ origin: "nofix", declined: { run: 50 } }, { body: "Won't fix: The caller releases it." });
    expect(line({ draft: wont })).toBe("Won't fix: The caller releases it.");
  });

  test("markers: Out of date, Resolved since the draft, Waiting for push", () => {
    expect(of({ draft: reply({}), newest: NEWEST + 1 }).markers).toEqual(["stale"]);
    expect(of({ draft: reply({ threadOpen: true }), turn: "resolved" })).toMatchObject({ kind: "answered", markers: ["resolved-since"] });
    // A draft written while the thread was resolved reopens it first, so it has no marker.
    expect(of({ draft: reply({ threadOpen: false }), turn: "resolved" }).markers).toEqual([]);
    const fixed = reply({ origin: "fix", fix: { id: 9, commit: HASH } });
    const fixes = [fix({ threads: [note({ fixed: true })], edits: [edit(1)], commits: [commit([1])] })];
    expect(of({ draft: fixed, fixes, commits: [] }).markers).toEqual(["push"]);
    const pushed: CommitDto[] = [{ hash: HASH, message: "Fix", author: "Me", at: 0 }];
    expect(of({ draft: fixed, fixes, commits: pushed }).markers).toEqual([]);
    // A discarded draft is not open, so the thread state shows with no marker.
    expect(of({ draft: reply({}, { status: "discarded" }), newest: NEWEST + 1 })).toMatchObject({ kind: "open", markers: [] });
  });
});

describe("writer priority", () => {
  const already = fix({ threads: [note({ why: "already", reply: "It is done at src/a.ts:5." })] });
  const proposal = fix({ threads: [note({ fixed: true })], edits: [edit(1), edit(2)] });

  test("your accepted or edited draft states the outcome over an AI fix note", () => {
    expect(line({ draft: reply({ judgement: "valid" }, { status: "accepted" }), fixes: [already] })).toBe("To fix");
    expect(line({ draft: reply({ judgement: "valid" }, { edited: true }), fixes: [already] })).toBe("To fix");
    // An untouched AI draft gives way to the fix note.
    expect(line({ draft: reply({ judgement: "valid" }), fixes: [already] })).toBe("Already done");
  });

  test("a nofix draft keeps the outcome of its note after your edit", () => {
    const nofix = reply({ origin: "nofix" }, { run: 50, edited: true, status: "accepted" });
    expect(line({ draft: nofix, fixes: [already] })).toBe("Already done");
  });

  test("a fix commit wins over your draft, and your decline wins over the commit", () => {
    const committed = fix({ threads: [note({ fixed: true })], edits: [edit(1)], commits: [commit([1])] });
    expect(line({ draft: reply({}, { status: "accepted" }), fixes: [committed] })).toBe("Fixed in eeeeeee");
    expect(line({ draft: reply({ declined: { run: 50 } }, { body: "Won't fix: Later." }), fixes: [proposal] })).toBe("Won't fix: Later.");
  });

  test("when you untick every edit, the open draft states the outcome; one ticked edit keeps Fix proposed", () => {
    const draft = reply({ judgement: "invalid" });
    expect(
      line({
        draft,
        fixes: [proposal],
        ticks: new Map([
          [1, false],
          [2, false],
        ]),
      }),
    ).toBe("Answered");
    expect(line({ draft, fixes: [proposal], ticks: new Map([[1, false]]) })).toBe("Fix proposed");
    // Without a draft the proposal stays the outcome.
    expect(
      line({
        fixes: [proposal],
        ticks: new Map([
          [1, false],
          [2, false],
        ]),
      }),
    ).toBe("Fix proposed");
  });

  test("resolved: an open draft keeps its outcome, without one the line says Resolved", () => {
    expect(line({ turn: "resolved", fixes: [proposal] })).toBe("Resolved");
    expect(line({ draft: reply({}, { status: "discarded" }), turn: "resolved", fixes: [proposal] })).toBe("Resolved");
    expect(line({ draft: reply(), turn: "resolved", fixes: [proposal] })).toBe("Fix proposed");
    expect(line({ draft: reply({ threadOpen: true }), turn: "resolved" })).toBe("Answered");
  });
});

describe("the reply count of Draft replies", () => {
  test("a thread needs a reply when it has no draft, or when its draft is out of date and a reply run may replace it", () => {
    const stale = { newest: NEWEST + 1 };
    expect(of({ draft: reply(), ...stale }).needsReply).toBe(true);
    expect(of({ draft: reply() }).needsReply).toBe(false);
    // jobs.ts writer priority: a reply run keeps your draft, a "Fixed in" draft, a nofix draft, a decline, and a discarded draft.
    expect(of({ draft: reply({}, { status: "accepted" }), ...stale }).needsReply).toBe(false);
    expect(of({ draft: reply({}, { edited: true }), ...stale }).needsReply).toBe(false);
    expect(of({ draft: reply({ origin: "fix", fix: { id: 9, commit: HASH } }), ...stale }).needsReply).toBe(false);
    expect(of({ draft: reply({ origin: "nofix" }), ...stale }).needsReply).toBe(false);
    expect(of({ draft: reply({}, { status: "discarded" }) }).needsReply).toBe(false);
    // A reply-run draft with action none is stored discarded, so a reply run keeps it. A stale session or resolve draft is replaced.
    expect(of({ draft: reply({}, { body: "", status: "discarded" }), ...stale }).needsReply).toBe(false);
    expect(of({ draft: reply({ origin: "session" }, { body: "" }), ...stale }).needsReply).toBe(true);
    expect(of({ draft: reply({ origin: "resolve", resolve: true }, { body: "" }), ...stale }).needsReply).toBe(true);
    // Only threads where it is your turn.
    expect(of({ turn: "wait" }).needsReply).toBe(false);
  });
});

describe("conflicts", () => {
  const proposal = fix({ threads: [note({ fixed: true })], edits: [edit(1), edit(2)] });
  const conflict = (o: Parameters<typeof input>[0]) => threadOutcome(input(o)).conflict;

  test("a Not valid reply next to ticked edits: Keep the reply unticks them, Keep the fix discards the reply", () => {
    const draft = reply({ judgement: "invalid" });
    const c = conflict({ draft, fixes: [proposal] });
    expect(c).toMatchObject({ kind: "no", edits: [1, 2], session: false });
    expect(conflictText(c as NonNullable<typeof c>)).toEqual({
      title: "The reply and the fix disagree",
      text: "The reply draft says the comment is not valid, but 2 edits are ticked for Apply.",
      keep: { label: "Keep the reply", does: "unticks the 2 edits, so Apply leaves them out" },
      fix: { label: "Keep the fix", does: "discards the reply draft" },
    });
    // Only the ticked edits count. With none ticked, nothing disagrees.
    expect(conflict({ draft, fixes: [proposal], ticks: new Map([[1, false]]) })).toMatchObject({ edits: [2] });
    expect(
      conflict({
        draft,
        fixes: [proposal],
        ticks: new Map([
          [1, false],
          [2, false],
        ]),
      }),
    ).toBeNull();
    // An accepted Not valid reply still disagrees, because Apply would commit the edits.
    expect(conflict({ draft: reply({ judgement: "invalid" }, { status: "accepted" }), fixes: [proposal] })?.kind).toBe("no");
    // A valid reply agrees with the proposal. A discarded draft has nothing for the buttons to change.
    expect(conflict({ draft: reply({ judgement: "valid" }), fixes: [proposal] })).toBeNull();
    expect(conflict({ draft: reply({ judgement: "invalid" }, { body: "", status: "discarded" }), fixes: [proposal] })).toBeNull();
  });

  test("a session reject next to ticked edits names your session", () => {
    const draft = reply({ judgement: "invalid", origin: "session" }, { body: "The caller releases it." }, reject);
    const c = conflict({ draft, fixes: [proposal] });
    expect(c).toMatchObject({ kind: "no", session: true });
    expect(conflictText(c as NonNullable<typeof c>).text).toBe(
      "Your session says the comment is not valid, but 2 edits are ticked for Apply.",
    );
  });

  test("a will-fix reply next to Already done: Keep the reply accepts it, Keep the fix brings back the fix answer", () => {
    const already = fix({ threads: [note({ why: "already" })] });
    const c = conflict({ draft: reply({ judgement: "valid" }), fixes: [already] });
    expect(c).toMatchObject({ kind: "yes", why: "already", run: 50, text: true });
    expect(conflictText(c as NonNullable<typeof c>)).toEqual({
      title: "The reply and the fix disagree",
      text: "The reply draft says the comment is valid, but the fix run says: Already done.",
      keep: { label: "Keep the reply", does: "accepts the reply draft" },
      fix: { label: "Keep the fix", does: "discards the reply draft and brings back the answer of the fix run" },
    });
    expect(conflict({ draft: reply({ judgement: "valid" }), fixes: [fix({ threads: [note({ why: "scope" })] })] })?.kind).toBe("yes");
    // Your accept or edit settles it: the reply is your choice.
    expect(conflict({ draft: reply({ judgement: "valid" }, { status: "accepted" }), fixes: [already] })).toBeNull();
    expect(conflict({ draft: reply({ judgement: "valid" }, { edited: true }), fixes: [already] })).toBeNull();
    // A decision is no disagreement. It waits for your choice.
    expect(conflict({ draft: reply({ judgement: "valid" }), fixes: [fix({ threads: [note({ why: "decision" })] })] })).toBeNull();
  });

  test("a session accept without a reply next to a no-fix note offers Fix anyway", () => {
    const draft = reply({ judgement: "valid", origin: "session" }, { body: "" }, accept);
    const c = conflict({ draft, fixes: [fix({ threads: [note({ why: "invalid" })] })] });
    expect(c).toMatchObject({ kind: "yes", text: false, session: true });
    expect(conflictText(c as NonNullable<typeof c>).keep).toEqual({
      label: "Fix anyway",
      does: "runs the fix again and asks for edits despite the note",
    });
    expect(conflictText(c as NonNullable<typeof c>).text).toBe("Your session says the comment is valid, but the fix run says: Not valid.");
  });

  test("drafts from a fix writer never conflict with their own fix", () => {
    const nofix = reply({ origin: "nofix", judgement: "invalid" }, { run: 50 });
    expect(conflict({ draft: nofix, fixes: [proposal] })).toBeNull();
    const fixed = reply({ origin: "fix", judgement: "invalid", fix: { id: 9, commit: HASH } });
    expect(conflict({ draft: fixed, fixes: [proposal] })).toBeNull();
  });

  test("a finding that your session rejected, with ticked edits for it", () => {
    const finding = (o: Partial<ReviewItemDto> = {}, session?: SessionMark): ReviewItemDto => ({
      id: 31,
      run: 1,
      kind: "finding",
      body: "Finding.",
      payload: { body: "Finding.", ...(session && { session }) } as ReviewItemDto["payload"],
      anchor: null,
      status: "discarded",
      revision: 1,
      edited: false,
      ...o,
    });
    const fixes = [
      fix({
        threads: [{ finding: 31, fixed: true, reason: "r", why: null, reply: "" }],
        edits: [{ ...edit(5), thread: undefined, finding: 31 }],
      }),
    ];
    expect(findingConflict(finding({}, reject), fixes, new Map())).toEqual([5]);
    expect(findingConflict(finding({}, reject), fixes, new Map([[5, false]]))).toBeNull();
    expect(findingConflict(finding({ status: "new" }, accept), fixes, new Map())).toBeNull();
    expect(findingConflict(finding(), fixes, new Map())).toBeNull();
    expect(findingConflictText([5])).toEqual({
      title: "The reject and the fix disagree",
      text: "Your session rejected this finding, but 1 edit for it is ticked for Apply.",
      keep: { label: "Keep the reject", does: "unticks the edit, so Apply leaves it out" },
      fix: { label: "Keep the fix", does: "restores the finding" },
    });
  });
});
