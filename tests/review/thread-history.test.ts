// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Thread history (docs/plans/thread-outcome.md section 10): drafts, replacedBy, revisions, fix notes, fix commits, posts, and the route.
// An in-memory database, no runner, no git.
import { describe, expect, test } from "bun:test";
import { createLive } from "../../src/server/live";
import { threadHistory } from "../../src/server/review/history";
import type { ReviewJobs } from "../../src/server/review/jobs";
import { createReviewRoutes } from "../../src/server/review/routes";
import { openDb } from "../../src/server/storage/db";
import type { ThreadHistoryDto } from "../../src/shared/dto";
import type { ReplyPayload } from "../../src/shared/review";

const HASH = "c".repeat(40);

function setup() {
  const db = openDb(":memory:");
  db.run("INSERT INTO pull_request (id, project, repo, pr_id) VALUES (1, 'PROJ', 'repo', 1)");
  const comment = (id: number, root: number, parent: number | null, deleted = false) =>
    db
      .query(
        `INSERT INTO comment (pr, comment_id, version, parent_id, root_id, author_slug, text, created_at, updated_at, tombstoned_at)
        VALUES (1, $id, 0, $parent, $root, 'alex', 'text', 10, 10, $deleted)`,
      )
      .run({ id, root, parent, deleted: deleted ? 20 : null });
  comment(100, 100, null);
  comment(101, 100, 100);
  comment(200, 200, null);
  comment(201, 200, 200);
  let keys = 0;
  const run = (kind: string, started: number, finished: number | null, fix?: unknown) =>
    (
      db
        .query(
          `INSERT INTO review_run (pr, kind, profile, note, idem_key, source_head, target_head, status, started_at, finished_at, fix_json)
          VALUES (1, $kind, '', '', $key, 'h', 't', 'completed', $started, $finished, $fix) RETURNING id`,
        )
        .get({ kind, key: `k${keys++}`, started, finished, fix: fix === undefined ? null : JSON.stringify(fix) }) as { id: number }
    ).id;
  const item = (r: number, status: string, p: Partial<ReplyPayload> & Record<string, unknown> = {}, thread = 100) => {
    const payload = { thread, action: "reply", body: "b", reason: "r", evidenceStatus: "unverified", judgement: null, replyTo: 101, ...p };
    return (
      db
        .query(
          `INSERT INTO review_item (run, kind, payload_json, body, status, revision, edited, thread)
          VALUES ($run, 'reply', $payload, 'b', $status, 0, 0, $thread) RETURNING id`,
        )
        .get({ run: r, payload: JSON.stringify(payload), status, thread }) as { id: number }
    ).id;
  };
  const edit = (r: number, thread: number) =>
    (
      db
        .query(
          `INSERT INTO fix_edit (run, ord, thread, path, old, new, start, rows_json) VALUES ($run, 0, $thread, 'a.ts', 'x', 'y', 0, '[]')
          RETURNING id`,
        )
        .get({ run: r, thread }) as { id: number }
    ).id;
  const commit = (r: number, edits: number[], o: { state?: string; hash?: string | null; at?: number; updated?: number } = {}) =>
    (
      db
        .query(
          `INSERT INTO fix_commit (pr, run, idem_key, edits_json, mode, before_head, commit_hash, short_hash, state, message, created_at, updated_at)
          VALUES (1, $run, $key, $edits, 'clone', 'b', $hash, $short, $state, 'm', $at, $updated) RETURNING id`,
        )
        .get({
          run: r,
          key: `c${keys++}`,
          edits: JSON.stringify(edits),
          hash: o.hash === undefined ? HASH : o.hash,
          short: o.hash === null ? null : "ccccccc",
          state: o.state ?? "committed",
          at: o.at ?? 50,
          updated: o.updated ?? o.at ?? 50,
        }) as { id: number }
    ).id;
  const post = (o: {
    kind?: string;
    run?: number | null;
    dest?: unknown;
    state: string;
    error?: string | null;
    remote?: number | null;
    resolve?: [number, string, string | null];
  }) =>
    (
      db
        .query(
          `INSERT INTO post (pr, run, kind, idem_key, body, destination_json, items_json, state, remote_id, last_error, created_at, updated_at,
            resolve_root, resolve_state, resolve_error)
          VALUES (1, $run, $kind, $key, 'b', $dest, '[]', $state, $remote, $error, 60, 70, $root, $rstate, $rerror) RETURNING id`,
        )
        .get({
          run: o.run ?? null,
          kind: o.kind ?? "reply",
          key: `p${keys++}`,
          dest: JSON.stringify(o.dest ?? { kind: "reply", parentId: 101 }),
          state: o.state,
          remote: o.remote ?? null,
          error: o.error ?? null,
          root: o.resolve?.[0] ?? null,
          rstate: o.resolve?.[1] ?? null,
          rerror: o.resolve?.[2] ?? null,
        }) as { id: number }
    ).id;
  const history = (thread = 100) => threadHistory(db, 1, thread) as ThreadHistoryDto;
  const draft = (h: ThreadHistoryDto, id: number) => h.drafts.find((d) => d.item.id === id);
  return { db, run, item, edit, commit, post, history, draft };
}

describe("threadHistory drafts", () => {
  test("fix.replaced names the Fixed in draft, which takes the commit time", () => {
    const s = setup();
    const reply = s.run("reply", 1, 2);
    const old = s.item(reply, "discarded");
    const fix = s.run("fix", 3, 4);
    const c = s.commit(fix, [s.edit(fix, 100)], { at: 55 });
    const fixed = s.item(fix, "new", { origin: "fix", fix: { id: c, commit: HASH, replaced: [old] } });
    const h = s.history();
    expect(s.draft(h, old)).toMatchObject({ at: 2, exact: true, replacedBy: fixed });
    expect(s.draft(h, fixed)).toMatchObject({ at: 55, exact: true, replacedBy: null });
    expect(s.draft(h, old)?.item.drafted).toEqual({ kind: "reply", startedAt: 1, finishedAt: 2, head: "h" });
  });

  test("declined.replaced names the Won't fix draft, which takes the fix run time with exact false", () => {
    const s = setup();
    const reply = s.run("reply", 1, 2);
    const old = s.item(reply, "discarded");
    const fix = s.run("fix", 3, null);
    const wont = s.item(fix, "new", { origin: "nofix", declined: { run: fix } });
    s.db.query("UPDATE review_run SET fix_json = $json WHERE id = $id").run({
      id: fix,
      json: JSON.stringify([
        { thread: 100, fixed: false, reason: "r", why: null, reply: "", declined: { reason: "no", draft: wont, replaced: [old] } },
      ]),
    });
    const h = s.history();
    expect(s.draft(h, old)?.replacedBy).toBe(wont);
    expect(s.draft(h, wont)).toMatchObject({ at: 3, exact: false });
    expect(h.fixes).toHaveLength(1);
    expect(h.fixes[0]).toMatchObject({ at: 3, run: fix, note: { declined: { reason: "no" } } });
  });

  test("session.replaced names the session draft", () => {
    const s = setup();
    const old = s.item(s.run("reply", 1, 2), "discarded");
    const session = s.run("session", 3, 4);
    const mine = s.item(session, "new", {
      origin: "session",
      session: { run: session, verdict: "accept", reason: "r", replaced: [{ id: old, was: "new" }] },
    });
    expect(s.draft(s.history(), old)?.replacedBy).toBe(mine);
  });

  test("fallback: a discard without discardedBy takes the next newer draft that is no revision", () => {
    const s = setup();
    const r = s.run("reply", 1, 2);
    const superseded = s.item(r, "discarded");
    const revision = s.item(r, "discarded", { revises: 999 });
    const next = s.item(r, "discarded", { discardedBy: "user" });
    const userGone = s.item(r, "discarded", { discardedBy: "user" });
    const aiGone = s.item(r, "discarded", { discardedBy: "ai" });
    s.item(r, "new");
    const h = s.history();
    expect(s.draft(h, superseded)?.replacedBy).toBe(next);
    expect(s.draft(h, userGone)?.replacedBy).toBeNull();
    expect(s.draft(h, aiGone)?.replacedBy).toBeNull();
    expect(s.draft(h, revision)?.replacedBy).toBeNull();
    expect(s.draft(h, next)?.replacedBy).toBeNull();
  });

  test("revisions: waiting, dropped, and used (revisionOf)", () => {
    const s = setup();
    const r = s.run("reply", 1, 2);
    const mine = s.item(r, "discarded", { discardedBy: "user", touchedAt: 30 });
    const waiting = s.item(r, "discarded", { revises: mine });
    const dropped = s.item(r, "discarded", { revises: mine, dropped: true });
    const used = s.item(r, "new", { revisionOf: mine });
    const h = s.history();
    expect(s.draft(h, mine)).toMatchObject({ replacedBy: null, item: { payload: { touchedAt: 30 } } });
    expect(s.draft(h, waiting)).toMatchObject({ replacedBy: null, item: { payload: { revises: mine } } });
    expect(s.draft(h, waiting)?.item.payload).not.toHaveProperty("dropped");
    expect(s.draft(h, dropped)).toMatchObject({ replacedBy: null, item: { payload: { revises: mine, dropped: true } } });
    expect(s.draft(h, used)).toMatchObject({ replacedBy: null, item: { status: "new", payload: { revisionOf: mine } } });
  });

  test("only drafts of the thread in this PR", () => {
    const s = setup();
    const r = s.run("reply", 1, 2);
    s.item(r, "new", {}, 200);
    const mine = s.item(r, "new");
    expect(s.history().drafts.map((d) => d.item.id)).toEqual([mine]);
  });
});

describe("threadHistory fix commits", () => {
  test("N of M edits, pushed, waiting for push, and undone", () => {
    const s = setup();
    const fix = s.run("fix", 1, 2, [{ thread: 100, fixed: true, reason: "r", why: null, reply: "" }]);
    const [a, b, c] = [s.edit(fix, 100), s.edit(fix, 100), s.edit(fix, 100)];
    const other = s.edit(fix, 200);
    s.db.run(`INSERT INTO pr_commit (pr, hash, ord, message, author_name, ts) VALUES (1, '${HASH}', 0, 'm', 'a', 1)`);
    const pushed = s.commit(fix, [a, b, other], { at: 40 });
    const waiting = s.commit(fix, [c], { hash: "d".repeat(40), at: 41 });
    const undone = s.commit(fix, [c], { hash: "e".repeat(40), state: "undone", at: 42, updated: 90 });
    s.commit(fix, [other]);
    const h = s.history();
    expect(h.commits).toEqual([
      { at: 40, id: pushed, run: fix, short: "ccccccc", state: "committed", edits: 2, of: 3, pushed: true, undoneAt: null },
      { at: 41, id: waiting, run: fix, short: "ccccccc", state: "committed", edits: 1, of: 3, pushed: false, undoneAt: null },
      { at: 42, id: undone, run: fix, short: "ccccccc", state: "undone", edits: 1, of: 3, pushed: false, undoneAt: 90 },
    ]);
    expect(h.fixes).toEqual([{ at: 2, run: fix, note: { thread: 100, fixed: true, reason: "r", why: null, reply: "" } }]);
  });

  test("a staged commit has no hash and is not pushed", () => {
    const s = setup();
    const fix = s.run("fix", 1, 2);
    const id = s.commit(fix, [s.edit(fix, 100)], { hash: null, state: "staged" });
    expect(s.history().commits).toEqual([
      { at: 50, id, run: fix, short: null, state: "staged", edits: 1, of: 1, pushed: false, undoneAt: null },
    ]);
  });
});

describe("threadHistory posts", () => {
  test("replies in the thread, resolves of the thread, and the start post, with their states", () => {
    const s = setup();
    const r = s.run("review", 1, 2);
    const posting = s.post({ state: "sent", run: r });
    const failed = s.post({ state: "failed", error: "HTTP 500", dest: { kind: "reply", parentId: 100 } });
    const unknown = s.post({ state: "unknown" });
    const resolve = s.post({ state: "confirmed", remote: 102, resolve: [100, "failed", "HTTP 403"] });
    const onlyResolve = s.post({ state: "confirmed", dest: { kind: "reply", parentId: 201 }, resolve: [100, "done", null] });
    const start = s.post({
      kind: "inline",
      run: r,
      state: "confirmed",
      remote: 100,
      dest: { kind: "inline", path: "a.ts", srcPath: null, line: 1, lineEnd: 1, lineType: "add" },
    });
    s.post({ state: "failed", dest: { kind: "reply", parentId: 201 } });
    s.post({ kind: "general", state: "confirmed", remote: 200, dest: { kind: "general" } });
    const h = s.history();
    expect(h.posts.map((p) => p.id)).toEqual([posting, failed, unknown, resolve, onlyResolve, start]);
    expect(h.posts[0]).toEqual({
      at: 60,
      id: posting,
      run: r,
      kind: "reply",
      state: "sent",
      error: null,
      remoteId: null,
      updatedAt: 70,
      resolve: null,
    });
    expect(h.posts[1]).toMatchObject({ state: "failed", error: "HTTP 500" });
    expect(h.posts[2]).toMatchObject({ state: "unknown" });
    expect(h.posts[3]).toMatchObject({ remoteId: 102, resolve: { root: 100, state: "failed", error: "HTTP 403" } });
    expect(h.posts[5]).toMatchObject({ kind: "inline", run: r, remoteId: 100 });
  });
});

describe("threadHistory thread lookup", () => {
  test("null without a comment row, and a deleted root still returns history", () => {
    const s = setup();
    expect(threadHistory(s.db, 1, 999)).toBeNull();
    expect(threadHistory(s.db, 2, 100)).toBeNull();
    s.db.run("UPDATE comment SET tombstoned_at = 20 WHERE comment_id = 100");
    expect(s.history()).toEqual({ thread: 100, drafts: [], fixes: [], commits: [], posts: [] });
  });

  test("GET /prs/:id/threads/:thread/history gives 200, 404, and 400", async () => {
    const s = setup();
    const app = createReviewRoutes({ review: { open: () => s.db } as unknown as ReviewJobs, live: createLive() });
    const ok = await app.request("/prs/1/threads/100/history");
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as ThreadHistoryDto).thread).toBe(100);
    const missing = await app.request("/prs/1/threads/999/history");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Thread not found." });
    expect((await app.request("/prs/1/threads/abc/history")).status).toBe(400);
    expect((await app.request("/prs/0/threads/100/history")).status).toBe(400);
  });
});
