import type { Database } from "bun:sqlite";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hc } from "hono/client";
import { type AppType, createApp } from "../../src/server/app";
import { dbPath, writeConfig } from "../../src/server/config";
import { createLive, type LiveEvent } from "../../src/server/live";
import { createSecrets } from "../../src/server/secrets";
import { createSettings } from "../../src/server/settings";
import { openDb } from "../../src/server/storage/db";
import type { SyncEngine } from "../../src/server/sync/engine";
import type { ClaimedEvent, FollowState, PrDetail, PrRow } from "../../src/shared/dto";
import { FAKE_TOKEN, FAKE_USER, type FakeBitbucket, fixture, key, startFakeBitbucket } from "../support/fake-bitbucket";
import { DASHBOARD_PATH, PR_PATH } from "../support/scenarios";

process.env.REVIEW_LOOP_SECRETS = "memory";
const root = mkdtempSync(join(tmpdir(), "rl-inbox-"));
process.env.REVIEW_LOOP_DATA_DIR = root;
afterAll(() => rmSync(root, { recursive: true, force: true }));

const PORT = 7317;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SESSION = "s".repeat(64);
const HEADERS = { host: `127.0.0.1:${PORT}`, origin: ORIGIN, "x-rl-session": SESSION };
const ME = FAKE_USER;
const DAY = 86_400_000;

let fake: FakeBitbucket;
beforeEach(() => {
  fake = startFakeBitbucket({ routes: { [key("GET", PR_PATH)]: fixture("pull-request.json") } });
});
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
  fake.stop();
});

let n = 0;
async function setup(me = ME) {
  const dir = join(root, `case-${n++}`);
  writeConfig(dir, { baseUrl: fake.url, userSlug: me, notifications: true });
  const secrets = createSecrets(null);
  await secrets.set(FAKE_TOKEN);
  const settings = createSettings({ dir, secrets });
  const sent: [LiveEvent, unknown][] = [];
  const live = { ...createLive(), broadcast: (e: LiveEvent, d: unknown) => void sent.push([e, d]) };
  const syncs = { count: 0 };
  const sync = {
    start() {},
    stop() {},
    async syncNow() {
      syncs.count++;
    },
    status: () => ({ running: false, state: "ok", lastCompleteAt: 5, nextAt: null, error: null }),
  } satisfies SyncEngine;
  const app = createApp({ port: PORT, token: SESSION, live, settings, sync });
  const db = settings.db() as Database;
  cleanup.push(() => db.close());

  const call = (path: string, init: { method?: string; body?: unknown } = {}) =>
    app.request(`${ORIGIN}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { ...HEADERS, "content-type": "application/json" },
      body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
    });
  const json = async <T>(path: string, init?: { method?: string; body?: unknown }) => {
    const res = await call(path, init);
    return { status: res.status, body: (await res.json()) as T };
  };

  let nextPr = 1;
  const pr = (o: Record<string, string | number | null> = {}) =>
    (
      db
        .query(
          `INSERT INTO pull_request (project, repo, pr_id, title, author_slug, author_name, my_role, my_status, last_reviewed_commit, state,
            source_head, updated_date, on_dashboard, followed, archived_at)
          VALUES ($project, $repo, $pr_id, $title, $author_slug, $author_name, $my_role, $my_status, $last_reviewed_commit, $state,
            $source_head, $updated_date, $on_dashboard, $followed, $archived_at) RETURNING id`,
        )
        .get({
          project: "PROJ1",
          repo: "repo",
          pr_id: nextPr++,
          title: "A change",
          author_slug: "other",
          author_name: "Other Person",
          my_role: "REVIEWER",
          my_status: "UNAPPROVED",
          last_reviewed_commit: null,
          state: "OPEN",
          source_head: "head1",
          updated_date: 1000,
          on_dashboard: 1,
          followed: 1,
          archived_at: null,
          ...o,
        }) as { id: number }
    ).id;
  const comment = (prId: number, id: number, o: Record<string, string | number | null> = {}) =>
    db
      .query(
        `INSERT INTO comment (pr, comment_id, version, root_id, author_slug, text, created_at, updated_at, ack_version, tombstoned_at)
        VALUES ($pr, $id, $version, $root_id, $author_slug, $text, $created_at, $updated_at, $ack_version, $tombstoned_at)`,
      )
      .run({
        pr: prId,
        id,
        version: 0,
        root_id: id,
        author_slug: "other",
        text: `Comment ${id}`,
        created_at: 2000,
        updated_at: 2000,
        ack_version: null,
        tombstoned_at: null,
        ...o,
      });
  const ack = (prId: number, id: number) =>
    (
      db.query("SELECT ack_version FROM comment WHERE pr = $pr AND comment_id = $id").get({ pr: prId, id }) as {
        ack_version: number | null;
      }
    ).ack_version;
  const rows = async () => (await json<PrRow[]>("/api/prs")).body;
  const row = async (id: number) => (await rows()).find((r) => r.id === id);

  return { dir, settings, app, db, sent, syncs, call, json, pr, comment, ack, rows, row };
}

describe("POST /api/read (A2)", () => {
  test("an ack for version 0 leaves a version-1 comment unread", async () => {
    const h = await setup();
    const p = h.pr();
    h.comment(p, 10, { version: 1 });
    expect((await h.call("/api/read", { body: { pr: p, items: [{ id: 10, version: 0 }] } })).status).toBe(200);
    expect(h.ack(p, 10)).toBe(0);
    expect((await h.row(p))?.unread).toBe(1);
  });

  test("a comment absent from the payload stays unread", async () => {
    const h = await setup();
    const p = h.pr();
    h.comment(p, 10);
    h.comment(p, 11);
    await h.call("/api/read", { body: { pr: p, items: [{ id: 10, version: 0 }] } });
    expect(h.ack(p, 10)).toBe(0);
    expect(h.ack(p, 11)).toBeNull();
    expect((await h.row(p))?.unread).toBe(1);
  });

  test("an older ack after a newer one changes nothing", async () => {
    const h = await setup();
    const p = h.pr();
    h.comment(p, 10, { version: 2 });
    await h.call("/api/read", { body: { pr: p, items: [{ id: 10, version: 2 }] } });
    await h.call("/api/read", { body: { pr: p, items: [{ id: 10, version: 1 }] } });
    expect(h.ack(p, 10)).toBe(2);
    expect((await h.row(p))?.unread).toBe(0);
  });

  test("an ack above the stored version stops at the stored version", async () => {
    const h = await setup();
    const p = h.pr();
    h.comment(p, 10, { version: 1 });
    await h.call("/api/read", { body: { pr: p, items: [{ id: 10, version: 9 }] } });
    expect(h.ack(p, 10)).toBe(1);
    h.db.query("UPDATE comment SET version = 2 WHERE pr = $pr AND comment_id = 10").run({ pr: p });
    expect((await h.row(p))?.unread).toBe(1);
  });

  test("a read broadcasts changed", async () => {
    const h = await setup();
    const p = h.pr();
    h.comment(p, 10);
    await h.call("/api/read", { body: { pr: p, items: [{ id: 10, version: 0 }] } });
    expect(h.sent).toEqual([["changed", { prs: [p] }]]);
  });

  test("a bad payload gives 400", async () => {
    const h = await setup();
    for (const body of ["{", { pr: "1", items: [] }, { pr: 1, items: [{ id: 1, version: -1 }] }, { pr: 1 }]) {
      expect((await h.call("/api/read", { body })).status).toBe(400);
    }
    expect(h.sent).toEqual([]);
  });

  test("a read without the session token gives 403", async () => {
    const h = await setup();
    const res = await h.app.request(`${ORIGIN}/api/read`, {
      method: "POST",
      headers: { host: HEADERS.host, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ pr: 1, items: [] }),
    });
    expect(res.status).toBe(403);
  });
});

describe("reviewers", () => {
  test("rows give the stored reviewers, and an empty list before the first write", async () => {
    const h = await setup();
    const fresh = h.pr();
    const synced = h.pr();
    const kenji = { slug: "kito", name: "Kenji Ito", status: "APPROVED" };
    const list = [kenji];
    h.db.query("UPDATE pull_request SET reviewers_json = $j WHERE id = $id").run({ j: JSON.stringify(list), id: synced });
    expect((await h.row(fresh))?.reviewers).toEqual([]);
    expect((await h.row(synced))?.reviewers).toEqual([{ ...kenji, login: null }]);
    const withLogin = [{ ...kenji, login: "KIto" }];
    h.db.query("UPDATE pull_request SET reviewers_json = $j WHERE id = $id").run({ j: JSON.stringify(withLogin), id: synced });
    expect((await h.row(synced))?.reviewers).toEqual(withLogin);
  });
});

describe("POST /api/notifications/claim (A14)", () => {
  test("two concurrent claims return each event once", async () => {
    const h = await setup();
    const p = h.pr();
    for (const ref of ["1", "2", "3"]) {
      h.db.query("INSERT INTO event (pr, kind, ref, created_at) VALUES ($pr, 'comment_new', $ref, 1)").run({ pr: p, ref });
    }
    const [a, b] = await Promise.all([
      h.json<ClaimedEvent[]>("/api/notifications/claim", { method: "POST" }),
      h.json<ClaimedEvent[]>("/api/notifications/claim", { method: "POST" }),
    ]);
    const all = [...(a?.body ?? []), ...(b?.body ?? [])];
    expect(all.map((e) => e.ref).sort()).toEqual(["1", "2", "3"]);
    expect(all[0]).toMatchObject({ pr: p, kind: "comment_new", project: "PROJ1", repo: "repo", title: "A change", digest: false });
    expect((await h.json<ClaimedEvent[]>("/api/notifications/claim", { method: "POST" })).body).toEqual([]);
  });

  test("events of archived or unfollowed PRs are claimed but not returned", async () => {
    const h = await setup();
    const shown = h.pr();
    const unfollowed = h.pr({ followed: 0 });
    const archived = h.pr({ archived_at: 5 });
    const ins = h.db.query("INSERT INTO event (pr, kind, ref, created_at) VALUES ($pr, 'comment_new', $ref, 1)");
    for (const pr of [shown, unfollowed, archived]) ins.run({ pr, ref: String(pr) });
    const res = await h.json<ClaimedEvent[]>("/api/notifications/claim", { method: "POST" });
    expect(res.body.map((e) => e.pr)).toEqual([shown]);
    expect(h.db.query("SELECT COUNT(*) AS n FROM event WHERE claimed_at IS NULL").get()).toEqual({ n: 0 });
  });

  test("claimed events older than 30 days are deleted when the inbox first opens the database", async () => {
    const h = await setup();
    const p = h.pr();
    const ins = h.db.query("INSERT INTO event (pr, kind, ref, created_at, claimed_at) VALUES ($pr, 'comment_new', $ref, 1, $claimed)");
    ins.run({ pr: p, ref: "old", claimed: Date.now() - 31 * DAY });
    ins.run({ pr: p, ref: "recent", claimed: Date.now() - DAY });
    ins.run({ pr: p, ref: "open", claimed: null });
    await h.rows();
    const refs = (h.db.query("SELECT ref FROM event ORDER BY ref").all() as { ref: string }[]).map((r) => r.ref);
    expect(refs).toEqual(["open", "recent"]);
  });
});

describe("follow, unfollow, archive", () => {
  test("follow, unfollow, and archive twice give the same state", async () => {
    const h = await setup();
    const p = h.pr({ followed: 0 });
    const state = async (path: string, body: unknown) => {
      const first = await h.json<FollowState>(`/api/prs/${p}/${path}`, { body });
      const second = await h.json<FollowState>(`/api/prs/${p}/${path}`, { body });
      expect(first.status).toBe(200);
      expect(second.body).toEqual(first.body);
      return first.body;
    };
    expect(await state("follow", { followed: true })).toEqual({ id: p, followed: true, archivedAt: null });
    expect(await state("follow", { followed: false })).toEqual({ id: p, followed: false, archivedAt: null });
    const archived = await state("archive", { archived: true });
    expect(archived.archivedAt).toBeNumber();
    expect(await h.row(p)).toBeUndefined();
    expect(await state("archive", { archived: false })).toEqual({ id: p, followed: false, archivedAt: null });
    expect(h.sent.every(([e, d]) => e === "changed" && JSON.stringify(d) === JSON.stringify({ prs: [p] }))).toBe(true);
    expect(h.sent.length).toBe(8);
  });

  test("follow clears archived_at and starts a sync", async () => {
    const h = await setup();
    const p = h.pr({ followed: 0, archived_at: 5 });
    expect((await h.json<FollowState>(`/api/prs/${p}/follow`, { body: { followed: true } })).body).toEqual({
      id: p,
      followed: true,
      archivedAt: null,
    });
    expect(h.syncs.count).toBe(1);
  });

  test("an unknown PR gives 404 and a bad payload gives 400", async () => {
    const h = await setup();
    expect((await h.call("/api/prs/999/follow", { body: { followed: true } })).status).toBe(404);
    expect((await h.call("/api/prs/999/archive", { body: { archived: true } })).status).toBe(404);
    expect((await h.call("/api/prs/abc/follow", { body: { followed: true } })).status).toBe(400);
    expect((await h.call("/api/prs/1/follow", { body: { followed: "yes" } })).status).toBe(400);
    expect((await h.call("/api/prs/1/archive", { body: {} })).status).toBe(400);
  });
});

describe("POST /api/follow (by URL)", () => {
  test("a foreign origin gives 400 and sends no request", async () => {
    const h = await setup();
    const res = await h.call("/api/follow", { body: { url: "https://other.example/projects/P/repos/r/pull-requests/1" } });
    expect(res.status).toBe(400);
    expect(fake.requests).toEqual([]);
    expect(h.syncs.count).toBe(0);
  });

  test("a bad payload gives 400", async () => {
    const h = await setup();
    expect((await h.call("/api/follow", { body: { url: "" } })).status).toBe(400);
    expect((await h.call("/api/follow", { body: { url: `${fake.url}/not/a/pr` } })).status).toBe(400);
    expect(fake.requests).toEqual([]);
  });

  test("a valid URL inserts the PR with the key from the response and starts a sync", async () => {
    const h = await setup();
    const res = await h.json<FollowState>("/api/follow", {
      body: { url: `${fake.url}/users/jdoe/repos/sample-repo-1/pull-requests/2/overview` },
    });
    expect(res.status).toBe(200);
    expect(fake.requests).toEqual([`GET ${PR_PATH}`]);
    expect(h.syncs.count).toBe(1);
    const stored = h.db.query("SELECT project, repo, pr_id, followed, archived_at, initialized_at FROM pull_request WHERE id = $id").get({
      id: res.body.id,
    });
    expect(stored).toEqual({ project: "~JDOE", repo: "sample-repo-1", pr_id: 2, followed: 1, archived_at: null, initialized_at: null });
    expect(h.sent).toEqual([["changed", { prs: [res.body.id] }]]);
  });

  test("an existing archived row is followed again", async () => {
    const h = await setup();
    const p = h.pr({ project: "~JDOE", repo: "sample-repo-1", pr_id: 2, followed: 0, archived_at: 5 });
    const res = await h.json<FollowState>("/api/follow", { body: { url: `${fake.url}/users/jdoe/repos/sample-repo-1/pull-requests/2` } });
    expect(res.body).toEqual({ id: p, followed: true, archivedAt: null });
  });

  test("a settings change to another origin during the PR request gives 409 and writes no row", async () => {
    const h = await setup();
    fake.routes[key("GET", PR_PATH)] = { ...fixture<object>("pull-request.json"), delayMs: 300 };
    const other = startFakeBitbucket({ routes: { [key("GET", DASHBOARD_PATH)]: fixture("dashboard-pull-requests-page.json") } });
    cleanup.push(() => other.stop());
    const follow = h.call("/api/follow", { body: { url: `${fake.url}/users/jdoe/repos/sample-repo-1/pull-requests/2` } });
    for (const end = Date.now() + 2000; fake.inFlight !== 1; await Bun.sleep(5)) if (Date.now() > end) throw new Error("timed out");
    expect((await h.call("/api/settings", { method: "PUT", body: { baseUrl: other.url, token: FAKE_TOKEN } })).status).toBe(200);
    expect((await follow).status).toBe(409);
    const next = h.settings.db() as Database;
    cleanup.push(() => next.close());
    const old = openDb(dbPath(h.dir, fake.url));
    cleanup.push(() => old.close());
    for (const db of [old, next]) expect(db.query("SELECT COUNT(*) AS n FROM pull_request").get()).toEqual({ n: 0 });
    expect(h.syncs.count).toBe(0);
  });

  test("a PR that Bitbucket does not know gives 404", async () => {
    const h = await setup();
    expect((await h.call("/api/follow", { body: { url: `${fake.url}/projects/P/repos/r/pull-requests/7` } })).status).toBe(404);
    expect(h.syncs.count).toBe(0);
  });
});

describe("GET /api/prs and /api/prs/:id", () => {
  test("rows carry reasons, unread counts, and follow state", async () => {
    const h = await setup();
    const requested = h.pr();
    const newCommits = h.pr({ last_reviewed_commit: "head0", my_status: "NEEDS_WORK" });
    const approved = h.pr({ my_status: "APPROVED", last_reviewed_commit: "head1" });
    const mine = h.pr({ my_role: "AUTHOR", my_status: null, author_slug: ME });
    const unfollowed = h.pr({ followed: 0 });
    const offDashboard = h.pr({ on_dashboard: 0, followed: 0 });
    const archived = h.pr({ archived_at: 5 });
    // A thread that holds my comment, with an unread reply by another user.
    h.comment(mine, 1, { author_slug: ME, ack_version: 0 });
    h.comment(mine, 2, { root_id: 1, updated_at: 9000 });
    // An unread comment in a thread without my comment.
    h.comment(approved, 3);
    // Deleted (D8): never unread.
    h.comment(approved, 4, { tombstoned_at: 1 });
    h.comment(unfollowed, 5);

    const list = await h.rows();
    expect(list.map((r) => r.id).sort()).toEqual([requested, newCommits, approved, mine, unfollowed].sort());
    expect(list.find((r) => r.id === offDashboard || r.id === archived)).toBeUndefined();
    const by = (id: number) => list.find((r) => r.id === id) as PrRow;
    expect(by(requested).reasons).toEqual(["review_requested"]);
    expect(by(newCommits).reasons).toEqual(["new_commits"]);
    expect(by(approved)).toMatchObject({ reasons: [], unread: 1 });
    expect(by(mine)).toMatchObject({ reasons: ["reply_to_you"], unread: 1, lastActivity: 9000, role: "AUTHOR" });
    expect(by(unfollowed)).toMatchObject({ followed: false, unread: 0, reasons: ["review_requested"] });
    // Unread first, then the newest activity.
    expect(list[0]?.id).toBe(mine);
    expect(list[1]?.id).toBe(approved);
  });

  test("a merged PR with unread replies stays listed and unread (A15)", async () => {
    const h = await setup();
    const p = h.pr({ state: "MERGED", on_dashboard: 0 });
    h.comment(p, 1, { author_slug: ME, ack_version: 0 });
    h.comment(p, 2, { root_id: 1 });
    h.comment(p, 3, { root_id: 1 });
    expect(await h.row(p)).toMatchObject({ state: "MERGED", unread: 2, reasons: ["reply_to_you", "closed"], followed: true });
  });

  test("the detail gives comments with unread flags, deleted comments without text, and the checkpoint", async () => {
    const h = await setup();
    const p = h.pr();
    h.comment(p, 1, { ack_version: 0 });
    h.comment(p, 2, { version: 1, ack_version: 0 });
    h.comment(p, 3, { tombstoned_at: 1 });
    h.db.query("UPDATE comment SET author_login = 'Other' WHERE comment_id = 1").run();
    h.db
      .query(
        "INSERT INTO sync_checkpoint (scope, last_complete_at, incomplete_reason, last_error, updated_at) VALUES ($s, 7, 'gap', 'x', 8)",
      )
      .run({ s: `pr:${p}` });
    const { status, body } = await h.json<PrDetail>(`/api/prs/${p}`);
    expect(status).toBe(200);
    expect(body.pr.checkpoint).toEqual({ lastCompleteAt: 7, reason: "gap", error: "x" });
    expect(body.comments.map((c) => [c.id, c.unread, c.deleted, c.text])).toEqual([
      [1, false, false, "Comment 1"],
      [2, true, false, "Comment 2"],
      [3, false, true, null],
    ]);
    expect(body.comments.map((c) => c.authorLogin)).toEqual(["Other", null, null]);
    expect((await h.call("/api/prs/999")).status).toBe(404);
  });

  test("GET /api/status gives the sync state and the dashboard checkpoint", async () => {
    const h = await setup();
    h.db
      .query(
        "INSERT INTO sync_checkpoint (scope, last_complete_at, incomplete_reason, last_error, updated_at) VALUES ('dashboard', 3, 'server', 'HTTP 503', 4)",
      )
      .run();
    expect((await h.json("/api/status")).body).toEqual({
      sync: { running: false, state: "ok", lastCompleteAt: 5, nextAt: null, error: null },
      dashboard: { lastCompleteAt: 3, reason: "server", error: "HTTP 503" },
    });
  });

  test("the endpoints are typed through AppType", async () => {
    const h = await setup();
    const p = h.pr();
    h.comment(p, 1);
    const client = hc<AppType>(ORIGIN, {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => h.app.request(input, init),
      headers: HEADERS,
    });
    const list = await (await client.api.prs.$get()).json();
    const unread: number = list[0]?.unread ?? -1;
    expect(unread).toBe(1);
    const read = await client.api.read.$post({ json: { pr: p, items: [{ id: 1, version: 0 }] } });
    expect(read.status).toBe(200);
    const detail = await client.api.prs[":id"].$get({ param: { id: String(p) } });
    if (detail.status !== 200) throw new Error(`status ${detail.status}`);
    const body = await detail.json();
    const flag: boolean | undefined = body.comments[0]?.unread;
    expect(flag).toBe(false);
  });
});
