// Plan v3 WP4 and WP13b: file and comment links from server links only (Gate v3 U5). No test reaches a forge.
import type { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConfig } from "../../src/server/config";
import { createLive } from "../../src/server/live";
import { buildPlan, fileRef } from "../../src/server/publish/plan";
import { planInput } from "../../src/server/publish/routes";
import { createReviewJobs } from "../../src/server/review/jobs";
import { createSecrets } from "../../src/server/secrets";
import { createSettings } from "../../src/server/settings";
import type { ReviewItemDto } from "../../src/shared/dto";
import { commentUrl, fileUrl } from "../../src/shared/links";
import { FAKE_TOKEN, FAKE_USER } from "../support/fake-bitbucket";

process.env.REVIEW_LOOP_SECRETS = "memory";
const SOURCE = "a".repeat(40);
const BASE = "c".repeat(40);
// The recorded link forms (fixtures/bitbucket/pull-request.json, dashboard-reviewer-page.json).
const PERSONAL = "https://bitbucket.example.test/users/jdoe/repos/sample-repo-1/browse";
const PROJECT = "https://bitbucket.example.test/projects/PROJ1/repos/sample-repo-2/browse";
const PR = "https://bitbucket.example.test/users/jdoe/repos/sample-repo-1/pull-requests/2";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
});

test("a file link appends the path, the commit, and the line to the browse link", () => {
  expect(fileUrl(PERSONAL, "src/app.ts", SOURCE, 12)).toBe(`${PERSONAL}/src/app.ts?at=${SOURCE}#12`);
  expect(fileUrl(`${PROJECT}/`, "a b/c#(1).ts", SOURCE, 3)).toBe(`${PROJECT}/a%20b/c%23%281%29.ts?at=${SOURCE}#3`);
});

test("a comment link appends the overview suffix to the PR link", () => {
  expect(commentUrl(PR, 1000005)).toBe(`${PR}/overview?commentId=1000005`);
  expect(commentUrl(`${PR}/`, 7)).toBe(`${PR}/overview?commentId=7`);
});

test("fileRef gives a Markdown link only with a browse link and a commit", () => {
  const run = { repoUrl: PERSONAL };
  expect(fileRef(run, "src/app.ts", SOURCE, 1)).toBe(`[src/app.ts:1](${PERSONAL}/src/app.ts?at=${SOURCE}#1)`);
  expect(fileRef(run, "x[1].ts", SOURCE, 1)).toBe(`[x\\[1\\].ts:1](${PERSONAL}/x%5B1%5D.ts?at=${SOURCE}#1)`);
  expect(fileRef({ repoUrl: null }, "src/app.ts", SOURCE, 1)).toBe("src/app.ts:1");
  expect(fileRef({}, "src/app.ts", SOURCE, 1)).toBe("src/app.ts:1");
  expect(fileRef(run, "src/app.ts", null, 1)).toBe("src/app.ts:1");
});

const outside = (id: number, side: "new" | "old"): ReviewItemDto => {
  const anchor = { state: "outside" as const, path: "new/name.ts", oldPath: "old/name.ts", line: 8, lineEnd: 8, excerpt: [] };
  return {
    id,
    run: 1,
    kind: "finding",
    body: "Text.",
    payload: {
      path: "new/name.ts",
      side,
      line: 8,
      lineEnd: null,
      anchorText: "x",
      severity: "minor",
      category: "naming",
      body: "Text.",
      evidence: "",
      evidenceStatus: "code",
      confidence: "high",
      agent: null,
      anchor,
    },
    anchor: { ...anchor, side },
    status: "accepted",
    revision: 1,
    edited: false,
  };
};

test("the general comment links a new-side line at the source head and an old-side line at the merge base", () => {
  const run = { id: 1, sourceHead: SOURCE, targetHead: "b".repeat(40), mergeBase: BASE, repoUrl: PERSONAL };
  const [post] = buildPlan({ me: FAKE_USER, runs: [run], items: [outside(1, "new"), outside(2, "old")], comments: [] });
  expect(post?.body).toBe(
    `[new/name.ts:8](${PERSONAL}/new/name.ts?at=${SOURCE}#8): Text.\n\n[old/name.ts:8](${PERSONAL}/old/name.ts?at=${BASE}#8): Text.`,
  );
  const [plain] = buildPlan({ me: FAKE_USER, runs: [{ ...run, repoUrl: null }], items: [outside(1, "new")], comments: [] });
  expect(plain?.body).toBe("new/name.ts:8: Text.");
});

test("the plan input carries the stored browse link of the PR", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rl-links-"));
  writeConfig(dir, { baseUrl: "http://127.0.0.1:9", userSlug: FAKE_USER, notifications: false });
  const secrets = createSecrets(null);
  await secrets.set(FAKE_TOKEN);
  const settings = createSettings({ dir, secrets });
  const db = settings.db() as Database;
  // A runner command that never runs: no test starts a review.
  const review = createReviewJobs({ settings, live: createLive(), dataDir: dir, runnerCommand: [process.execPath, "--version"] });
  cleanup.push(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });
  const { id: pr } = db
    .query("INSERT INTO pull_request (project, repo, pr_id, repo_url) VALUES ('~JDOE', 'sample-repo-1', 2, $url) RETURNING id")
    .get({ url: PERSONAL }) as { id: number };
  const { id: run } = db
    .query(
      `INSERT INTO review_run (pr, profile, note, idem_key, source_head, target_head, merge_base, status, started_at)
      VALUES ($pr, 'general', '', 'k', $s, $t, $b, 'completed', 1) RETURNING id`,
    )
    .get({ pr, s: SOURCE, t: "b".repeat(40), b: BASE }) as { id: number };
  db.query("INSERT INTO review_item (run, kind, payload_json, body, status) VALUES ($run, 'question', '{}', 'Q?', 'accepted')").run({
    run,
  });
  expect(planInput(review, settings, pr)?.runs).toEqual([
    { id: run, sourceHead: SOURCE, targetHead: "b".repeat(40), mergeBase: BASE, repoUrl: PERSONAL },
  ]);
});
