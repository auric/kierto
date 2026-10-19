// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The resolve gate script (scripts/gate0/resolve-thread.ts) against loopback fakes only. No test reaches a real host.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FAKE_TOKEN, key, startFakeBitbucket } from "../support/fake-bitbucket";
import { ACTIVITIES_PATH, activities, commentPosts, findComment, onePage, PR_PATH, PR_REF } from "../support/scenarios";

const SCRIPT = resolve(import.meta.dir, "../../scripts/gate0/resolve-thread.ts");
const ROOT = 1000003;

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
});

async function run(args: string[], env: Record<string, string> = {}) {
  const p = Bun.spawn([process.execPath, SCRIPT, ...args], { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: out + err };
}

test("the dry run passes against its own loopback fake and prints no comment text", async () => {
  const r = await run(["--dry-run"]);
  expect(r.out).toContain("stale PUT: HTTP 409");
  expect(r.out).toContain("dry run: PASS");
  expect(r.out).not.toContain("Synthetic");
  expect(r.code).toBe(0);
}, 30_000);

test("the live path resolves, records the stale PUT, reopens, and writes only sanitized values", async () => {
  const me = findComment(activities("activities-nested-reply.json"), ROOT).author;
  const posts = commentPosts(PR_PATH, () => activities("activities-nested-reply.json"), me, 4_000_001);
  const fake = startFakeBitbucket({
    routes: { [key("GET", ACTIVITIES_PATH)]: () => ({ status: 200, body: onePage(posts.activities()) }), ...posts.routes },
  });
  const out = mkdtempSync(join(tmpdir(), "rl-resolve-gate-"));
  cleanup.push(
    () => fake.stop(),
    () => rmSync(out, { recursive: true, force: true }),
  );
  const pr = `${fake.url}/projects/${PR_REF.project}/repos/${PR_REF.repo}/pull-requests/${PR_REF.id}/overview`;
  const r = await run(["--pr", pr, "--thread", String(ROOT), "--out", out], {
    GATE0_PROBE_TEST_URL: fake.url,
    GATE0_PROBE_TEST_TOKEN: FAKE_TOKEN,
  });
  expect(r.out).toContain("resolve PUT: HTTP 200");
  expect(r.out).toContain("after resolve: version=");
  expect(r.out).toContain("threadResolved=true threadResolver=true threadResolvedDate=true text unchanged=true");
  expect(r.out).toContain("stale PUT: HTTP 409");
  expect(r.out).toMatch(/after reopen: version=\d+ threadResolved=false threadResolver=false threadResolvedDate=false text unchanged=true/);
  expect(r.code).toBe(0);
  expect(posts.puts.map((p) => p.threadResolved)).toEqual([true, false, false]);
  const saved = readFileSync(join(out, "result.json"), "utf8");
  const text = findComment(activities("activities-nested-reply.json"), ROOT).text;
  for (const leak of [text, FAKE_TOKEN, fake.url, (me as { displayName: string }).displayName]) expect(saved).not.toContain(leak);
  expect(JSON.parse(saved)).toMatchObject({ ok: true, stale: { put: { status: 409 } }, reopen: { read: { threadResolved: false } } });

  // A URL of another host stops the script before any request.
  const before = fake.requests.length;
  const other = await run(["--pr", "https://other.invalid/projects/P/repos/r/pull-requests/1", "--thread", "1", "--out", out], {
    GATE0_PROBE_TEST_URL: fake.url,
    GATE0_PROBE_TEST_TOKEN: FAKE_TOKEN,
  });
  expect(other.code).toBe(2);
  expect(other.out).toContain("Nothing was sent.");
  expect(fake.requests.length).toBe(before);
}, 30_000);
