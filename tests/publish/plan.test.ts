// Plan v3 WP12: item triage and the post plan. The app runs in-process on a temp database. No test reaches a forge or the CLI.
import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/server/app";
import { writeConfig } from "../../src/server/config";
import { createLive } from "../../src/server/live";
import { buildPlan, generalText } from "../../src/server/publish/plan";
import { createReviewJobs } from "../../src/server/review/jobs";
import { createSecrets } from "../../src/server/secrets";
import { createSettings } from "../../src/server/settings";
import type { ItemConflict, PostPlanDto, ReviewItemDto } from "../../src/shared/dto";
import type { AnchoredFinding, ExcerptLine } from "../../src/shared/review";
import { FAKE_TOKEN, FAKE_USER } from "../support/fake-bitbucket";

process.env.REVIEW_LOOP_SECRETS = "memory";
const PORT = 7317;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SESSION = "s".repeat(64);
const HEADERS = { host: `127.0.0.1:${PORT}`, origin: ORIGIN, "x-rl-session": SESSION, "content-type": "application/json" };
const SOURCE = "a".repeat(40);
const TARGET = "b".repeat(40);
const BASE = "c".repeat(40);

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
});

// New side: 1 is outside the diff, 2 and 4 are hunk context, 3 is added, old line 3 is removed before new line 4.
const NEW_EXCERPT: ExcerptLine[] = [
  { n: 1, kind: "ctx", text: "a" },
  { n: 2, kind: "ctx", text: "b", hunk: true },
  { n: 3, kind: "add", text: "c2" },
  { n: 3, kind: "del", text: "c" },
  { n: 4, kind: "ctx", text: "d", hunk: true },
];
const OLD_EXCERPT: ExcerptLine[] = [
  { n: 7, kind: "ctx", text: "x", hunk: true },
  { n: 8, kind: "del", text: "y" },
];

type F = {
  path?: string;
  side?: "new" | "old";
  line?: number;
  state?: AnchoredFinding["anchor"]["state"];
  body?: string;
  oldPath?: string;
};
function findingPayload(o: F): AnchoredFinding {
  const side = o.side ?? "new";
  const line = o.line ?? 3;
  const path = o.path ?? "src/app.ts";
  return {
    path,
    side,
    line,
    lineEnd: null,
    anchorText: "c2",
    severity: "minor",
    category: "naming",
    body: o.body ?? "Body.",
    evidence: "",
    evidenceStatus: "code",
    confidence: "high",
    agent: null,
    anchor: {
      state: o.state ?? "exact",
      path,
      oldPath: o.oldPath ?? null,
      line,
      lineEnd: line,
      excerpt: side === "new" ? NEW_EXCERPT : OLD_EXCERPT,
    },
  };
}

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "rl-wp12-"));
  writeConfig(dir, { baseUrl: "http://127.0.0.1:9", userSlug: FAKE_USER, notifications: false });
  const secrets = createSecrets(null);
  await secrets.set(FAKE_TOKEN);
  const settings = createSettings({ dir, secrets });
  const db = settings.db() as Database;
  const live = createLive();
  // A runner command that never runs: no test starts a review.
  const review = createReviewJobs({ settings, live, dataDir: dir, runnerCommand: [process.execPath, "--version"] });
  const app = createApp({ port: PORT, token: SESSION, live, settings, review });
  cleanup.push(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });
  const { id: pr } = db
    .query(
      `INSERT INTO pull_request (project, repo, pr_id, title, state, source_head, target_head, updated_date, on_dashboard, followed)
      VALUES ('PROJ', 'repo', 2, 'T', 'OPEN', $s, $t, 1000, 1, 1) RETURNING id`,
    )
    .get({ s: SOURCE, t: TARGET }) as { id: number };
  const { id: run } = db
    .query(
      `INSERT INTO review_run (pr, profile, note, idem_key, source_head, target_head, merge_base, status, started_at, finished_at)
      VALUES ($pr, 'general', '', 'k', $s, $t, $b, 'completed', 1, 2) RETURNING id`,
    )
    .get({ pr, s: SOURCE, t: TARGET, b: BASE }) as { id: number };

  const insert = (o: Record<string, unknown>) =>
    (
      db
        .query(
          `INSERT INTO review_item (run, kind, payload_json, body, path, side, line, line_end, anchor_state, excerpt_json)
      VALUES ($run, $kind, $payload_json, $body, $path, $side, $line, $line_end, $anchor_state, $excerpt_json) RETURNING id`,
        )
        .get({ run, ...o }) as { id: number }
    ).id;
  const finding = (o: F = {}) => {
    const f = findingPayload(o);
    return insert({
      kind: "finding",
      payload_json: JSON.stringify(f),
      body: f.body,
      path: f.anchor.path,
      side: f.side,
      line: f.anchor.line,
      line_end: f.anchor.lineEnd,
      anchor_state: f.anchor.state,
      excerpt_json: JSON.stringify(f.anchor.excerpt),
    });
  };
  const question = (text: string, why: string) =>
    insert({
      kind: "question",
      payload_json: JSON.stringify({ text, why }),
      body: text,
      path: null,
      side: null,
      line: null,
      line_end: null,
      anchor_state: null,
      excerpt_json: null,
    });
  const comment = (id: number, author: string, anchor: unknown, o: { parent?: number; tombstoned?: boolean } = {}) =>
    db
      .query(
        `INSERT INTO comment (pr, comment_id, version, parent_id, root_id, author_slug, author_name, text, anchor_json, created_at, updated_at, tombstoned_at)
      VALUES ($pr, $id, 0, $parent, $root, $author, $name, 'x', $anchor, 1, 1, $tomb)`,
      )
      .run({
        pr,
        id,
        parent: o.parent ?? null,
        root: o.parent ?? id,
        author,
        name: author === FAKE_USER ? "Jordan Doe" : "Alex Smith",
        anchor: anchor === null ? null : JSON.stringify(anchor),
        tomb: o.tombstoned ? 5 : null,
      });

  const call = async <T>(path: string, body?: unknown) => {
    const res = await app.request(`${ORIGIN}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  };
  const act = (id: number, body: Record<string, unknown>) => call<ReviewItemDto & ItemConflict>(`/api/items/${id}`, body);
  const accept = async (id: number, revision = 0) => {
    const r = await act(id, { action: "accept", revision });
    expect(r.status).toBe(200);
    return r.body;
  };
  const plan = async () => {
    const r = await call<PostPlanDto>(`/api/prs/${pr}/post-plan`);
    expect(r.status).toBe(200);
    return r.body;
  };
  return { db, pr, run, finding, question, comment, act, accept, plan, call };
}

describe("post plan", () => {
  test("A8: 2 of 6 accepted items give exactly 2 comments", async () => {
    const s = await setup();
    const ids = [
      s.finding(),
      s.finding({ line: 4 }),
      s.finding({ path: "b.ts" }),
      s.finding({ state: "outside" }),
      s.question("Q1?", "W1."),
    ];
    ids.push(s.question("Q2?", "W2."));
    await s.accept(ids[0] as number);
    await s.accept(ids[2] as number);
    const p = await s.plan();
    expect(p.posts).toHaveLength(2);
    expect(p.posts.map((x) => x.items)).toEqual([[{ id: ids[0] as number, revision: 1 }], [{ id: ids[2] as number, revision: 1 }]]);
    expect(p.posts[0]).toEqual({
      run: s.run,
      sourceHead: SOURCE,
      targetHead: TARGET,
      mergeBase: BASE,
      destination: { kind: "inline", path: "src/app.ts", srcPath: null, line: 3, lineEnd: 3, lineType: "add" },
      body: "Body.",
      items: [{ id: ids[0] as number, revision: 1 }],
      duplicate: null,
    });
  });

  test("a discarded item never enters the plan, and restore takes it back to new", async () => {
    const s = await setup();
    const f = s.finding();
    const q = s.question("Q?", "W.");
    await s.accept(f);
    await s.accept(q);
    expect((await s.act(f, { action: "discard", revision: 1 })).body.status).toBe("discarded");
    expect((await s.act(q, { action: "discard", revision: 1 })).body.status).toBe("discarded");
    expect((await s.plan()).posts).toEqual([]);
    const r = await s.act(f, { action: "restore", revision: 2 });
    expect([r.body.status, r.body.revision]).toEqual(["new", 3]);
    expect((await s.plan()).posts).toEqual([]);
  });

  test("an edit accepts the item, raises the revision, and its text posts", async () => {
    const s = await setup();
    const f = s.finding();
    const r = await s.act(f, { action: "edit", revision: 0, body: "  Edited text.  " });
    expect(r.status).toBe(200);
    expect([r.body.status, r.body.revision, r.body.edited, r.body.body]).toEqual(["accepted", 1, true, "Edited text."]);
    // The validator's payload stays.
    expect((r.body.payload as AnchoredFinding).body).toBe("Body.");
    const p = await s.plan();
    expect(p.posts.map((x) => [x.body, x.items])).toEqual([["Edited text.", [{ id: f, revision: 1 }]]]);
    expect((await s.act(f, { action: "edit", revision: 1, body: "   " })).status).toBe(400);
  });

  test("a move takes only an excerpt line of the finding's side, and recomputes inline or outside", async () => {
    const s = await setup();
    const f = s.finding();
    // 9: not in the excerpt. A move never takes a removed line on the new side; old line 3 is that removed line, but new line 3 is a choice.
    expect((await s.act(f, { action: "move", revision: 0, line: 9 })).status).toBe(400);
    expect((await s.act(s.question("Q?", "W."), { action: "move", revision: 0, line: 3 })).status).toBe(400);
    const old = s.finding({ side: "old", line: 8 });
    expect((await s.act(old, { action: "move", revision: 0, line: 3 })).status).toBe(400);

    let r = await s.act(f, { action: "move", revision: 0, line: 2 });
    expect(r.status).toBe(200);
    expect(r.body.anchor).toMatchObject({ line: 2, lineEnd: 2, state: "exact" });
    await s.accept(f, 1);
    expect((await s.plan()).posts[0]?.destination).toEqual({
      kind: "inline",
      path: "src/app.ts",
      srcPath: null,
      line: 2,
      lineEnd: 2,
      lineType: "ctx",
    });

    r = await s.act(f, { action: "move", revision: 2, line: 1 });
    expect(r.body.anchor).toMatchObject({ line: 1, state: "outside" });
    let p = await s.plan();
    expect(p.posts.map((x) => [x.destination.kind, x.body])).toEqual([["general", "src/app.ts:1: Body."]]);

    // Back on the validator's line, the validator's state applies again.
    r = await s.act(f, { action: "move", revision: 3, line: 3 });
    expect(r.body.anchor).toMatchObject({ line: 3, state: "exact" });
    p = await s.plan();
    expect(p.posts[0]?.destination.kind).toBe("inline");
  });

  test("a stale revision gives 409 with the current item, and a posted item takes no change", async () => {
    const s = await setup();
    const f = s.finding();
    await s.accept(f);
    for (const body of [
      { action: "discard", revision: 0 },
      { action: "edit", revision: 0, body: "x" },
      { action: "move", revision: 0, line: 2 },
    ]) {
      const r = await s.act(f, body);
      expect(r.status).toBe(409);
      expect([r.body.item.id, r.body.item.revision, r.body.item.status]).toEqual([f, 1, "accepted"]);
    }
    s.db.query("UPDATE review_item SET status = 'posted' WHERE id = $id").run({ id: f });
    expect((await s.act(f, { action: "restore", revision: 1 })).status).toBe(409);
    expect((await s.plan()).posts).toEqual([]);
    expect((await s.act(999, { action: "accept", revision: 0 })).status).toBe(404);
    expect((await s.act(f, { action: "nope", revision: 0 })).status).toBe(400);
  });

  test("the general comment holds outside and old-side findings, then the questions", async () => {
    const s = await setup();
    const ids = [
      s.question("Must flush stay atomic?", "The description does not say."),
      s.finding({ state: "outside", line: 1, body: "Outside text." }),
      s.finding({ side: "old", line: 8, path: "new/name.ts", oldPath: "old/name.ts", body: "Removed text." }),
      s.question("Second?", "Why two."),
    ];
    for (const id of ids) await s.accept(id);
    const p = await s.plan();
    expect(p.posts).toHaveLength(1);
    expect(p.posts[0]?.destination).toEqual({ kind: "general" });
    expect(p.posts[0]?.items).toEqual(ids.map((id) => ({ id, revision: 1 })));
    expect(p.posts[0]?.body).toBe(
      "src/app.ts:1: Outside text.\n\nold/name.ts:8: Removed text.\n\nQuestions:\n\n- Must flush stay atomic? The description does not say.\n- Second? Why two.",
    );
    // The route body equals the plan function output byte for byte.
    expect(JSON.stringify(p.posts)).toBe(JSON.stringify((await s.plan()).posts));
  });

  test("one question posts as one paragraph", () => {
    expect(generalText([], [{ body: "Q?", why: "W." }])).toBe("Q? W.");
    expect(generalText([{ ref: "a.ts:1", body: "T." }], [])).toBe("a.ts:1: T.");
  });

  test("duplicate warning: a live root comment by another user on the same path and line", async () => {
    const s = await setup();
    const f = s.finding();
    const g = s.finding({ line: 4 });
    await s.accept(f);
    await s.accept(g);
    const at = (line: number, fileType = "TO") => ({ path: "src/app.ts", line, lineType: "ADDED", fileType });
    s.comment(10, FAKE_USER, at(3));
    s.comment(11, "asmith", at(4), { tombstoned: true });
    s.comment(12, "asmith", at(4, "FROM"));
    s.comment(13, "asmith", null);
    expect((await s.plan()).posts.map((x) => x.duplicate)).toEqual([null, null]);
    s.comment(14, "asmith", at(3));
    s.comment(15, "asmith", at(4), { parent: 14 });
    expect((await s.plan()).posts.map((x) => x.duplicate)).toEqual([{ commentId: 14, author: "Alex Smith" }, null]);
  });

  test("an unknown pull request gives 404", async () => {
    const s = await setup();
    expect((await s.call("/api/prs/999/post-plan")).status).toBe(404);
  });

  test("buildPlan keeps runs apart, with one general comment per run", () => {
    const item = (id: number, run: number): ReviewItemDto => ({
      id,
      run,
      kind: "question",
      body: `Q${id}?`,
      payload: { text: `Q${id}?`, why: "W." },
      anchor: null,
      status: "accepted",
      revision: 2,
      edited: false,
    });
    const runs = [1, 2].map((id) => ({ id, sourceHead: SOURCE, targetHead: TARGET, mergeBase: BASE }));
    const posts = buildPlan({ me: FAKE_USER, runs, items: [item(5, 2), item(3, 1), { ...item(4, 1), status: "new" }], comments: [] });
    expect(posts.map((p) => [p.run, p.body, p.items])).toEqual([
      [1, "Q3? W.", [{ id: 3, revision: 2 }]],
      [2, "Q5? W.", [{ id: 5, revision: 2 }]],
    ]);
  });
});
