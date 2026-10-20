// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Plan r3 S-APPLY: a "Fixed in" reply posts only when the synced PR commits hold its commit for the current heads.
// The app runs in-process against the fake Bitbucket on 127.0.0.1. No test reaches a real host.
import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/server/app";
import { writeConfig } from "../../src/server/config";
import { createLive } from "../../src/server/live";
import { createOutbox } from "../../src/server/publish/outbox";
import { git, gitEnv } from "../../src/server/review/git";
import { createReviewJobs } from "../../src/server/review/jobs";
import { createSecrets } from "../../src/server/secrets";
import { createSettings } from "../../src/server/settings";
import { createSyncEngine } from "../../src/server/sync/engine";
import type { BlockedReason, ConfirmDto, PostPlanDto, ReviewItemDto } from "../../src/shared/dto";
import type { ReplyPayload } from "../../src/shared/review";
import { FAKE_TOKEN, FAKE_USER, fixture, key, type Reply, startFakeBitbucket } from "../support/fake-bitbucket";
import {
  ACTIVITIES_PATH,
  activities,
  addReply,
  commentPosts,
  DASHBOARD_PATH,
  findComment,
  onePage,
  ownPr,
  type Page,
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
// The newest message of the thread: a reply by another user.
const THEIRS = 1000020;
const ME = findComment(activities("activities-nested-reply.json"), ROOT).author;
const COMMENTS = `POST ${PR_PATH}/comments`;
const FIX = "c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00";
const LATER = "d00dfeedd00dfeedd00dfeedd00dfeedd00dfeed";
const ok = (body: unknown): Reply => ({ status: 200, body });
const NOT_FOUND: Reply = { status: 404, body: { errors: [{ message: "Not found." }] } };

type Commit = { id: string; displayId: string; parents: { id: string }[] };
const COMMITS = fixture<Page<Commit>>("pull-request-commits-page.json").body.values;
const CHANGES = fixture<Page>("pull-request-changes.json").body.values;

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

async function setup() {
  const pr = ownPr() as ReturnType<typeof ownPr> & { fromRef: { latestCommit: string } };
  const source = pr.fromRef.latestCommit;
  const thread = () => {
    const list = addReply(activities("activities-nested-reply.json"), ROOT, THEIRS, secondUser(), "Release the lock in finally.");
    Object.assign(findComment(list, THEIRS), { createdDate: 1791571358000, updatedDate: 1791571358000 });
    return list;
  };
  const posts = commentPosts(PR_PATH, thread, ME, 4_000_001);
  // commits: null answers 404, so the sync keeps the stored commits and meta_head.
  const world = { commits: COMMITS as Commit[] | null };
  const fake = startFakeBitbucket({
    routes: {
      [key("GET", DASHBOARD_PATH)]: (req) => ok(onePage(new URL(req.url).searchParams.get("role") === "AUTHOR" ? [pr] : [])),
      [key("GET", PR_PATH)]: () => ok(pr),
      [key("GET", ACTIVITIES_PATH)]: () => ok(onePage(posts.activities())),
      [key("GET", `${PR_PATH}/commits`)]: () => (world.commits ? ok(onePage(world.commits)) : NOT_FOUND),
      [key("GET", `${PR_PATH}/changes`)]: () => ok(onePage(CHANGES)),
      ...posts.routes,
    },
  });
  const dir = mkdtempSync(join(tmpdir(), "rl-fix-reply-"));
  writeConfig(dir, { baseUrl: fake.url, userSlug: FAKE_USER, notifications: false, markAi: false });
  const secrets = createSecrets(null);
  await secrets.set(FAKE_TOKEN);
  const settings = createSettings({ dir, secrets });
  const live = createLive();
  const sync = createSyncEngine({ settings, live });
  const review = createReviewJobs({ settings, live, dataDir: dir, runnerCommand: [process.execPath, "--version"] });
  const outbox = createOutbox({ settings, live });
  const app = createApp({ port: PORT, token: SESSION, live, settings, sync, review, outbox });
  outbox.start();
  cleanup.push(async () => {
    await outbox.stop();
    sync.stop();
    settings.close();
    fake.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });
  await sync.syncNow();
  const db = settings.db() as Database;
  const { id } = db.query("SELECT id FROM pull_request WHERE pr_id = $id").get({ id: PR_REF.id }) as { id: number };

  // A committed fix and its accepted "Fixed in" reply item, as fix-routes.ts stores them.
  const { id: run } = db
    .query(
      `INSERT INTO review_run (pr, kind, profile, note, idem_key, source_head, target_head, status, started_at, finished_at)
      VALUES ($pr, 'fix', 'general', '', 'fix', $s, 't', 'completed', 1, 2) RETURNING id`,
    )
    .get({ pr: id, s: source }) as { id: number };
  const { id: fix } = db
    .query(
      `INSERT INTO fix_commit (pr, run, idem_key, edits_json, mode, before_head, commit_hash, short_hash, state, message, created_at, updated_at)
      VALUES ($pr, $run, 'k', '[1]', 'clone', $s, $c, 'c0ffee0', 'committed', 'Fix', 1, 1) RETURNING id`,
    )
    .get({ pr: id, run, s: source, c: FIX }) as { id: number };
  const body = "Fixed in c0ffee0.";
  const payload = {
    thread: ROOT,
    action: "reply",
    body,
    reason: "R.",
    evidenceStatus: "code",
    judgement: null,
    replyTo: THEIRS,
    fix: { id: fix, commit: FIX },
  };
  const { id: item } = db
    .query(
      `INSERT INTO review_item (run, kind, payload_json, body, status, thread) VALUES ($run, 'reply', $p, $b, 'accepted', $t) RETURNING id`,
    )
    .get({ run, p: JSON.stringify(payload), b: body, t: ROOT }) as { id: number };

  const confirm = async (revision = 0) => {
    const res = await app.request(`${ORIGIN}/api/prs/${id}/confirm`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ items: [{ id: item, revision }] }),
    });
    return { status: res.status, body: (await res.json()) as ConfirmDto & { error?: string } };
  };
  const plan = async () => (await (await app.request(`${ORIGIN}/api/prs/${id}/post-plan`, { headers: HEADERS })).json()) as PostPlanDto;
  // The fix commit lives in a clone of the user, on branch.
  const inClone = (path: string, branch: string, commit: string) => {
    db.query("UPDATE fix_commit SET clone_path = $path, branch = $branch, commit_hash = $commit, short_hash = $short WHERE id = $id").run({
      path,
      branch,
      commit,
      short: commit.slice(0, 7),
      id: fix,
    });
    db.query("UPDATE review_item SET payload_json = $p WHERE id = $id").run({
      p: JSON.stringify({ ...payload, fix: { id: fix, commit } }),
      id: item,
    });
  };
  // The PR source branch moves to head. commits: the list that Bitbucket then serves, or null for 404.
  const push = async (head: string, commits: Commit[] | null) => {
    pr.fromRef.latestCommit = head;
    world.commits = commits;
    await sync.syncNow();
  };
  const fixCommit: Commit = { ...structuredClone(COMMITS[0] as Commit), id: FIX, displayId: FIX.slice(0, 11), parents: [{ id: source }] };
  const plain = async (revision: number) => {
    const res = await app.request(`${ORIGIN}/api/items/${item}`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ action: "plain", revision }),
    });
    return { status: res.status, body: (await res.json()) as ReviewItemDto & { error?: string } };
  };
  return {
    db,
    id,
    item,
    plain,
    plan,
    inClone,
    fake,
    posts,
    confirm,
    push,
    fixCommit,
    sent: () => fake.requests.filter((r) => r === COMMENTS).length,
    settle: () => outbox.wait(),
  };
}

const NOT_NOW = "A draft in the list cannot post now. The new list shows why.";

describe("Fixed in replies", () => {
  test("no commit in pr_commit: the plan leaves the draft out as unpushed, and confirm gives 409 and no POST; after the push and a sync, 202 and exactly one POST to the parent", async () => {
    const s = await setup();
    expect(await s.plan()).toEqual({
      pr: s.id,
      posts: [],
      blocked: [{ item: s.item, revision: 0, thread: ROOT, reason: "unpushed", commit: "c0ffee0" }],
    });
    const blocked = await s.confirm();
    expect([blocked.status, blocked.body.error]).toEqual([409, NOT_NOW]);
    await s.settle();
    expect(s.sent()).toBe(0);

    await s.push(FIX, [s.fixCommit, ...COMMITS]);
    expect(
      s.db.query("SELECT meta_head = source_head || ':' || target_head AS current FROM pull_request WHERE id = $id").get({ id: s.id }),
    ).toEqual({
      current: 1,
    });
    expect((await s.plan()).blocked).toBeUndefined();
    const r = await s.confirm();
    expect(r.status).toBe(202);
    await s.settle();
    expect(s.sent()).toBe(1);
    expect(s.posts.bodies).toEqual([{ text: "Fixed in c0ffee0.", parent: { id: THEIRS } }]);
  });

  test("a stale meta_head gives 409 although pr_commit holds the commit", async () => {
    const s = await setup();
    await s.push(FIX, [s.fixCommit, ...COMMITS]);
    // The source moves on, and the commits fetch fails. pr_commit still lists the fix, but for the old heads.
    await s.push(LATER, null);
    expect(s.db.query("SELECT COUNT(*) AS n FROM pr_commit WHERE pr = $pr AND hash = $h").get({ pr: s.id, h: FIX })).toEqual({ n: 1 });
    expect((await s.plan()).blocked).toEqual([{ item: s.item, revision: 0, thread: ROOT, reason: "unpushed", commit: "c0ffee0" }]);
    const r = await s.confirm();
    expect([r.status, r.body.error]).toEqual([409, NOT_NOW]);
    await s.settle();
    expect(s.sent()).toBe(0);
  });

  test("thread outcome: a fix commit that its clone branch still holds is unpushed; after a rebase it is commit-gone, and Post as plain reply posts it", async () => {
    const s = await setup();
    const root = mkdtempSync(join(tmpdir(), "rl-fix-gone-"));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    writeFileSync(join(root, "empty.gitconfig"), "");
    const env = {
      ...gitEnv(join(root, "empty.gitconfig")),
      GIT_AUTHOR_NAME: "Setup",
      GIT_AUTHOR_EMAIL: "setup@example.invalid",
      GIT_COMMITTER_NAME: "Setup",
      GIT_COMMITTER_EMAIL: "setup@example.invalid",
    };
    const clone = join(root, "clone");
    const g = async (...args: string[]) => (await git(["-C", clone, ...args], { env })).trim();
    await git(["init", "-q", "--template=", clone], { env });
    await g("symbolic-ref", "HEAD", "refs/heads/topic");
    await g("commit", "-q", "--allow-empty", "-m", "Base");
    const base = await g("rev-parse", "HEAD");
    await g("commit", "-q", "--allow-empty", "-m", "Fix review comment");
    const commit = await g("rev-parse", "HEAD");
    const draft = (reason: BlockedReason) => [{ item: s.item, revision: 0, thread: ROOT, reason, commit: commit.slice(0, 7) }];

    // A clone that git cannot read proves nothing, so the draft waits for the push.
    s.inClone(join(root, "missing"), "topic", commit);
    expect((await s.plan()).blocked).toEqual(draft("unpushed"));
    s.inClone(clone, "topic", commit);
    expect((await s.plan()).blocked).toEqual(draft("unpushed"));
    // A rebase moves the branch to new commits. The fix commit cannot reach the PR now.
    await g("update-ref", "refs/heads/topic", base);
    expect((await s.plan()).blocked).toEqual(draft("commit-gone"));
    expect((await s.confirm()).status).toBe(409);

    const r = await s.plain(0);
    expect([r.status, r.body.status]).toEqual([200, "accepted"]);
    const plan = await s.plan();
    expect(plan.blocked).toBeUndefined();
    expect(plan.posts.map((p) => [p.destination, p.body, p.items])).toEqual([
      [{ kind: "reply", parentId: THEIRS }, "Fixed in c0ffee0.", [{ id: s.item, revision: 1 }]],
    ]);
    expect((await s.confirm(1)).status).toBe(202);
    await s.settle();
    expect(s.sent()).toBe(1);
  });

  test("thread outcome: a Fixed in draft whose commit is not on the PR becomes a plain accepted reply and posts; a pushed commit refuses it", async () => {
    const s = await setup();
    const r = await s.plain(0);
    expect(r.status).toBe(200);
    const p = r.body.payload as ReplyPayload;
    expect([r.body.status, r.body.body, p.fix, p.origin]).toEqual(["accepted", "Fixed in c0ffee0.", undefined, "user"]);
    const posted = await s.confirm(1);
    expect(posted.status).toBe(202);
    await s.settle();
    expect(s.posts.bodies).toEqual([{ text: "Fixed in c0ffee0.", parent: { id: THEIRS } }]);
    // A posted draft takes no more actions.
    expect((await s.plain(r.body.revision)).status).toBe(409);
  });

  test("thread outcome: Post as plain reply is refused while the PR holds the commit", async () => {
    const s = await setup();
    await s.push(FIX, [s.fixCommit, ...COMMITS]);
    const r = await s.plain(0);
    expect([r.status, r.body.error]).toEqual([400, "The commit is on the pull request. The draft posts as it is."]);
  });
});
