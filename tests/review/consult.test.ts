// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Session consult (docs/plans/session-consult.md parts A and B): the text, the answer parser, the import plan, the import, and the undo.
// The tests seed a temp database and a temp git cache. No test reaches a forge or the real CLI.
import type { Database } from "bun:sqlite";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/server/app";
import { writeConfig } from "../../src/server/config";
import { createLive } from "../../src/server/live";
import { git, gitEnv } from "../../src/server/review/git";
import { createReviewJobs } from "../../src/server/review/jobs";
import { cachePath } from "../../src/server/review/workspace";
import { createSecrets } from "../../src/server/secrets";
import { createSettings, type Settings } from "../../src/server/settings";
import {
  ANSWER_RULES,
  type ConsultData,
  type ConsultImportDto,
  type ConsultItem,
  type ConsultUndoDto,
  consultGroups,
  consultText,
  findingKey,
  parseAnswer,
  planAnswer,
  threadKey,
} from "../../src/shared/consult";
import type { ReviewItemDto, RunDto } from "../../src/shared/dto";

process.env.REVIEW_LOOP_SECRETS = "memory";
const root = mkdtempSync(join(tmpdir(), "rl-consult-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const PORT = 7317;
const SESSION = "s".repeat(64);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const HEADERS = { host: `127.0.0.1:${PORT}`, origin: ORIGIN, "x-rl-session": SESSION, "content-type": "application/json" };
const ME = "jdoe";

// ---------- Pure parts ----------

const item = (id: string, group: ConsultItem["group"], text = `### ${id}\nbody`): ConsultItem => ({
  id,
  group,
  kind: id.startsWith("T") ? "thread" : "finding",
  key: `k-${id}`,
  label: `label ${id}`,
  text,
});
const DATA: ConsultData = {
  head: "# Head",
  items: [item("T1", "reviewers"), item("F2", "findings"), item("T3", "own"), item("T4", "resolved")],
};
const ALL = new Set(consultGroups);

describe("consultText", () => {
  test("groups go in order with their headings; resolved items are context only; counts cover all items", () => {
    const t = consultText(DATA, ALL);
    expect(t.ids).toEqual(["T1", "F2", "T3", "T4"]);
    expect(t.left).toEqual([]);
    expect(t.counts).toEqual({ reviewers: 1, findings: 1, own: 1, resolved: 1 });
    expect(t.text.startsWith(`# Head\n\n${ANSWER_RULES}\n\n## Open reviewer comments: needs a verdict\n\n### T1`)).toBe(true);
    expect(t.text).toContain("## Resolved threads: context only, no verdict\n\n### T4");
    expect(t.bytes).toBe(Buffer.byteLength(t.text));
    expect(t.text.endsWith("body\n")).toBe(true);
  });

  test("an unticked group leaves the text, and its heading too", () => {
    const t = consultText(DATA, new Set(["findings", "own"] as const));
    expect(t.ids).toEqual(["F2", "T3"]);
    expect(t.text).not.toContain("reviewer comments");
    expect(t.text).not.toContain("### T4");
  });

  test("the size cap keeps the text under max and names the left-out items", () => {
    const big = (id: string, group: ConsultItem["group"]) => item(id, group, `### ${id}\n${"x".repeat(400)}`);
    const data: ConsultData = {
      head: "# Head",
      items: [big("T1", "reviewers"), big("T2", "reviewers"), big("F3", "findings"), big("T4", "resolved")],
    };
    const base = Buffer.byteLength(`# Head\n\n${ANSWER_RULES}\n`);
    const max = base + 1100;
    const t = consultText(data, ALL, max);
    expect(t.bytes).toBeLessThanOrEqual(max);
    expect(t.ids).toEqual(["T1", "T2"]);
    expect(t.left).toEqual(["F3", "T4"]);
    expect(t.text).toContain("## Left out");
    expect(t.text).toContain("Do not answer them: F3, T4.");
    // Without room for the list, the last kept item goes too.
    const tight = consultText(data, ALL, base + 900);
    expect(tight.bytes).toBeLessThanOrEqual(base + 900);
    expect(tight.left).toEqual(["T2", "F3", "T4"]);
  });
});

describe("parseAnswer", () => {
  const block = '```json\n[{"id": "T1", "verdict": "reject", "reason": "No."}]\n```';
  test("reads the fenced json block and ignores the text around it", () => {
    expect(parseAnswer(`Here is my answer.\n\n${block}\n\nTell me if you need more.`)).toEqual({
      entries: [{ id: "T1", verdict: "reject", reason: "No." }],
    });
    expect(parseAnswer(`Intro\r\n~~~\r\n[{"id": "F2", "verdict": "accept", "reason": "Yes."}]\r\n~~~\r\n`)).toEqual({
      entries: [{ id: "F2", verdict: "accept", reason: "Yes." }],
    });
    // A shell block does not count. A bare array works too.
    expect(parseAnswer(`\`\`\`sh\nls\n\`\`\`\n${block}`)).toMatchObject({ entries: [{ id: "T1" }] });
    expect(parseAnswer(' [{"id": "T1", "verdict": "question", "reason": "Why?"}] ')).toMatchObject({ entries: [{ id: "T1" }] });
  });

  test("bad JSON, two arrays, no block, an empty array, and too many entries give errors", () => {
    expect(parseAnswer('```json\n[{"id": "T1",]\n```')).toEqual({
      error: expect.stringMatching(/^The json block is not a valid JSON array: /),
    });
    expect(parseAnswer(`${block}\n${block}`)).toEqual({
      error: "The answer holds 2 JSON arrays in fenced blocks. Paste only the answer block.",
    });
    expect(parseAnswer("All good, accept everything.")).toEqual({
      error: "No fenced json block with a JSON array. Paste the answer of your session.",
    });
    expect(parseAnswer("```json\n[]\n```")).toEqual({ error: "The answer has no entries." });
    expect(parseAnswer(JSON.stringify(Array.from({ length: 501 }, () => ({}))))).toEqual({
      error: "The answer has 501 entries. The limit is 500.",
    });
  });
});

describe("planAnswer", () => {
  const items = DATA.items;
  const snap = Object.fromEntries(items.map((i) => [i.id, i.key]));
  test("maps each verdict to its action per kind", () => {
    const rows = planAnswer(
      items,
      [
        { id: "T1", verdict: "reject", reason: "The name is right." },
        { id: "F2", verdict: "reject", reason: "False alarm.", reply: "Thanks." },
        { id: "T3", verdict: "accept", reason: "Valid." },
      ],
      snap,
    );
    expect(rows.map((r) => [r.id, r.act, r.text])).toEqual([
      ["T1", "reject", "Reply draft “Not valid” with the reason."],
      ["F2", "reject", "Discard the finding. The reason stays on it. The reply text is not used: the finding is not posted."],
      ["T3", "accept", "Tick in the Fix list. Judgement “Valid”."],
    ]);
    const more = planAnswer(
      items,
      [
        { id: "T1", verdict: "question", reason: "Which?", reply: "Which file?" },
        { id: "F2", verdict: "question", reason: "Why?" },
      ],
      null,
    );
    expect(more.map((r) => r.text)).toEqual([
      "Reply draft “Question” with the reply text.",
      "Note the question on the finding. A finding that is not posted has no thread for a reply.",
    ]);
  });

  test("bad entries, duplicates, unknown IDs, resolved items, items out of the copy, and changed items are skipped", () => {
    const rows = planAnswer(
      items,
      [
        { id: "X1", verdict: "accept", reason: "r" },
        { id: "T1", verdict: "maybe", reason: "r" },
        { id: "T1", verdict: "accept", reason: "" },
        "not an object",
        { id: "F2", verdict: "accept", reason: "a" },
        { id: "F2", verdict: "reject", reason: "b" },
        { id: "T9", verdict: "accept", reason: "r" },
        { id: "T4", verdict: "accept", reason: "r" },
        { id: "T3", verdict: "accept", reason: "r" },
      ],
      { T1: "k-T1", F2: "k-F2", T4: "k-T4" },
    );
    expect(rows.map((r) => [r.n, r.act, r.text])).toEqual([
      [1, null, "Not valid: id must look like T123 or F45."],
      [2, null, "Not valid: verdict must be accept, reject, or question."],
      [3, null, "Not valid: reason must be text of 1 to 4000 characters."],
      [4, null, "Not valid: the entry must be an object with id, verdict, and reason."],
      [5, null, "Duplicate ID. Every entry with this ID is skipped."],
      [6, null, "Duplicate ID. Every entry with this ID is skipped."],
      [7, null, "Unknown ID. It is not an open item of this pull request."],
      [8, null, "Resolved thread: context only. No change."],
      [9, null, "Not in the copied text. Copy again to include it."],
    ]);
    const changed = planAnswer(items, [{ id: "T1", verdict: "accept", reason: "r" }], { T1: "other" });
    expect(changed[0]?.text).toBe("Changed since the copy. Copy again to judge the current state.");
  });

  test("keys: an accept keeps a finding key; a new message changes a thread key", () => {
    expect(findingKey("new", "x")).toBe(findingKey("accepted", "x"));
    expect(findingKey("new", "x")).not.toBe(findingKey("new", "y"));
    expect(findingKey("discarded", "x")).not.toBe(findingKey("new", "x"));
    expect(threadKey(false, 5)).not.toBe(threadKey(false, 6));
    expect(threadKey(false, 5)).not.toBe(threadKey(true, 5));
  });
});

// ---------- Server ----------

const opened: Settings[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.close();
});
let n = 0;

// A bare cache with refs/rl/1/source and refs/rl/1/target, as syncCache leaves it. Source is two commits after target.
async function makeCache(dataDir: string) {
  const cache = cachePath(realpathSync.native(dataDir), { project: "PROJ", repo: "repo", id: 1 });
  mkdirSync(cache, { recursive: true });
  const empty = join(dataDir, "test.gitconfig");
  writeFileSync(empty, "");
  const env = {
    ...gitEnv(empty),
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.invalid",
    GIT_INDEX_FILE: join(dataDir, "test.index"),
  };
  const g = async (args: string[], stdin?: string) => (await git([`--git-dir=${cache}`, ...args], { env, stdin })).trim();
  await git(["init", "-q", "--bare", "--template=", cache], { env });
  const commit = async (parent: string | null, text: string) => {
    const blob = await g(["hash-object", "-w", "--stdin"], text);
    await g(["read-tree", "--empty"]);
    await g(["update-index", "--add", "--cacheinfo", `100644,${blob},src/a.ts`]);
    return g(["commit-tree", await g(["write-tree"]), ...(parent ? ["-p", parent] : []), "-m", "c"]);
  };
  const lines = (...l: string[]) => `${l.join("\n")}\n`;
  const target = await commit(null, lines("line1", "line2", "line3", "line4", "line5", "line6", "line7", "line8"));
  const old = await commit(target, lines("line1", "NEW2", "line3", "line4", "line5", "line6", "line7", "line8"));
  const head = await commit(old, lines("line1", "NEW2", "line3", "line4", "CHANGED5", "line6", "line7", "line8"));
  await g(["update-ref", "refs/rl/1/source", head]);
  await g(["update-ref", "refs/rl/1/target", target]);
  mkdirSync(join(cache, "info"), { recursive: true });
  writeFileSync(join(cache, "info", "attributes"), "");
  return { target, old, head };
}

type Heads = { head: string; target: string; run: string };

function seed(db: Database, h: Heads, role = "AUTHOR") {
  db.query(
    `INSERT INTO pull_request (id, project, repo, pr_id, title, author_slug, author_name, my_role, state, source_head, target_head, source_branch,
      target_branch, followed) VALUES (1, 'PROJ', 'repo', 1, 'Lock each entry', $me, 'Jordan Doe', $role, 'OPEN', $head, $target, 'feature/lock', 'main', 1)`,
  ).run({ me: ME, role, head: h.head, target: h.target });
  db.run("INSERT INTO pr_task (pr, key, source, url, ord) VALUES (1, 'ABC-1', 'title', NULL, 0)");
  db.run("INSERT INTO pr_change (pr, path, src_path, type) VALUES (1, 'src/a.ts', NULL, 'MODIFY')");
  const c = (o: {
    id: number;
    root: number;
    parent?: number;
    who: string;
    text: string;
    at: number;
    anchor?: unknown;
    resolved?: boolean;
    excerpt?: unknown;
    deleted?: boolean;
  }) =>
    db
      .query(
        `INSERT INTO comment (pr, comment_id, version, parent_id, root_id, author_slug, author_name, author_login, text, anchor_json, thread_resolved,
          created_at, updated_at, excerpt_json, tombstoned_at) VALUES (1, $id, 0, $parent, $root, $who, $name, $who, $text, $anchor, $resolved, $at, $at, $excerpt, $deleted)`,
      )
      .run({
        id: o.id,
        parent: o.parent ?? null,
        root: o.root,
        who: o.who,
        name: o.who === ME ? "Jordan Doe" : "Alex Smith",
        text: o.text,
        anchor: o.anchor === undefined ? null : JSON.stringify(o.anchor),
        resolved: o.resolved ? 1 : 0,
        at: o.at,
        excerpt: o.excerpt === undefined ? null : JSON.stringify(o.excerpt),
        deleted: o.deleted ? o.at : null,
      });
  c({
    id: 101,
    root: 101,
    who: "alex",
    text: "Rename `x`.\n## Not a heading",
    at: 1000,
    anchor: { path: "src/a.ts", line: 3, lineType: "ADDED", fileType: "TO" },
  });
  c({ id: 102, root: 101, parent: 101, who: ME, text: "Why?", at: 1100 });
  c({ id: 103, root: 101, parent: 102, who: "alex", text: "Because.", at: 1200 });
  c({
    id: 201,
    root: 201,
    who: "alex",
    text: "Old place.",
    at: 2000,
    anchor: { path: "src/a.ts", line: 2, lineType: "ADDED", fileType: "TO", orphaned: true },
    excerpt: [{ n: 2, kind: "add", text: "OLD2", hit: true }],
  });
  c({ id: 301, root: 301, who: ME, text: "Note to self: docs.", at: 3000 });
  c({ id: 401, root: 401, who: ME, text: "Posted finding text.", at: 4000 });
  c({ id: 501, root: 501, who: "alex", text: "Done already.", at: 5000, resolved: true });
  c({ id: 601, root: 601, who: "alex", text: "gone", at: 6000, deleted: true });
  const run = (id: number, kind: string, head: string, status = "completed") =>
    db
      .query(
        `INSERT INTO review_run (id, pr, kind, profile, note, idem_key, source_head, target_head, status, started_at)
        VALUES ($id, 1, $kind, 'general', '', $key, $head, $target, $status, $id)`,
      )
      .run({ id, kind, key: `k${id}`, head, target: h.target, status });
  run(9, "review", h.run);
  run(10, "review", h.run);
  run(11, "reply", h.head);
  db.run(`INSERT INTO post (pr, run, kind, idem_key, body, destination_json, items_json, state, remote_id, created_at, updated_at)
    VALUES (1, 9, 'inline', 'run:1:9:1@0', 'b', '{}', '[]', 'confirmed', 401, 1, 1)`);
  const finding = (id: number, runId: number, line: number, kind: "add" | "ctx", text: string, status = "new", body = `Finding ${id}.`) => {
    const anchor = {
      state: "exact",
      path: "src/a.ts",
      oldPath: null,
      line,
      lineEnd: line,
      excerpt: [
        { n: line - 1, kind: "ctx", text: `line${line - 1}` },
        { n: line, kind, text },
      ],
    };
    const payload = {
      path: "src/a.ts",
      side: "new",
      line,
      lineEnd: null,
      anchorText: text,
      severity: id === 21 ? "blocker" : "minor",
      category: "Concurrency",
      body,
      evidence: "Seen in code.",
      evidenceStatus: "code",
      confidence: "high",
      agent: null,
      anchor,
    };
    db.query(
      `INSERT INTO review_item (id, run, kind, payload_json, body, path, side, line, line_end, anchor_state, excerpt_json, status)
      VALUES ($id, $run, 'finding', $payload, $body, 'src/a.ts', 'new', $line, $line, 'exact', $excerpt, $status)`,
    ).run({ id, run: runId, payload: JSON.stringify(payload), body, line, excerpt: JSON.stringify(anchor.excerpt), status });
  };
  finding(20, 9, 2, "add", "NEW2");
  finding(21, 10, 2, "add", "NEW2");
  finding(22, 10, 5, "ctx", "line5", "accepted");
  finding(23, 10, 3, "ctx", "line3", "discarded");
  // An accepted AI reply draft on thread 101. A session draft replaces it.
  db.query(
    `INSERT INTO review_item (id, run, kind, payload_json, body, status, thread) VALUES (30, 11, 'reply', $payload, 'AI reply.', 'accepted', 101)`,
  ).run({
    payload: JSON.stringify({
      thread: 101,
      action: "reply",
      body: "AI reply.",
      reason: "AI reason.",
      evidenceStatus: "code",
      judgement: "valid",
      replyTo: 103,
    }),
  });
}

async function setup(o: { cache?: boolean; role?: string; runAtHead?: boolean } = {}) {
  const dir = join(root, `case-${n++}`);
  mkdirSync(dir, { recursive: true });
  writeConfig(dir, { baseUrl: "https://forge.example.test", userSlug: ME, notifications: false });
  const settings = createSettings({ dir, secrets: createSecrets(null) });
  opened.push(settings);
  const db = settings.db();
  if (!db) throw new Error("no db");
  const shas = o.cache ? await makeCache(dir) : { target: "t".repeat(40), old: "o".repeat(40), head: "h".repeat(40) };
  seed(db, { head: shas.head, target: shas.target, run: o.runAtHead ? shas.head : shas.old }, o.role);
  const live = createLive();
  const events: unknown[] = [];
  const broadcast = live.broadcast;
  live.broadcast = (event, data) => {
    events.push({ event, data });
    broadcast(event, data);
  };
  const review = createReviewJobs({ settings, live, dataDir: dir });
  const app = createApp({ port: PORT, token: SESSION, live, settings, review });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(`${ORIGIN}/api${path}`, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
  const consult = async () => (await (await call("GET", "/prs/1/consult")).json()) as ConsultData;
  const item = (id: number) =>
    db.query("SELECT status, payload_json, body FROM review_item WHERE id = $id").get({ id }) as {
      status: string;
      payload_json: string;
      body: string;
    };
  return { db, call, consult, item, events, shas };
}

const byId = (d: ConsultData, id: string) => d.items.find((i) => i.id === id) as ConsultItem;

describe("GET /prs/:id/consult", () => {
  test("groups, IDs, header, conversation, code at the head, outdated marks, and the view of Revido", async () => {
    const s = await setup({ cache: true });
    const res = await s.call("GET", "/prs/1/consult");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const d = (await res.json()) as ConsultData;
    expect(d.items.map((i) => [i.id, i.group])).toEqual([
      ["T101", "reviewers"],
      ["T201", "reviewers"],
      ["T301", "own"],
      ["T401", "findings"],
      ["T501", "resolved"],
      ["F21", "findings"],
      ["F22", "findings"],
    ]);
    expect(d.head).toContain("# Review points on my pull request PROJ/repo #1");
    expect(d.head).toContain(`- Head commit: ${s.shas.head}`);
    expect(d.head).toContain("- Branch: feature/lock into main");
    expect(d.head).toContain("- Tasks: ABC-1");
    expect(d.head).toContain("  - MODIFY src/a.ts");

    const t = byId(d, "T101");
    expect(t.key).toBe(threadKey(false, 103));
    expect(t.label).toBe("Alex Smith, src/a.ts:3");
    expect(t.text).toContain("Source: reviewer comment by Alex Smith\nStatus: open, your turn\nPlace: src/a.ts:3, new side\nOutdated: no");
    expect(t.text).toContain(`Code at the head commit ${s.shas.head.slice(0, 7)}:\n      1 | line1\n      2 | NEW2\n    > 3 | line3`);
    // The comment text gets an indent, so its heading line is no heading.
    expect(t.text).toContain("- Alex Smith, comment 101, 1970-01-01 00:00 UTC:\n    Rename `x`.\n    ## Not a heading");
    expect(t.text).toContain("- Alex Smith, comment 103, reply to 102,");
    expect(t.text).toContain("- You, comment 102,");
    expect(t.text).toContain("- Reply draft from Revido (judgement Valid, accepted, not posted):\n    AI reply.\n  Reason: AI reason.");

    const orphan = byId(d, "T201").text;
    expect(orphan).toContain("Outdated: yes. The code changed after this comment.\nCode when the comment was written:\n    > 2 + | OLD2");
    expect(byId(d, "T301").text).toContain(
      "Source: your comment by You\nStatus: open, waiting for the other person\nPlace: general comment",
    );
    expect(byId(d, "T401").text).toContain("Source: Revido finding, posted by you");
    const resolved = byId(d, "T501").text;
    expect(resolved).toContain("Status: resolved. Context only, no verdict.");
    expect(resolved).not.toContain("The view of Revido");

    // The review read the older commit. F21's line is the same at the head. F22's line changed.
    const same = byId(d, "F21").text;
    expect(same).toContain(
      `Outdated: no. The review read ${s.shas.old.slice(0, 7)}. The lines are the same at ${s.shas.head.slice(0, 7)}.`,
    );
    expect(same).toContain("    > 2 | NEW2");
    expect(same).toContain("Severity: Blocker. Category: Concurrency. Evidence: Shown in code, high confidence.");
    expect(same).toContain("Finding:\n    Finding 21.\nEvidence:\n    Seen in code.");
    const moved = byId(d, "F22").text;
    expect(moved).toContain("Status: accepted, ready to post");
    expect(moved).toContain(`Outdated: yes. The review read ${s.shas.old.slice(0, 7)}. The code at the place changed after it.`);
    expect(moved).toContain("    > 5   | line5");
    expect(byId(d, "F22").key).toBe(findingKey("accepted", "Finding 22."));
    // No token, no setting, no host.
    const all = consultText(d, new Set(consultGroups)).text;
    expect(all).not.toContain("forge.example.test");
    expect(all).not.toContain(SESSION);
  });

  test("without the cache, a thread quotes nothing at the head and a finding of an older head says so", async () => {
    const s = await setup();
    const d = await s.consult();
    expect(byId(d, "T101").text).not.toContain("Code at");
    expect(byId(d, "F21").text).toContain("Outdated: unknown. The review read oooo");
    const at = await setup({ runAtHead: true });
    expect(byId(await at.consult(), "F21").text).toContain(
      "Outdated: no\nCode at the head commit hhhhhhh, from the review diff:\n      1   | line1\n    > 2 + | NEW2",
    );
  });

  test("a pull request of another author gives 409; an unknown one 404", async () => {
    const s = await setup({ role: "REVIEWER" });
    const res = await s.call("GET", "/prs/1/consult");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Copy for your session works only on your own pull requests." });
    expect((await s.call("GET", "/prs/9/consult")).status).toBe(404);
  });
});

describe("POST /prs/:id/consult/import and undo", () => {
  const ENTRIES = [
    { id: "T101", verdict: "reject", reason: "The name is right." },
    { id: "T301", verdict: "question", reason: "Which docs?", reply: "Which docs do you mean?" },
    { id: "T401", verdict: "accept", reason: "Valid point." },
    { id: "F21", verdict: "reject", reason: "False alarm." },
    { id: "F22", verdict: "accept", reason: "Real bug." },
    { id: "T501", verdict: "accept", reason: "Resolved." },
    { id: "T999", verdict: "reject", reason: "Unknown." },
  ];

  test("Apply makes session reply drafts, discards and marks findings, ticks the accepts, and posts nothing; Undo puts it back", async () => {
    const s = await setup({ runAtHead: true });
    const d = await s.consult();
    const snapshot = Object.fromEntries(d.items.map((i) => [i.id, i.key]));
    const res = await s.call("POST", "/prs/1/consult/import", { entries: ENTRIES, snapshot });
    expect(res.status).toBe(200);
    const dto = (await res.json()) as ConsultImportDto;
    expect(dto.rows.map((r) => [r.id, r.act])).toEqual([
      ["T101", "reject"],
      ["T301", "question"],
      ["T401", "accept"],
      ["F21", "reject"],
      ["F22", "accept"],
      ["T501", null],
      ["T999", null],
    ]);
    expect(dto).toMatchObject({ drafts: 3, discarded: 1, marked: 1, ticks: { threads: [401], findings: [22] } });
    expect(s.events).toContainEqual({ event: "changed", data: { prs: [1], runs: [10] } });

    const drafts = (await (await s.call("GET", "/prs/1/reply-drafts")).json()) as ReviewItemDto[];
    const of = (t: number) => drafts.find((x) => (x.payload as { thread: number }).thread === t) as ReviewItemDto;
    expect(of(101)).toMatchObject({ body: "The name is right.", status: "new", run: dto.run });
    expect(of(101).payload).toMatchObject({
      action: "reply",
      judgement: "invalid",
      replyTo: 103,
      session: { run: dto.run, verdict: "reject", reason: "The name is right.", replaced: [{ id: 30, was: "accepted" }] },
    });
    expect(of(301)).toMatchObject({ body: "Which docs do you mean?", payload: { judgement: "question", replyTo: 301 } });
    expect(of(401)).toMatchObject({ body: "", payload: { action: "none", judgement: "valid" } });
    expect(s.item(30).status).toBe("discarded");
    expect(s.item(21).status).toBe("discarded");
    expect(JSON.parse(s.item(21).payload_json).session).toEqual({ run: dto.run, verdict: "reject", reason: "False alarm.", was: "new" });
    expect(s.item(22).status).toBe("accepted");
    expect(JSON.parse(s.item(22).payload_json).session).toEqual({ run: dto.run, verdict: "accept", reason: "Real bug." });
    // Nothing posts, and no run list shows the paste.
    expect(s.db.query("SELECT COUNT(*) AS n FROM post").get()).toEqual({ n: 1 });
    expect(((await (await s.call("GET", "/prs/1/runs")).json()) as RunDto[]).map((r) => r.id)).not.toContain(dto.run);
    expect(((await (await s.call("GET", "/runs")).json()) as RunDto[]).map((r) => r.id)).not.toContain(dto.run);
    expect((await s.call("GET", `/runs/${dto.run}`)).status).toBe(404);
    // The copy now shows the session view.
    const after = await s.consult();
    expect(byId(after, "T101").text).toContain("- Reply draft from your session (judgement Not valid, not accepted yet):");
    expect(byId(after, "F22").text).toContain("- Your session: Valid. Real bug.");

    const undo = await s.call("POST", `/prs/1/consult/${dto.run}/undo`);
    expect(undo.status).toBe(200);
    expect((await undo.json()) as ConsultUndoDto).toEqual({ drafts: 3, replaced: 1, findings: 2 });
    expect(s.item(30).status).toBe("accepted");
    expect(s.item(21).status).toBe("new");
    expect(JSON.parse(s.item(21).payload_json).session).toBeUndefined();
    expect(JSON.parse(s.item(22).payload_json).session).toBeUndefined();
    const back = (await (await s.call("GET", "/prs/1/reply-drafts")).json()) as ReviewItemDto[];
    expect(back.find((x) => (x.payload as { thread: number }).thread === 101)?.status).toBe("discarded");
    expect((await s.call("POST", "/prs/1/consult/999/undo")).status).toBe(404);
  });

  test("an item that changed since the copy is skipped; an answer with nothing to apply gives 400", async () => {
    const s = await setup({ runAtHead: true });
    const d = await s.consult();
    const snapshot = Object.fromEntries(d.items.map((i) => [i.id, i.key]));
    s.db.run(
      "INSERT INTO comment (pr, comment_id, version, parent_id, root_id, author_slug, text, thread_resolved, created_at, updated_at) VALUES (1, 104, 0, 103, 101, 'alex', 'More.', 0, 1300, 1300)",
    );
    const res = await s.call("POST", "/prs/1/consult/import", { entries: [ENTRIES[0], ENTRIES[4]], snapshot });
    const dto = (await res.json()) as ConsultImportDto;
    expect(dto.rows.map((r) => r.text)).toEqual([
      "Changed since the copy. Copy again to judge the current state.",
      "Tick in the Fix list.",
    ]);
    expect(dto.drafts).toBe(0);
    expect(s.item(30).status).toBe("accepted");
    const none = await s.call("POST", "/prs/1/consult/import", { entries: [ENTRIES[5]], snapshot: null });
    expect(none.status).toBe(400);
    expect(await none.json()).toEqual({ error: "The answer has no entry to apply." });
    expect((await s.call("POST", "/prs/1/consult/import", { entries: [], snapshot: null })).status).toBe(400);
  });

  test("Restore of a finding that the session rejected returns its status and removes the mark", async () => {
    const s = await setup({ runAtHead: true });
    await s.call("POST", "/prs/1/consult/import", { entries: [{ id: "F22", verdict: "reject", reason: "No." }], snapshot: null });
    const rejected = s.db.query("SELECT revision FROM review_item WHERE id = 22").get() as { revision: number };
    const res = await s.call("POST", "/items/22", { action: "restore", revision: rejected.revision });
    expect(res.status).toBe(200);
    const it = (await res.json()) as ReviewItemDto;
    expect(it.status).toBe("accepted");
    expect(it.payload.session).toBeUndefined();
  });
});
