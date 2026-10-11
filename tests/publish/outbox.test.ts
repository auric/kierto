// Plan v3 WP13a: the outbox, reply posts, and confirm. The app runs in-process against the fake Bitbucket on 127.0.0.1.
// No test reaches a real host.
import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/server/app";
import { ForgeError } from "../../src/server/bitbucket/client";
import { createBitbucketProvider } from "../../src/server/bitbucket/provider";
import { writeConfig } from "../../src/server/config";
import { createLive } from "../../src/server/live";
import { createOutbox, type Outbox } from "../../src/server/publish/outbox";
import { createReviewJobs } from "../../src/server/review/jobs";
import { createSecrets } from "../../src/server/secrets";
import { createSettings } from "../../src/server/settings";
import { createSyncEngine } from "../../src/server/sync/engine";
import type { ConfirmDto, PostDto, PostPlanDto, PrDetail, ReplyConflict, ReviewItemDto } from "../../src/shared/dto";
import type { ExcerptLine } from "../../src/shared/review";
import { FAKE_TOKEN, FAKE_USER, key, type Reply, type Route, startFakeBitbucket } from "../support/fake-bitbucket";
import {
  ACTIVITIES_PATH,
  type Activity,
  activities,
  addReply,
  commentPosts,
  DASHBOARD_PATH,
  findComment,
  onePage,
  ownPr,
  PR_PATH,
  PR_REF,
  secondUser,
} from "../support/scenarios";

process.env.REVIEW_LOOP_SECRETS = "memory";
const PORT = 7317;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SESSION = "s".repeat(64);
const HEADERS: Record<string, string> = {
  host: `127.0.0.1:${PORT}`,
  origin: ORIGIN,
  "x-rl-session": SESSION,
  "content-type": "application/json",
};
const ROOT = 1000003;
// The newest message of the thread: a reply by another user under the token owner's comment.
const THEIRS = 1000020;
const FIRST_ID = 4_000_001;
const OTHER = secondUser();
const ME = findComment(activities("activities-nested-reply.json"), ROOT).author;
const KEY = "0b7c3a52-9d4e-4f61-8a2b-3c5d7e9f1a20";
const TEXT = "Fixed in the next commit.";
const COMMENTS = `POST ${PR_PATH}/comments`;
const SOURCE = ownPr().fromRef.latestCommit;
const TARGET = (ownPr() as unknown as { toRef: { latestCommit: string } }).toRef.latestCommit;
const ok = (body: unknown): Reply => ({ status: 200, body });
const refuse = (status: number): Reply => ({ status, body: { errors: [{ message: "Refused." }] } });

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

function thread(): Activity[] {
  const list = addReply(activities("activities-nested-reply.json"), ROOT, THEIRS, OTHER, "Can you check the flush order?");
  Object.assign(findComment(list, THEIRS), { createdDate: 1791571358000, updatedDate: 1791571358000 });
  return list;
}

async function setup() {
  const world = { pr: ownPr(), list: thread };
  const posts = commentPosts(PR_PATH, () => world.list(), ME, FIRST_ID);
  const fake = startFakeBitbucket({
    routes: {
      [key("GET", DASHBOARD_PATH)]: (req) => ok(onePage(new URL(req.url).searchParams.get("role") === "AUTHOR" ? [world.pr] : [])),
      [key("GET", PR_PATH)]: () => ok(world.pr),
      [key("GET", ACTIVITIES_PATH)]: () => ok(onePage(posts.activities())),
      ...posts.routes,
    },
  });
  const dir = mkdtempSync(join(tmpdir(), "rl-wp13-"));
  writeConfig(dir, { baseUrl: fake.url, userSlug: FAKE_USER, notifications: false });
  const secrets = createSecrets(null);
  await secrets.set(FAKE_TOKEN);
  const settings = createSettings({ dir, secrets });
  const live = createLive();
  const sync = createSyncEngine({ settings, live });
  // A runner command that never runs: no test starts a review.
  const review = createReviewJobs({ settings, live, dataDir: dir, runnerCommand: [process.execPath, "--version"] });
  const make = () => {
    const outbox = createOutbox({ settings, live });
    return { outbox, app: createApp({ port: PORT, token: SESSION, live, settings, sync, review, outbox }) };
  };
  let cur: { outbox: Outbox; app: ReturnType<typeof createApp> } = make();
  cleanup.push(async () => {
    await cur.outbox.stop();
    sync.stop();
    settings.close();
    fake.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });
  await sync.syncNow();
  const db = settings.db() as Database;
  const { id: pr } = db.query("SELECT id FROM pull_request WHERE pr_id = $id").get({ id: PR_REF.id }) as { id: number };

  const call = async <T>(path: string, body?: unknown, headers = HEADERS) => {
    const res = await cur.app.request(`${ORIGIN}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, body: json as T };
  };
  const reply = (o: Record<string, unknown> = {}) =>
    call<PostDto & ReplyConflict>(`/api/prs/${pr}/replies`, { parentId: THEIRS, body: TEXT, seen: THEIRS, key: KEY, ...o });
  const plan = async () => (await call<PostPlanDto>(`/api/prs/${pr}/post-plan`)).body.posts;
  return {
    world,
    posts,
    fake,
    sync,
    db,
    pr,
    call,
    reply,
    plan,
    list: async () => (await call<PostDto[]>(`/api/prs/${pr}/posts`)).body,
    sent: () => fake.requests.filter((r) => r === COMMENTS).length,
    settle: () => cur.outbox.wait(),
    // A new process on the same data folder.
    async restart() {
      await cur.outbox.stop();
      cur = make();
      cur.outbox.start();
    },
  };
}
type S = Awaited<ReturnType<typeof setup>>;

// New side: 1 is outside the diff, 2 is hunk context, 3 is added.
const EXCERPT: ExcerptLine[] = [
  { n: 1, kind: "ctx", text: "a" },
  { n: 2, kind: "ctx", text: "b", hunk: true },
  { n: 3, kind: "add", text: "c2" },
];

// A completed review run on the given heads. item() adds a finding at a line, or a question for a null line.
function seedRun(s: S, heads = { source: SOURCE, target: TARGET }) {
  const { id: run } = s.db
    .query(
      `INSERT INTO review_run (pr, profile, note, idem_key, source_head, target_head, merge_base, status, started_at, finished_at)
      VALUES ($pr, 'general', '', 'k', $s, $t, $t, 'completed', 1, 2) RETURNING id`,
    )
    .get({ pr: s.pr, s: heads.source, t: heads.target }) as { id: number };
  const item = (body: string, line: number | null, state: "exact" | "outside" = "exact") => {
    const finding = line !== null;
    const payload = finding
      ? {
          path: "src/app.ts",
          side: "new",
          line,
          lineEnd: null,
          anchorText: "x",
          severity: "minor",
          category: "naming",
          body,
          evidence: "",
          evidenceStatus: "code",
          confidence: "high",
          agent: null,
          anchor: { state, path: "src/app.ts", oldPath: null, line, lineEnd: line, excerpt: EXCERPT },
        }
      : { text: body, why: "Why." };
    return (
      s.db
        .query(
          `INSERT INTO review_item (run, kind, payload_json, body, path, side, line, line_end, anchor_state, excerpt_json)
          VALUES ($run, $kind, $payload, $body, $path, $side, $line, $line, $state, $excerpt) RETURNING id`,
        )
        .get({
          run,
          kind: finding ? "finding" : "question",
          payload: JSON.stringify(payload),
          body,
          path: finding ? "src/app.ts" : null,
          side: finding ? "new" : null,
          line,
          state: finding ? state : null,
          excerpt: finding ? JSON.stringify(EXCERPT) : null,
        }) as { id: number }
    ).id;
  };
  return { run, item };
}

async function accept(s: S, ...ids: number[]) {
  for (const id of ids) expect((await s.call<ReviewItemDto>(`/api/items/${id}`, { action: "accept", revision: 0 })).status).toBe(200);
}
const itemsOf = (posts: PostPlanDto["posts"]) => posts.flatMap((p) => p.items);
const itemRow = (s: S, id: number) =>
  s.db.query("SELECT status, revision, anchor_state FROM review_item WHERE id = $id").get({ id }) as {
    status: string;
    revision: number;
    anchor_state: string | null;
  };

describe("reply posts", () => {
  test("a reply sends one POST with text and parent; the same key twice sends one POST", async () => {
    const s = await setup();
    const first = await s.reply();
    expect(first.status).toBe(202);
    expect([first.body.state, first.body.run, first.body.destination]).toEqual(["pending", null, { kind: "reply", parentId: THEIRS }]);
    const again = await s.reply();
    expect([again.status, again.body.id]).toEqual([200, first.body.id]);
    await s.settle();
    expect(s.posts.bodies).toEqual([{ text: TEXT, parent: { id: THEIRS } }]);
    expect(s.sent()).toBe(1);
    const [post] = await s.list();
    expect(post).toMatchObject({
      id: first.body.id,
      state: "confirmed",
      remoteId: FIRST_ID,
      remoteVersion: 0,
      attempts: 1,
      lastError: null,
    });
    // The key is spent: another text under it never posts.
    expect((await s.reply({ body: "Other text." })).status).toBe(409);
    expect((await s.reply()).status).toBe(200);
    await s.settle();
    expect(s.sent()).toBe(1);
  });

  test("a stale seen gives 409 with the newest message and no POST", async () => {
    const s = await setup();
    const r = await s.reply({ seen: 1000001 });
    expect(r.status).toBe(409);
    expect(r.body.newest).toBe(THEIRS);
    // A reply to an older message of the thread checks the newest message of the whole thread.
    expect((await s.reply({ parentId: ROOT, seen: 1000001 })).status).toBe(409);
    expect((await s.reply({ parentId: 999 })).status).toBe(404);
    expect((await s.reply({ key: "not-a-uuid" })).status).toBe(400);
    expect((await s.reply({ body: "   " })).status).toBe(400);
    s.db.query("UPDATE comment SET tombstoned_at = 1 WHERE comment_id = $id").run({ id: THEIRS });
    expect((await s.reply({ parentId: THEIRS, seen: 1000001 })).status).toBe(409);
    await s.settle();
    expect(s.sent()).toBe(0);
    expect(await s.list()).toEqual([]);
  });

  test("a parent deleted on the server fails the reply with no POST", async () => {
    const s = await setup();
    s.fake.routes[key("GET", `${PR_PATH}/comments/${THEIRS}`)] = refuse(404);
    expect((await s.reply()).status).toBe(202);
    await s.settle();
    const [post] = await s.list();
    expect(post?.state).toBe("failed");
    expect(post?.lastError).toContain("deleted");
    expect(post?.attempts).toBe(0);
    expect(s.fake.requests).toContain(`GET ${PR_PATH}/comments/${THEIRS}`);
    expect(s.sent()).toBe(0);
  });

  test("a 4xx fails with no retry; post again and drop are user actions", async () => {
    const s = await setup();
    s.fake.routes[key("POST", `${PR_PATH}/comments`)] = refuse(400);
    const { body } = await s.reply();
    await s.settle();
    const [post] = await s.list();
    expect([post?.state, post?.lastError, post?.attempts]).toEqual(["failed", "Bitbucket refused the comment (HTTP 400).", 1]);
    expect(s.sent()).toBe(1);
    expect((await s.call(`/api/posts/${body.id}/drop`, {})).status).toBe(200);
    expect(await s.list()).toEqual([]);
    expect((await s.call(`/api/posts/${body.id}/retry`, {})).status).toBe(404);
  });

  test("A9: accept-then-drop gives unknown; the check matches author, exact text, and parent; no second POST", async () => {
    const s = await setup();
    s.posts.drop = true;
    // The first check cannot read the comments, so the row stays unknown.
    s.fake.routes[key("GET", ACTIVITIES_PATH)] = refuse(503);
    const { body } = await s.reply();
    await s.settle();
    const [unknown] = await s.list();
    expect([unknown?.state, unknown?.checking, unknown?.attempts]).toEqual(["unknown", false, 1]);
    expect(unknown?.lastError).toContain("Could not read all comments");
    expect(s.sent()).toBe(1);

    s.fake.routes[key("GET", ACTIVITIES_PATH)] = () => ok(onePage(s.posts.activities()));
    const r = await s.call<PostDto>(`/api/posts/${body.id}/retry`, {});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ state: "confirmed", remoteId: FIRST_ID, attempts: 1 });
    await s.settle();
    expect(s.sent()).toBe(1);
  });

  test("A9: the sender checks an unknown post at once and confirms it", async () => {
    const s = await setup();
    s.posts.drop = true;
    await s.reply();
    await s.settle();
    const [post] = await s.list();
    expect(post).toMatchObject({ state: "confirmed", remoteId: FIRST_ID, attempts: 1, lastError: null, checking: false });
    expect(s.sent()).toBe(1);
  });

  test("no match leaves unknown; post again sends once more; other authors, texts, and parents never match", async () => {
    const s = await setup();
    // Decoys: the same text by another user under the parent, and my text under another parent.
    s.world.list = () => addReply(addReply(thread(), THEIRS, 1000030, OTHER, TEXT), ROOT, 1000031, ME, TEXT);
    // Once: the connection drops before the server stores the comment.
    const postKey = key("POST", `${PR_PATH}/comments`);
    const store = s.fake.routes[postKey] as Route;
    s.fake.routes[postKey] = () => {
      s.fake.routes[postKey] = store;
      return { drop: true };
    };
    const { body } = await s.reply();
    await s.settle();
    let [post] = await s.list();
    expect([post?.state, post?.lastError]).toEqual(["unknown", "No matching comment on Bitbucket. Post again or drop."]);
    const r = await s.call<PostDto>(`/api/posts/${body.id}/retry`, {});
    expect([r.status, r.body.state]).toEqual([202, "pending"]);
    await s.settle();
    [post] = await s.list();
    expect(post).toMatchObject({ state: "confirmed", remoteId: FIRST_ID, attempts: 2 });
    expect(s.sent()).toBe(2);
    expect((await s.call(`/api/posts/${body.id}/retry`, {})).status).toBe(409);
    expect((await s.call(`/api/posts/${body.id}/drop`, {})).status).toBe(409);
  });

  test("at start a sent post becomes unknown, and the check confirms it with no second POST", async () => {
    const s = await setup();
    await s.reply();
    await s.settle();
    // The app stopped after the request went out and before the answer was stored.
    s.db.run("UPDATE post SET state = 'sent', remote_id = NULL, remote_version = NULL");
    await s.restart();
    expect((s.db.query("SELECT state FROM post").get() as { state: string }).state).toBe("unknown");
    await s.settle();
    const [post] = await s.list();
    expect(post).toMatchObject({ state: "confirmed", remoteId: FIRST_ID, attempts: 1 });
    expect(s.sent()).toBe(1);
  });

  test("my reply syncs back as read, with no notification and the posted mark", async () => {
    const s = await setup();
    await s.reply();
    await s.settle();
    await s.sync.syncNow();
    const row = s.db.query("SELECT version, ack_version, parent_id FROM comment WHERE comment_id = $id").get({ id: FIRST_ID }) as {
      version: number;
      ack_version: number;
      parent_id: number;
    };
    expect(row).toEqual({ version: 0, ack_version: 0, parent_id: THEIRS });
    expect(s.db.query("SELECT COUNT(*) AS n FROM event").get()).toEqual({ n: 0 });
    const detail = (await s.call<PrDetail>(`/api/prs/${s.pr}`)).body;
    expect(detail.comments.find((c) => c.id === FIRST_ID)).toMatchObject({ unread: false, posted: "reply", text: TEXT });
    expect(detail.comments.find((c) => c.id === THEIRS)?.posted).toBeUndefined();
  });

  test("the guard refuses every outbox mutation without the session header", async () => {
    const s = await setup();
    const { "x-rl-session": _, ...noSession } = HEADERS;
    for (const [path, body] of [
      [`/api/prs/${s.pr}/replies`, { parentId: THEIRS, body: TEXT, seen: THEIRS, key: KEY }],
      [`/api/prs/${s.pr}/confirm`, { items: [{ id: 1, revision: 0 }] }],
      ["/api/posts/1/retry", {}],
      ["/api/posts/1/drop", {}],
    ] as const)
      expect((await s.call(path, body, noSession)).status).toBe(403);
    await s.settle();
    expect(s.sent()).toBe(0);
    expect(await s.list()).toEqual([]);
  });

  test("no token in rows, logs, or URLs", async () => {
    const lines: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      lines.push(a.map(String).join(" "));
    });
    cleanup.push(() => spy.mockRestore());
    const s = await setup();
    s.posts.drop = true;
    s.fake.routes[key("GET", ACTIVITIES_PATH)] = refuse(500);
    await s.reply();
    await s.reply({ key: "4f2d8c1e-6a3b-4e5f-9b7a-1c2d3e4f5a6b", body: "Second." });
    await s.settle();
    const rows = JSON.stringify(s.db.query("SELECT * FROM post").all());
    expect(rows).toContain("unknown");
    for (const text of [rows, lines.join("\n"), s.fake.requests.join("\n")]) expect(text).not.toContain(FAKE_TOKEN);
  });

  test("createComment never repeats a POST; a timeout is a ForgeError", async () => {
    const fake = startFakeBitbucket({ routes: { [key("POST", `${PR_PATH}/comments`)]: { hang: true } } });
    cleanup.push(() => fake.stop());
    const p = createBitbucketProvider({ baseUrl: fake.url, token: FAKE_TOKEN, timeoutMs: 200 });
    const e = await p.createComment(PR_REF, { text: TEXT }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ForgeError);
    expect((e as ForgeError).kind).toBe("timeout");
    expect(fake.requests).toEqual([COMMENTS]);
  });
});

describe("confirm", () => {
  test("posts the plan once: the inline anchor body, the general text, and A14 two confirms give one POST each", async () => {
    const s = await setup();
    const { item } = seedRun(s);
    const ids = [item("Inline text.", 3), item("Outside text.", 1, "outside"), item("Q?", null)];
    await accept(s, ...ids);
    const plan = await s.plan();
    expect(plan.map((p) => p.destination.kind)).toEqual(["inline", "general"]);
    const items = itemsOf(plan);
    const r = await s.call<ConfirmDto>(`/api/prs/${s.pr}/confirm`, { items });
    expect(r.status).toBe(202);
    expect(r.body.warning).toBeNull();
    expect(r.body.posts.map((p) => [p.state, p.body])).toEqual([
      ["pending", "Inline text."],
      ["pending", "src/app.ts:1: Outside text.\n\nQ? Why."],
    ]);
    await s.settle();
    expect(s.posts.bodies).toEqual([
      {
        text: "Inline text.",
        anchor: { path: "src/app.ts", line: 3, lineType: "ADDED", fileType: "TO", diffType: "COMMIT", fromHash: TARGET, toHash: SOURCE },
      },
      { text: "src/app.ts:1: Outside text.\n\nQ? Why." },
    ]);
    expect((await s.list()).map((p) => [p.state, p.remoteId])).toEqual([
      ["confirmed", FIRST_ID],
      ["confirmed", FIRST_ID + 1],
    ]);
    expect(ids.map((id) => itemRow(s, id).status)).toEqual(["posted", "posted", "posted"]);
    expect(await s.plan()).toEqual([]);

    const again = await s.call<ConfirmDto>(`/api/prs/${s.pr}/confirm`, { items });
    expect(again.status).toBe(200);
    expect(again.body.posts.map((p) => p.id)).toEqual(r.body.posts.map((p) => p.id));
    await s.settle();
    expect(s.sent()).toBe(2);

    await s.sync.syncNow();
    const detail = (await s.call<PrDetail>(`/api/prs/${s.pr}`)).body;
    expect(detail.comments.filter((c) => c.posted === "run").map((c) => c.id)).toEqual([FIRST_ID, FIRST_ID + 1]);
  });

  test("a new source head blocks the post; a moved target head warns (D2)", async () => {
    const s = await setup();
    const { item } = seedRun(s);
    const id = item("Inline text.", 3);
    await accept(s, id);
    const items = itemsOf(await s.plan());
    s.world.pr.fromRef.latestCommit = "f".repeat(40);
    const blocked = await s.call<{ error: string }>(`/api/prs/${s.pr}/confirm`, { items });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toContain("new commits");
    expect(await s.list()).toEqual([]);
    expect(itemRow(s, id).status).toBe("accepted");

    s.world.pr.fromRef.latestCommit = SOURCE;
    (s.world.pr as unknown as { toRef: { latestCommit: string } }).toRef.latestCommit = "e".repeat(40);
    const r = await s.call<ConfirmDto>(`/api/prs/${s.pr}/confirm`, { items });
    expect(r.status).toBe(202);
    expect(r.body.warning).toContain("target branch moved");
    await s.settle();
    // The anchor stays on the reviewed commits.
    expect(s.posts.bodies[0]?.anchor).toMatchObject({ fromHash: TARGET, toHash: SOURCE });
    expect(s.sent()).toBe(1);
  });

  test("a confirm that differs from the plan gives 409 and sends nothing", async () => {
    const s = await setup();
    const { item } = seedRun(s);
    const inline = item("Inline text.", 3);
    const outside = item("Outside text.", 1, "outside");
    const question = item("Q?", null);
    await accept(s, inline, outside, question);
    const conflict = async (items: unknown, status = 409) =>
      expect((await s.call(`/api/prs/${s.pr}/confirm`, { items })).status).toBe(status);
    await conflict([{ id: inline, revision: 0 }]);
    // Half of the general comment.
    await conflict([{ id: outside, revision: 1 }]);
    await conflict([
      { id: inline, revision: 1 },
      { id: 999, revision: 0 },
    ]);
    await conflict(
      [
        { id: inline, revision: 1 },
        { id: inline, revision: 1 },
      ],
      400,
    );
    await conflict([], 400);
    // Only the inline post: the general comment stays in the plan.
    const r = await s.call<ConfirmDto>(`/api/prs/${s.pr}/confirm`, { items: [{ id: inline, revision: 1 }] });
    expect(r.status).toBe(202);
    await s.settle();
    expect(s.sent()).toBe(1);
    expect((await s.plan()).map((p) => p.destination.kind)).toEqual(["general"]);
  });

  test("a 400 on a context line fails the inline post; drop with general moves the finding to the general comment", async () => {
    const s = await setup();
    const { item } = seedRun(s);
    const id = item("Context text.", 2);
    await accept(s, id);
    const plan = await s.plan();
    expect(plan[0]?.destination).toMatchObject({ kind: "inline", line: 2, lineType: "ctx" });
    s.fake.routes[key("POST", `${PR_PATH}/comments`)] = refuse(400);
    const r = await s.call<ConfirmDto>(`/api/prs/${s.pr}/confirm`, { items: itemsOf(plan) });
    await s.settle();
    const [post] = await s.list();
    expect(post?.state).toBe("failed");
    expect(post?.lastError).toContain("context line");
    expect(s.sent()).toBe(1);
    const postId = r.body.posts[0]?.id as number;
    expect((await s.call(`/api/posts/${postId}/drop`, { general: "yes" })).status).toBe(400);
    expect((await s.call(`/api/posts/${postId}/drop`, { general: true })).status).toBe(200);
    expect(itemRow(s, id)).toEqual({ status: "accepted", revision: 2, anchor_state: "outside" });
    expect((await s.plan()).map((p) => [p.destination.kind, p.body])).toEqual([["general", "src/app.ts:2: Context text."]]);
    expect(await s.list()).toEqual([]);
  });
});
