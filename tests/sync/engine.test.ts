import type { Database } from "bun:sqlite";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/server/app";
import { writeConfig } from "../../src/server/config";
import { listPrs } from "../../src/server/inbox/queries";
import { createLive, type LiveEvent } from "../../src/server/live";
import { createSecrets } from "../../src/server/secrets";
import { createSettings, type Settings } from "../../src/server/settings";
import { createSyncEngine, type Timers } from "../../src/server/sync/engine";
import { FAKE_TOKEN, FAKE_USER, type FakeBitbucket, fixture, key, type Reply, startFakeBitbucket } from "../support/fake-bitbucket";
import {
  ACTIVITIES_PATH,
  type Activity,
  activities,
  addReply,
  asUsername,
  byUser,
  clone,
  DASHBOARD_PATH,
  findComment,
  onePage,
  ownPr,
  PR_PATH,
  pageRoutes,
  pages,
  REVIEW_PR_PATH,
  reviewPr,
  secondUser,
  versionZero,
} from "../support/scenarios";

process.env.REVIEW_LOOP_SECRETS = "memory";
const root = mkdtempSync(join(tmpdir(), "rl-sync-"));
process.env.REVIEW_LOOP_DATA_DIR = root;
afterAll(() => rmSync(root, { recursive: true, force: true }));

const OTHER = secondUser();
const REVIEW_ACTIVITIES = `${REVIEW_PR_PATH}/activities`;
const inline = () => activities("activities-inline-anchored.json");
const ME = findComment(inline(), 1000003).author;

// The server state that the fake replays. Tests change it between cycles.
let world: { reviewer: unknown[]; author: unknown[]; own: Activity[]; review: Activity[] };
let fake: FakeBitbucket;
const page = (values: unknown[]): Reply => ({ status: 200, body: onePage(values) });
const role = (req: Request) => new URL(req.url).searchParams.get("role");
const dashboard = (req: Request) => page(role(req) === "AUTHOR" ? world.author : world.reviewer);

beforeEach(() => {
  const empty = activities("activities-opened-only.json");
  world = { reviewer: [], author: [ownPr()], own: empty, review: clone(empty) };
  fake = startFakeBitbucket({
    routes: {
      [key("GET", DASHBOARD_PATH)]: dashboard,
      [key("GET", ACTIVITIES_PATH)]: () => page(world.own),
      [key("GET", REVIEW_ACTIVITIES)]: () => page(world.review),
    },
  });
});

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
  fake.stop();
});

function fakeTimers() {
  const pending = new Map<number, { fn: () => unknown; ms: number }>();
  const delays: number[] = [];
  let last = 0;
  const timers: Timers = {
    set(fn, ms) {
      pending.set(++last, { fn, ms });
      delays.push(ms);
      return last;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
  };
  return {
    ...timers,
    pending,
    delays,
    // Runs the single pending timer and waits for its cycle.
    async fire() {
      const [entry, ...rest] = [...pending];
      if (!entry || rest.length) throw new Error(`expected one pending timer, got ${pending.size}`);
      pending.delete(entry[0]);
      await entry[1].fn();
    },
  };
}

async function until(check: () => boolean) {
  for (const end = Date.now() + 2000; !check(); await Bun.sleep(5)) if (Date.now() > end) throw new Error("timed out");
}

type CommentRow = {
  comment_id: number;
  version: number;
  parent_id: number | null;
  root_id: number;
  text: string;
  ack_version: number | null;
  anchor_json: string | null;
  thread_resolved: number;
};
type Checkpoint = { last_complete_at: number | null; incomplete_reason: string | null; last_error: string | null };

let n = 0;
// token: false is a memory-mode restart: config.json exists, but the token is gone.
async function setup(dir = join(root, `case-${n++}`), opts: { token?: boolean; caFile?: string; user?: string } = {}) {
  writeConfig(dir, { baseUrl: fake.url, userSlug: opts.user ?? FAKE_USER, notifications: false, caFile: opts.caFile });
  const secrets = createSecrets(null);
  if (opts.token !== false) await secrets.set(FAKE_TOKEN);
  const settings = createSettings({ dir, secrets });
  const sent: [LiveEvent, unknown][] = [];
  const live = { ...createLive(), broadcast: (e: LiveEvent, d: unknown) => void sent.push([e, d]) };
  const timers = fakeTimers();
  const clock = { t: 1_000_000 };
  const random = { value: 0.5 };
  const engine = createSyncEngine({ settings, live, now: () => clock.t, random: () => random.value, timers });
  cleanup.push(() => {
    engine.stop();
    settings.db()?.close();
  });
  const db = () => settings.db() as Database;
  const one = <T>(sql: string, params: Record<string, string | number> = {}) => db().query(sql).get(params) as T;
  return {
    dir,
    settings,
    engine,
    db,
    sent,
    timers,
    clock,
    random,
    // One cycle, one interval after the previous one.
    async cycle() {
      clock.t += 60_000;
      await engine.syncNow();
    },
    unread: () =>
      one<{ n: number }>("SELECT COUNT(*) AS n FROM comment WHERE tombstoned_at IS NULL AND (ack_version IS NULL OR ack_version < version)")
        .n,
    events: () => db().query("SELECT kind, ref, digest FROM event ORDER BY id").all(),
    comment: (id: number) => one<CommentRow & { tombstoned_at: number | null }>("SELECT * FROM comment WHERE comment_id = $id", { id }),
    comments: () => db().query("SELECT comment_id, version FROM comment ORDER BY comment_id").all(),
    pr: (prId: number) => one<Record<string, unknown>>("SELECT * FROM pull_request WHERE pr_id = $prId", { prId }),
    checkpoint: (prId: number) =>
      one<Checkpoint>(
        "SELECT c.last_complete_at, c.incomplete_reason, c.last_error FROM sync_checkpoint c JOIN pull_request p ON c.scope = 'pr:' || p.id WHERE p.pr_id = $prId",
        { prId },
      ),
    dashboardCheckpoint: () =>
      one<Checkpoint>("SELECT last_complete_at, incomplete_reason, last_error FROM sync_checkpoint WHERE scope = 'dashboard'"),
  };
}

const requests = (from: number, part: string) => fake.requests.slice(from).filter((r) => r.includes(part));
const put = (settings: Settings, body: unknown) =>
  settings.routes.request("/", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("first sync and restart (A1)", () => {
  test("the first sync of another user's comments gives 0 unread and 0 events", async () => {
    world.own = byUser(byUser(inline(), 1000003, OTHER), 1000001, OTHER);
    const h = await setup();
    await h.cycle();
    expect(h.comments()).toHaveLength(3);
    expect(h.unread()).toBe(0);
    expect(h.events()).toEqual([]);
    expect(h.pr(2)).toMatchObject({ my_role: "AUTHOR", on_dashboard: 1, followed: 1 });
    expect(h.pr(2).initialized_at).not.toBeNull();
    expect(h.checkpoint(2)).toMatchObject({ incomplete_reason: null, last_error: null });
  });

  test("a new reply by that user gives 1 unread and 1 event, and a new engine keeps that state", async () => {
    const base = byUser(inline(), 1000003, OTHER);
    world.own = base;
    const h = await setup();
    await h.cycle();
    world.own = addReply(base, 1000003, 1000010, OTHER);
    h.sent.length = 0;
    await h.cycle();
    expect(h.unread()).toBe(1);
    expect(h.comment(1000010)).toMatchObject({ parent_id: 1000003, root_id: 1000003, ack_version: null });
    expect(h.events()).toEqual([{ kind: "comment_new", ref: "1000010", digest: 0 }]);
    const id = h.pr(2).id;
    expect(h.sent).toEqual([
      ["changed", { prs: [id] }],
      ["events", { count: 1 }],
    ]);

    h.engine.stop();
    const restarted = await setup(h.dir);
    await restarted.cycle();
    expect(restarted.unread()).toBe(1);
    expect(restarted.events()).toHaveLength(1);
  });
});

describe("duplicates, order, and edits (A3, A4)", () => {
  test("duplicate and reordered activities give one row per comment and one event", async () => {
    const after = byUser(inline(), 1000002, OTHER);
    world.own = [...after, ...versionZero(after, 1000003)].reverse();
    const h = await setup();
    await h.cycle();
    expect(h.comments()).toEqual([
      { comment_id: 1000001, version: 0 },
      { comment_id: 1000002, version: 0 },
      { comment_id: 1000003, version: 1 },
    ]);
    const next = addReply(after, 1000002, 1000011, OTHER);
    world.own = [...next, ...clone(next)].reverse();
    await h.cycle();
    await h.cycle();
    expect(h.comments()).toHaveLength(4);
    expect(h.events()).toEqual([{ kind: "comment_new", ref: "1000011", digest: 0 }]);
  });

  test("an older version after a newer one changes nothing", async () => {
    const after = byUser(activities("activities-after-edit.json"), 1000003, OTHER);
    world.own = after;
    const h = await setup();
    await h.cycle();
    world.own = versionZero(after, 1000003);
    await h.cycle();
    expect(h.comment(1000003)).toMatchObject({ version: 1, text: findComment(after, 1000003).text });
    expect(h.unread()).toBe(0);
  });

  test("an edit from version 0 to 1 updates the text and makes the message unread, with no event", async () => {
    const after = byUser(activities("activities-after-edit.json"), 1000003, OTHER);
    world.own = versionZero(after, 1000003);
    const h = await setup();
    await h.cycle();
    expect(h.unread()).toBe(0);
    world.own = after;
    await h.cycle();
    expect(h.comment(1000003)).toMatchObject({ version: 1, text: findComment(after, 1000003).text, ack_version: 0 });
    expect(h.unread()).toBe(1);
    expect(h.events()).toEqual([]);
  });

  test("own comments and own edits give no unread and no event", async () => {
    world.own = inline();
    const h = await setup();
    await h.cycle();
    const next = addReply(inline(), 1000003, 1000012, ME);
    findComment(next, 1000002).version = 1;
    world.own = next;
    await h.cycle();
    expect(h.comment(1000012)).toMatchObject({ ack_version: 0 });
    expect(h.comment(1000002)).toMatchObject({ version: 1, ack_version: 1 });
    expect(h.unread()).toBe(0);
    expect(h.events()).toEqual([]);
  });
});

describe("metadata outside the version guard", () => {
  const anchor = (c: CommentRow) => JSON.parse(c.anchor_json ?? "null") as { orphaned?: boolean };

  test("same version with orphaned false to true updates anchor_json and leaves the message read", async () => {
    const base = byUser(inline(), 1000002, OTHER);
    world.own = base;
    const h = await setup();
    await h.cycle();
    expect(anchor(h.comment(1000002))).toMatchObject({ orphaned: false });
    const next = clone(base);
    (findComment(next, 1000002).anchor as { orphaned: boolean }).orphaned = true;
    world.own = next;
    await h.cycle();
    expect(h.comment(1000002)).toMatchObject({ version: 0, ack_version: 0 });
    expect(anchor(h.comment(1000002))).toMatchObject({ orphaned: true, path: "sample1.md" });
    expect(h.unread()).toBe(0);
    expect(h.events()).toEqual([]);
  });

  test("same version with thread_resolved false to true updates it with no unread and no event", async () => {
    const base = byUser(inline(), 1000003, OTHER);
    world.own = base;
    const h = await setup();
    await h.cycle();
    expect(h.comment(1000003)).toMatchObject({ thread_resolved: 0 });
    const next = clone(base);
    findComment(next, 1000003).threadResolved = true;
    world.own = next;
    await h.cycle();
    expect(h.comment(1000003)).toMatchObject({ version: 1, ack_version: 1, thread_resolved: 1 });
    expect(h.unread()).toBe(0);
    expect(h.events()).toEqual([]);
  });

  test("an older version never rolls metadata back", async () => {
    const newer = byUser(inline(), 1000002, OTHER);
    const c = findComment(newer, 1000002);
    c.version = 2;
    c.threadResolved = true;
    (c.anchor as { orphaned: boolean }).orphaned = true;
    world.own = newer;
    const h = await setup();
    await h.cycle();
    world.own = byUser(inline(), 1000002, OTHER);
    await h.cycle();
    expect(h.comment(1000002)).toMatchObject({ version: 2, thread_resolved: 1 });
    expect(anchor(h.comment(1000002))).toMatchObject({ orphaned: true });
  });
});

describe("deletes (A4)", () => {
  const IDS = [1000001, 1000002, 1000003];
  // Imports three comments, then serves the recorded state after all deletes with `reply` for each comment GET.
  async function afterDelete(reply: Reply) {
    world.own = inline();
    const h = await setup();
    await h.cycle();
    world.own = activities("activities-after-delete.json");
    for (const id of IDS) fake.routes[key("GET", `${PR_PATH}/comments/${id}`)] = reply;
    await h.cycle();
    return h;
  }

  test("absent plus 404 tombstones", async () => {
    const h = await afterDelete(fixture("comment-get-after-delete-404.json"));
    for (const id of IDS) expect(h.comment(id).tombstoned_at).not.toBeNull();
    expect(h.checkpoint(2)).toMatchObject({ incomplete_reason: null, last_error: null });
  });

  test("absent plus 200 keeps the comment and records a gap", async () => {
    const h = await afterDelete(fixture("comment-with-nested-reply.json"));
    for (const id of IDS) expect(h.comment(id).tombstoned_at).toBeNull();
    expect(h.checkpoint(2)).toMatchObject({ incomplete_reason: "gap", last_error: expect.stringContaining("1000002") });
  });

  test("absent plus a network error keeps the comment for the next cycle", async () => {
    const h = await afterDelete({ drop: true });
    for (const id of IDS) expect(h.comment(id).tombstoned_at).toBeNull();
    expect(h.checkpoint(2)).toMatchObject({ incomplete_reason: "network" });
    for (const id of IDS) fake.routes[key("GET", `${PR_PATH}/comments/${id}`)] = fixture("comment-get-after-delete-404.json");
    await h.cycle();
    for (const id of IDS) expect(h.comment(id).tombstoned_at).not.toBeNull();
  });

  test("absent plus 403 or 500 keeps the comment", async () => {
    for (const status of [403, 500]) {
      const h = await afterDelete({ status, body: {} });
      for (const id of IDS) expect(h.comment(id).tombstoned_at).toBeNull();
    }
  });

  test("a settings change during the delete checks sends no further check with the old token", async () => {
    world.own = inline();
    const h = await setup();
    await h.cycle();
    world.own = activities("activities-after-delete.json");
    let checks = 0;
    const check = (): Reply => (checks++ ? fixture("comment-get-after-delete-404.json") : { hang: true });
    for (const id of IDS) fake.routes[key("GET", `${PR_PATH}/comments/${id}`)] = check;
    const other = startFakeBitbucket({ routes: { [key("GET", DASHBOARD_PATH)]: page([]) } });
    const from = fake.requests.length;
    try {
      const running = h.engine.syncNow();
      await until(() => requests(from, "/comments/").length === 1);
      expect((await put(h.settings, { baseUrl: other.url, token: FAKE_TOKEN })).status).toBe(200);
      fake.release();
      await running;
    } finally {
      other.stop();
    }
    expect(requests(from, "/comments/")).toHaveLength(1);
  });

  test("a comment that is still present gets no delete check", async () => {
    world.own = inline();
    const h = await setup();
    await h.cycle();
    const from = fake.requests.length;
    await h.cycle();
    expect(requests(from, "/comments/")).toEqual([]);
  });
});

describe("partial data (A5, A6)", () => {
  test("a failure on page 2 changes no data and tombstones nothing; the next cycle completes", async () => {
    const base = byUser(inline(), 1000003, OTHER);
    world.own = base;
    const h = await setup();
    await h.cycle();
    const done = h.checkpoint(2).last_complete_at;
    const edited = clone(base);
    findComment(edited, 1000003).version = 2;
    // Page 1 holds the edit. Comment 1000002 is on the failing page 2.
    const order = [edited[1], edited[2], edited[0]] as Activity[];
    Object.assign(fake.routes, pageRoutes(ACTIVITIES_PATH, pages(order, [2, 1], "absent")));
    fake.routes[key("GET", ACTIVITIES_PATH, 2)] = { status: 500, body: {} };
    const from = fake.requests.length;
    await h.cycle();
    expect(h.comment(1000003)).toMatchObject({ version: 1 });
    expect(h.comment(1000002).tombstoned_at).toBeNull();
    expect(requests(from, "/comments/")).toEqual([]);
    expect(h.checkpoint(2)).toMatchObject({
      last_complete_at: done,
      incomplete_reason: "server",
      last_error: expect.stringContaining("500"),
    });

    Object.assign(fake.routes, pageRoutes(ACTIVITIES_PATH, pages(order, [2, 1], "absent")));
    await h.cycle();
    expect(h.comment(1000003)).toMatchObject({ version: 2 });
    expect(h.unread()).toBe(1);
    expect(h.checkpoint(2)).toMatchObject({ incomplete_reason: null, last_error: null });
    expect(h.checkpoint(2).last_complete_at).toBeGreaterThan(done ?? 0);
  });

  for (const last of ["absent", "null"] as const) {
    test(`multi-page threads keep every message (last page ${last})`, async () => {
      Object.assign(fake.routes, pageRoutes(ACTIVITIES_PATH, pages(inline(), [1, 1, 1], last)));
      const h = await setup();
      await h.cycle();
      expect(h.comments().map((c) => (c as CommentRow).comment_id)).toEqual([1000001, 1000002, 1000003]);
      expect(h.comment(1000001)).toMatchObject({ parent_id: 1000003, root_id: 1000003 });
      expect(h.checkpoint(2)).toMatchObject({ incomplete_reason: null });
    });
  }

  test("an incomplete dashboard keeps roles, states, and dashboard flags", async () => {
    world.reviewer = [reviewPr()];
    const h = await setup();
    await h.cycle();
    expect(h.pr(1001)).toMatchObject({ my_role: "REVIEWER", my_status: "UNAPPROVED", on_dashboard: 1 });
    world.reviewer = [];
    fake.routes[key("GET", DASHBOARD_PATH)] = (req) => (role(req) === "AUTHOR" ? { status: 500, body: {} } : dashboard(req));
    const from = fake.requests.length;
    await h.cycle();
    expect(h.pr(1001)).toMatchObject({ my_role: "REVIEWER", on_dashboard: 1 });
    expect(h.pr(2)).toMatchObject({ on_dashboard: 1 });
    expect(h.dashboardCheckpoint()).toMatchObject({ incomplete_reason: "server" });
    expect(fake.requests.slice(from).filter((r) => r === `GET ${REVIEW_PR_PATH}`)).toEqual([]);
    expect(requests(from, "/activities")).toHaveLength(2);
  });
});

describe("follow state (A15)", () => {
  test("a PR that leaves the dashboard as MERGED stays followed and keeps its unread messages", async () => {
    const base = byUser(inline(), 1000003, OTHER);
    world.own = base;
    const h = await setup();
    await h.cycle();
    world.own = addReply(base, 1000003, 1000010, OTHER);
    await h.cycle();
    expect(h.unread()).toBe(1);
    world.author = [];
    const merged = ownPr();
    merged.state = "MERGED";
    fake.routes[key("GET", PR_PATH)] = { status: 200, body: merged };
    const from = fake.requests.length;
    await h.cycle();
    expect(h.pr(2)).toMatchObject({ state: "MERGED", followed: 1, on_dashboard: 0, my_role: "AUTHOR" });
    expect(h.unread()).toBe(1);
    expect(requests(from, "/activities")).toHaveLength(1);
  });

  test("a 404 on the single-PR GET sets a reason for that PR only", async () => {
    world.reviewer = [reviewPr()];
    const h = await setup();
    await h.cycle();
    world.author = [];
    await h.cycle();
    expect(h.checkpoint(2)).toMatchObject({ incomplete_reason: "not_found" });
    expect(h.pr(2)).toMatchObject({ state: "OPEN", followed: 1 });
    expect(h.checkpoint(1001)).toMatchObject({ incomplete_reason: null });
    expect(h.engine.status().state).toBe("ok");
  });

  test("unfollow clears initialized_at and stops polling; a later follow imports silently", async () => {
    const base = byUser(inline(), 1000003, OTHER);
    world.own = base;
    const h = await setup();
    await h.cycle();
    h.db().query("UPDATE pull_request SET followed = 0 WHERE pr_id = 2").run();
    world.own = addReply(base, 1000003, 1000010, OTHER);
    const from = fake.requests.length;
    await h.cycle();
    expect(requests(from, "/activities")).toEqual([]);
    expect(h.pr(2).initialized_at).toBeNull();
    h.db().query("UPDATE pull_request SET followed = 1 WHERE pr_id = 2").run();
    await h.cycle();
    expect(h.comment(1000010)).toMatchObject({ ack_version: 0 });
    expect(h.unread()).toBe(0);
    expect(h.events()).toEqual([]);
  });

  test("archive stops activity polling", async () => {
    const h = await setup();
    await h.cycle();
    h.db().query("UPDATE pull_request SET archived_at = 1 WHERE pr_id = 2").run();
    const from = fake.requests.length;
    await h.cycle();
    expect(requests(from, "/activities")).toEqual([]);
    expect(h.pr(2).initialized_at).toBeNull();
  });
});

describe("reviewers", () => {
  const reviewers = (h: Awaited<ReturnType<typeof setup>>) => JSON.parse(String(h.pr(1001).reviewers_json));

  test("the first sync stores every reviewer", async () => {
    world.reviewer = [reviewPr()];
    const h = await setup();
    await h.cycle();
    expect(reviewers(h)).toEqual([
      { slug: "jdoe", name: "Jane Doe", status: "UNAPPROVED", lastReviewedCommit: "c5bf8bfcb823b4949bc9bfe280c5ffc3ffd0a151" },
    ]);
  });

  test("a status change updates the reviewers and gives no unread and no event", async () => {
    world.reviewer = [reviewPr()];
    const h = await setup();
    await h.cycle();
    const changed = reviewPr() as ReturnType<typeof reviewPr> & { reviewers: Record<string, unknown>[] };
    changed.reviewers = [
      { ...changed.reviewers[0], status: "NEEDS_WORK" },
      { user: OTHER, role: "REVIEWER", approved: true, status: "APPROVED" },
    ];
    world.reviewer = [changed];
    await h.cycle();
    expect(reviewers(h).map((r: { slug: string; status: string }) => [r.slug, r.status])).toEqual([
      ["jdoe", "NEEDS_WORK"],
      [OTHER.slug, "APPROVED"],
    ]);
    expect(h.events()).toEqual([]);
    expect(h.unread()).toBe(0);
  });
});

describe("events", () => {
  test("reviewer_added appears after the first complete dashboard only", async () => {
    world.reviewer = [reviewPr()];
    const first = await setup();
    await first.cycle();
    expect(first.events()).toEqual([]);

    world.reviewer = [];
    const h = await setup();
    await h.cycle();
    world.reviewer = [reviewPr()];
    await h.cycle();
    await h.cycle();
    expect(h.events()).toEqual([{ kind: "reviewer_added", ref: "4", digest: 0 }]);
  });

  test("commits_pushed appears when the source head of a reviewed PR changes", async () => {
    world.reviewer = [reviewPr()];
    const h = await setup();
    await h.cycle();
    const pushed = reviewPr();
    pushed.fromRef.latestCommit = "f".repeat(40);
    world.reviewer = [pushed];
    await h.cycle();
    expect(h.events()).toEqual([{ kind: "commits_pushed", ref: "f".repeat(40), digest: 0 }]);
    expect(h.pr(1001)).toMatchObject({ source_head: "f".repeat(40) });
  });

  test("on a reviewed PR a new comment notifies only in a thread that holds my comment", async () => {
    world.reviewer = [reviewPr()];
    const base = byUser(inline(), 1000003, OTHER);
    world.review = base;
    const h = await setup();
    await h.cycle();
    const root = { ...clone(findComment(base, 1000003)), id: 1000021, comments: [] };
    world.review = [
      ...addReply(base, 1000003, 1000020, OTHER),
      { id: 10000050, action: "COMMENTED", commentAction: "ADDED", comment: root },
    ];
    await h.cycle();
    expect(h.events()).toEqual([{ kind: "comment_new", ref: "1000020", digest: 0 }]);
    expect(h.unread()).toBe(2);
  });
});

describe("current user by username (synthetic)", () => {
  // X-AUSERNAME carries the username JDoe. The user objects carry name JDoe and slug jdoe.
  const NAME = "JDoe";
  const mine = <T>(v: T) => asUsername(v, FAKE_USER, NAME);

  test("role, own comments, events, and reply_to_you match the username and the slug", async () => {
    fake.user = NAME;
    world.author = [mine(ownPr())];
    world.reviewer = [mine(reviewPr())];
    const base = mine(inline());
    world.own = base;
    const h = await setup(undefined, { user: NAME });
    await h.cycle();
    expect(h.pr(2)).toMatchObject({ my_role: "AUTHOR" });
    expect(h.pr(1001)).toMatchObject({ my_role: "REVIEWER", my_status: "UNAPPROVED" });

    world.own = addReply(addReply(base, 1000003, 1000010, findComment(base, 1000003).author), 1000003, 1000011, OTHER);
    await h.cycle();
    expect(h.comment(1000010).ack_version).toBe(0);
    expect(h.unread()).toBe(1);
    expect(h.events()).toEqual([{ kind: "comment_new", ref: "1000011", digest: 0 }]);
    const row = listPrs(h.db(), NAME).find((r) => r.id === h.pr(2).id);
    expect(row?.reasons).toContain("reply_to_you");
  });
});

describe("transaction", () => {
  test("a RAISE(ABORT) on the event insert rolls back the PR transaction", async () => {
    const base = byUser(inline(), 1000003, OTHER);
    world.own = base;
    const h = await setup();
    await h.cycle();
    const comments = h.db().query("SELECT * FROM comment ORDER BY comment_id").all();
    const checkpoint = h.checkpoint(2);
    h.db().exec("CREATE TRIGGER fail_event BEFORE INSERT ON event BEGIN SELECT RAISE(ABORT, 'event insert failed'); END");
    const next = addReply(base, 1000003, 1000010, OTHER);
    findComment(next, 1000003).version = 3;
    world.own = next;
    const quiet = spyOn(console, "log").mockImplementation(() => {});
    try {
      await h.cycle();
    } finally {
      quiet.mockRestore();
    }
    expect(h.db().query("SELECT * FROM comment ORDER BY comment_id").all()).toEqual(comments);
    expect(h.checkpoint(2)).toEqual(checkpoint);
    expect(h.events()).toEqual([]);
    expect(h.engine.status()).toMatchObject({ state: "error", error: expect.stringContaining("event insert failed") });

    h.db().exec("DROP TRIGGER fail_event");
    await h.cycle();
    expect(h.comment(1000003)).toMatchObject({ version: 3 });
    expect(h.events()).toMatchObject([{ kind: "comment_new", ref: "1000010" }]);
  });
});

describe("scheduling", () => {
  test("requests in flight never exceed 2", async () => {
    const ids = [3, 4, 5, 6];
    world.author = [ownPr(), ...ids.map((id) => ({ ...ownPr(), id }))];
    for (const id of ids) {
      fake.routes[key("GET", `${PR_PATH.replace(/\d+$/, String(id))}/activities`)] = { ...page([]), delayMs: 10 } as Reply;
    }
    fake.routes[key("GET", DASHBOARD_PATH)] = (req) => ({ ...dashboard(req), delayMs: 10 }) as Reply;
    const h = await setup();
    await Promise.all([h.engine.syncNow(), h.engine.syncNow(), h.engine.syncNow()]);
    expect(fake.maxInFlight).toBeLessThanOrEqual(2);
    const done = h.db().query("SELECT COUNT(*) AS n FROM sync_checkpoint WHERE last_complete_at IS NOT NULL").get() as { n: number };
    expect(done.n).toBe(6);
  });

  test("syncNow during a cycle runs one more cycle after it", async () => {
    fake.routes[key("GET", DASHBOARD_PATH)] = (req) => ({ ...dashboard(req), delayMs: 20 }) as Reply;
    const h = await setup();
    const first = h.engine.syncNow();
    expect(h.engine.status().running).toBe(true);
    await Promise.all([first, h.engine.syncNow(), h.engine.syncNow()]);
    expect(requests(0, `GET ${DASHBOARD_PATH}`)).toHaveLength(4);
    expect(h.engine.status().running).toBe(false);
  });

  test("the next cycle waits 60 s times a factor from 0.9 to 1.1", async () => {
    const h = await setup();
    h.random.value = 0;
    h.engine.start();
    expect(h.timers.delays).toEqual([0]);
    await h.timers.fire();
    expect(h.timers.delays[1]).toBeCloseTo(54_000);
    h.random.value = 1;
    await h.timers.fire();
    expect(h.timers.delays[2]).toBeCloseTo(66_000);
    expect(h.engine.status()).toMatchObject({ state: "ok", running: false, lastCompleteAt: h.clock.t });
    expect(h.engine.status().nextAt).toBeCloseTo(h.clock.t + 66_000);
  });

  test("offline backoff doubles with full jitter up to 15 min and skips PR calls; success resets it", async () => {
    const h = await setup();
    h.random.value = 1;
    h.engine.start();
    await h.timers.fire();
    fake.routes[key("GET", DASHBOARD_PATH)] = { drop: true };
    const from = fake.requests.length;
    for (let i = 0; i < 5; i++) await h.timers.fire();
    expect(h.timers.delays.slice(2)).toEqual([120_000, 240_000, 480_000, 900_000, 900_000]);
    expect(h.engine.status()).toMatchObject({ state: "offline", error: expect.stringContaining("network") });
    expect(requests(from, "/activities")).toEqual([]);
    h.random.value = 0.25;
    await h.timers.fire();
    expect(h.timers.delays.at(-1)).toBe(0.25 * 900_000);

    fake.routes[key("GET", DASHBOARD_PATH)] = dashboard;
    h.random.value = 1;
    await h.timers.fire();
    expect(h.engine.status().state).toBe("ok");
    expect(h.timers.delays.at(-1)).toBeCloseTo(66_000);
  });

  test("Retry-After wins over the computed delay", async () => {
    fake.routes[key("GET", DASHBOARD_PATH)] = { status: 429, body: {}, headers: { "Retry-After": "300" } };
    const h = await setup();
    h.engine.start();
    await h.timers.fire();
    expect(h.timers.delays.at(-1)).toBe(300_000);
  });

  test("the first cycle after start and a gap over 120 s set the digest flag", async () => {
    const base = byUser(inline(), 1000003, OTHER);
    world.own = base;
    const h = await setup();
    await h.cycle();
    world.own = addReply(base, 1000003, 1000010, OTHER);
    await h.cycle();
    world.own = addReply(world.own, 1000003, 1000011, OTHER);
    h.clock.t += 200_000;
    await h.cycle();
    expect(h.events()).toEqual([
      { kind: "comment_new", ref: "1000010", digest: 0 },
      { kind: "comment_new", ref: "1000011", digest: 1 },
    ]);

    h.engine.stop();
    world.own = addReply(world.own, 1000003, 1000012, OTHER);
    const restarted = await setup(h.dir);
    await restarted.cycle();
    expect(restarted.events().at(-1)).toEqual({ kind: "comment_new", ref: "1000012", digest: 1 });
  });

  test("a 401 pauses polling until the settings change", async () => {
    const h = await setup();
    h.engine.start();
    await h.timers.fire();
    fake.token = "rotated-token";
    await h.timers.fire();
    expect(h.engine.status()).toMatchObject({ state: "auth", nextAt: null });
    expect(h.timers.pending.size).toBe(0);

    const res = await put(h.settings, { baseUrl: fake.url, token: "rotated-token" });
    expect(res.status).toBe(200);
    expect(h.timers.pending.size).toBe(1);
    await h.timers.fire();
    expect(h.engine.status().state).toBe("ok");
  });

  test("a settings change mid-cycle stops the old cycle before its database closes", async () => {
    world.own = inline();
    const h = await setup();
    fake.routes[key("GET", ACTIVITIES_PATH)] = { hang: true };
    const logs: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
    const other = startFakeBitbucket({ routes: { [key("GET", DASHBOARD_PATH)]: page([]) } });
    try {
      const running = h.engine.syncNow();
      await until(() => fake.inFlight === 1);
      const res = await put(h.settings, { baseUrl: other.url, token: FAKE_TOKEN });
      expect(res.status).toBe(200);
      fake.release();
      await running;
      await h.engine.syncNow();
    } finally {
      spy.mockRestore();
      other.stop();
    }
    expect(logs.filter((l) => l.startsWith("Sync error"))).toEqual([]);
    expect(h.engine.status().state).toBe("ok");
    expect(h.dashboardCheckpoint()).toMatchObject({ incomplete_reason: null });
  });

  test("POST /api/sync starts a cycle and returns the status", async () => {
    const h = await setup();
    const session = "s".repeat(64);
    const app = createApp({ port: 7317, token: session, live: createLive(), settings: h.settings, sync: h.engine });
    const res = await app.request("http://127.0.0.1:7317/api/sync", {
      method: "POST",
      headers: { host: "127.0.0.1:7317", origin: "http://127.0.0.1:7317", "x-rl-session": session },
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ running: true });
    await until(() => !h.engine.status().running);
    expect(requests(0, `GET ${DASHBOARD_PATH}`)).toHaveLength(2);
  });

  test("an unreadable CA file gives state error and pauses until the settings change", async () => {
    const h = await setup(undefined, { caFile: join(root, "missing-ca.pem") });
    const quiet = spyOn(console, "log").mockImplementation(() => {});
    try {
      h.engine.start();
      await h.timers.fire();
    } finally {
      quiet.mockRestore();
    }
    expect(h.engine.status()).toMatchObject({ state: "error", nextAt: null, error: expect.stringContaining("CA file") });
    expect(h.timers.pending.size).toBe(0);
    expect(fake.requests).toEqual([]);
    expect((await put(h.settings, { baseUrl: fake.url, token: FAKE_TOKEN })).status).toBe(200);
    await h.timers.fire();
    expect(h.engine.status()).toMatchObject({ state: "ok", error: null });
  });

  test("a memory-mode restart without a token gives unconfigured, and a token PUT resumes polling", async () => {
    const h = await setup(undefined, { token: false });
    h.engine.start();
    await h.timers.fire();
    expect(h.engine.status()).toMatchObject({ state: "unconfigured", nextAt: null });
    expect(h.timers.pending.size).toBe(0);
    expect(fake.requests).toEqual([]);
    expect((await put(h.settings, { baseUrl: fake.url, token: FAKE_TOKEN })).status).toBe(200);
    expect(h.timers.pending.size).toBe(1);
    await h.timers.fire();
    expect(h.engine.status().state).toBe("ok");
    expect(requests(0, "role=REVIEWER")).toHaveLength(1);
    expect(h.timers.pending.size).toBe(1);
  });

  test("without settings the engine sends no request and pauses", async () => {
    const settings = createSettings({ dir: join(root, `empty-${n++}`), secrets: createSecrets(null) });
    const timers = fakeTimers();
    const engine = createSyncEngine({ settings, live: createLive(), timers });
    engine.start();
    await timers.fire();
    expect(engine.status()).toMatchObject({ state: "unconfigured", nextAt: null });
    expect(timers.pending.size).toBe(0);
    expect(fake.requests).toEqual([]);
  });
});
