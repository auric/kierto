// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// docs/plans/review-v2/spec.md AC-P2: the State line of each thread in context/pr-context.md equals the outcome line that the UI builds
// from the routes for the same rows. The cases follow tests/web/outcome.test.ts. No runner.
import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/server/app";
import { writeConfig } from "../../src/server/config";
import { createLive } from "../../src/server/live";
import { createReviewJobs } from "../../src/server/review/jobs";
import { loadPrContext } from "../../src/server/review/pr-context";
import type { Heads } from "../../src/server/review/run-rows";
import { createSecrets } from "../../src/server/secrets";
import { createSettings } from "../../src/server/settings";
import type { FixDto, PrDetail, ReviewItemDto } from "../../src/shared/dto";
import * as shared from "../../src/shared/outcome";
import * as webFix from "../../src/web/fix/model";
import { buildThreads } from "../../src/web/pr/threads";
import { replyMap } from "../../src/web/review/model";
import * as web from "../../src/web/review/outcome";

process.env.REVIEW_LOOP_SECRETS = "memory";
const PORT = 7317;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SESSION = "s".repeat(64);
const HEADERS = { host: `127.0.0.1:${PORT}`, origin: ORIGIN, "x-rl-session": SESSION };
const ME = "jdoe";
const ALEX = "asmith";
const HEAD = "a".repeat(40);

const dirs: string[] = [];
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0)) await f();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

test("the web modules re-export the shared outcome rules, so the server and the UI run the same code", () => {
  console.log(`WP-PN outcome parity imports ${Bun.resolveSync("../../src/shared/outcome", import.meta.dir)}`);
  expect(web.threadOutcome).toBe(shared.threadOutcome);
  expect(web.MARKER).toBe(shared.MARKER);
  expect(web.outcomeText).toBe(shared.outcomeText);
  expect(webFix.fixState).toBe(shared.fixState);
  expect(webFix.fixWaiting).toBe(shared.fixWaiting);
  expect(webFix.WHY).toBe(shared.WHY);
});

describe("AC-P2", () => {
  test("each State line equals the label, commit, detail, and marker words of threadOutcome over the route data", async () => {
    const root = mkdtempSync(join(tmpdir(), "rl-parity-"));
    dirs.push(root);
    const dir = join(root, "data");
    writeConfig(dir, { baseUrl: "http://127.0.0.1:9", userSlug: ME, notifications: false, markAi: false });
    const settings = createSettings({ dir, secrets: createSecrets(null) });
    const db = settings.db() as Database;
    const live = createLive();
    const review = createReviewJobs({ settings, live, dataDir: dir, runnerCommand: ["false"] });
    const app = createApp({ port: PORT, token: SESSION, live, settings, review });
    cleanup.unshift(async () => {
      await review.stop();
      db.close();
    });
    const pr = db
      .query(
        `INSERT INTO pull_request (project, repo, pr_id, title, author_slug, author_name, my_role, state, source_head, target_head, source_branch,
          target_branch, updated_date, on_dashboard, followed) VALUES ('PROJ', 'repo', 2, 'T', $me, 'Me', 'AUTHOR', 'OPEN', $head, $head, 'f', 'main',
          1, 1, 1) RETURNING *`,
      )
      .get({ me: ME, head: HEAD }) as Heads;
    const comment = (id: number, author: string, at: number, o: { root?: number; resolved?: boolean } = {}) =>
      db
        .query(
          `INSERT INTO comment (pr, comment_id, version, parent_id, root_id, author_slug, author_name, text, thread_resolved, created_at, updated_at)
          VALUES ($pr, $id, 0, $parent, $root, $author, $author, $text, $resolved, $at, $at)`,
        )
        .run({ pr: pr.id, id, parent: o.root ?? null, root: o.root ?? id, author, text: `Text ${id}.`, resolved: o.resolved ? 1 : 0, at });
    const run = (kind: string, fix: unknown = null) =>
      (
        db
          .query(
            `INSERT INTO review_run (pr, kind, profile, note, idem_key, source_head, target_head, status, started_at, finished_at, fix_json)
            VALUES ($pr, $kind, 'general', '', $key, $head, $head, 'completed', 1, 2, $fix) RETURNING id`,
          )
          .get({ pr: pr.id, kind, key: `${kind}-${Math.random()}`, head: HEAD, fix: fix === null ? null : JSON.stringify(fix) }) as {
          id: number;
        }
      ).id;
    const replyRun = run("reply");
    const draft = (thread: number, replyTo: number, o: Record<string, unknown> = {}, row: { status?: string; edited?: number } = {}) =>
      (
        db
          .query(
            `INSERT INTO review_item (run, kind, payload_json, body, status, thread, edited) VALUES ($run, 'reply', $p, $body, $status, $thread, $edited)
            RETURNING id`,
          )
          .get({
            run: replyRun,
            p: JSON.stringify({
              thread,
              action: "reply",
              body: (o.body as string | undefined) ?? "Thanks.",
              reason: "r",
              evidenceStatus: "code",
              judgement: "question",
              replyTo,
              origin: "reply",
              ...o,
            }),
            body: (o.body as string | undefined) ?? "Thanks.",
            status: row.status ?? "new",
            thread,
            edited: row.edited ?? 0,
          }) as { id: number }
      ).id;

    comment(100, ALEX, 1); // Open
    comment(110, ALEX, 2);
    comment(111, ME, 3, { root: 110 }); // Waiting on them
    comment(120, ALEX, 4, { resolved: true }); // Resolved
    comment(130, ALEX, 5);
    draft(130, 130); // Answered
    comment(140, ALEX, 6);
    draft(140, 140, { judgement: "valid" }); // To fix
    comment(150, ME, 7);
    comment(151, ALEX, 8, { root: 150 });
    draft(150, 151, { judgement: "settled" }); // Settled
    comment(160, ALEX, 9);
    draft(160, 160, { body: "Won't fix: out of scope", origin: "nofix", declined: { run: 1 } }); // Won't fix
    comment(170, ALEX, 10);
    draft(170, 170, { body: "Fixed in ccccccc.", origin: "fix", fix: { id: 999, commit: "c".repeat(40) } }, { status: "accepted" }); // push
    comment(180, ALEX, 11);
    draft(180, 180);
    comment(181, ALEX, 12, { root: 180 }); // Out of date
    comment(190, ALEX, 13); // Already done
    comment(200, ALEX, 14); // Fix proposed
    comment(210, ALEX, 15);
    const mine = draft(210, 210, {}, { status: "accepted", edited: 1 });
    db.query(
      `INSERT INTO review_item (run, kind, payload_json, body, status, thread, edited) VALUES ($run, 'reply', $p, 'New text.', 'discarded', 210, 0)`,
    ).run({
      run: replyRun,
      p: JSON.stringify({
        thread: 210,
        action: "reply",
        body: "New text.",
        reason: "r",
        evidenceStatus: "code",
        judgement: "question",
        replyTo: 210,
        origin: "reply",
        revises: mine,
      }),
    }); // Revision waiting
    const fixRun = run("fix", [
      { thread: 190, fixed: false, reason: "Done.", why: "already", reply: "" },
      { thread: 200, fixed: true, reason: "Edits.", why: null, reply: "" },
    ]);
    db.query(
      `INSERT INTO fix_edit (run, ord, thread, item, path, old, new, start, rows_json) VALUES ($run, 0, 200, NULL, 'a.ts', 'x', 'y', 0, '[]')`,
    ).run({ run: fixRun });

    const get = async <T>(path: string) => (await (await app.request(`${ORIGIN}${path}`, { headers: HEADERS })).json()) as T;
    const detail = await get<PrDetail>(`/api/prs/${pr.id}`);
    const replies = await get<ReviewItemDto[]>(`/api/prs/${pr.id}/reply-drafts`);
    const fixes = await get<FixDto[]>(`/api/prs/${pr.id}/fixes`);
    // useThreadCards: the input of each thread on the page.
    const byThread = replyMap(replies);
    const ui = new Map(
      buildThreads(detail.comments, new Set(), ME, detail.pr).map((t) => [
        t.id,
        shared.stateText(
          shared.threadOutcome({
            thread: { id: t.id, turn: t.turn, newest: t.last?.id ?? null, orphanedAt: t.root.orphanedAt ?? null },
            draft: byThread.get(t.id),
            fixes,
            commits: detail.commits,
            ticks: new Map(),
            author: detail.pr.role === "AUTHOR",
            prHead: detail.sourceHead,
          }).outcome,
        ),
      ]),
    );
    const c = await loadPrContext(db, null, pr, { threads: [] }, new AbortController().signal, { me: ME, dataDir: dir, now: Date.now() });
    const server = new Map(c.input.threads.map((t) => [t.id, t.state]));
    expect(Object.fromEntries(server)).toEqual(Object.fromEntries(ui));
    expect(Object.fromEntries(server)).toEqual({
      100: "Open",
      110: "Waiting on them",
      120: "Resolved",
      130: "Answered",
      140: "To fix",
      150: "Settled",
      160: "Won't fix: out of scope",
      170: "Fixed in ccccccc; Waiting for push",
      180: "Answered; Out of date",
      190: "Already done",
      200: "Fix proposed",
      210: "Answered; Revision waiting",
    });
  });
});
