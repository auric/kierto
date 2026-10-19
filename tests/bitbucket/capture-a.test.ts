// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Synthetic "real" values. Each sensitive token holds "qzx", so one search finds any leak.
const SCRIPTS = resolve(import.meta.dir, "../../scripts/gate0");
const H1 = "1".repeat(40);
const H2 = "2".repeat(40);
const HOST = "https://bb.qzxhost.zz";
const user = {
  name: "qzxuser",
  emailAddress: "qzx.user@qzxmail.zz",
  displayName: "Qzxa Qzxb",
  id: 5551,
  slug: "qzxuser",
  type: "NORMAL",
  links: { self: [{ href: `${HOST}/users/qzxuser` }] },
};
const anchor = {
  fromHash: H1,
  toHash: H2,
  line: 5,
  lineType: "ADDED",
  fileType: "TO",
  path: "qzxdir/qzxfile.ts",
  srcPath: "qzxold/qzxprev.ts",
  diffType: "COMMIT",
  orphaned: true,
};
const comment = { id: 777001, version: 0, text: "qzx secret comment", author: user, anchor, comments: [] };
const commit = {
  id: H2,
  displayId: H2.slice(0, 11),
  message: "qzx commit message",
  author: { name: "Qzxa Qzxb", emailAddress: "qzx.user@qzxmail.zz" },
  parents: [{ id: H1 }],
};
const page = (values: unknown[]) => ({ values, size: values.length, isLastPage: true, start: 0, limit: 50 });

let tmp = "";
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = "";
});

async function run(args: string[], env: Record<string, string> = {}) {
  const p = Bun.spawn([process.execPath, ...args], { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: out + err };
}

const readAll = (dir: string) =>
  readdirSync(dir)
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");

test("sanitizer maps anchor path and srcPath strings that no diff names", async () => {
  tmp = mkdtempSync(join(tmpdir(), "rl-san-test-"));
  const raw = join(tmp, "raw");
  mkdirSync(raw);
  writeFileSync(
    join(raw, "u2-comments-0-p0.json"),
    JSON.stringify({ method: "GET", path: "/x", status: 200, auser: "qzxuser", body: page([comment]) }),
  );
  const r = await run([join(SCRIPTS, "sanitize-fixtures.ts"), "--raw", raw, "--out", join(tmp, "out"), "--prefix", "real-"]);
  expect(r.out).toContain("hits=0 structure diffs=0");
  expect(r.code).toBe(0);
  const fixture = readFileSync(join(tmp, "out", "real-u2-comments-0-p0.json"), "utf8");
  expect(fixture.toLowerCase()).not.toContain("qzx");
  const a = JSON.parse(fixture).body.values[0].anchor;
  expect(a.path).toBe("dir1/sample2.ts");
  expect(a.srcPath).toBe("dir3/sample4.ts");
  expect(a.orphaned).toBe(true);
}, 30_000);

test("sanitizer replaces and scans the hunk context of a diff", async () => {
  tmp = mkdtempSync(join(tmpdir(), "rl-san-test-"));
  const raw = join(tmp, "raw");
  const out = join(tmp, "out");
  mkdirSync(raw);
  const context = "void qzxEnclosingFunction(int qzxArg)";
  const hunk = { context, sourceLine: 1, segments: [{ type: "CONTEXT", lines: [{ source: 1, destination: 1, line: "qzx code line" }] }] };
  writeFileSync(
    join(raw, "u12-diff-0.json"),
    JSON.stringify({ status: 200, auser: "qzxuser", body: { user, diffs: [{ hunks: [hunk] }] } }),
  );
  const r = await run([join(SCRIPTS, "sanitize-fixtures.ts"), "--raw", raw, "--out", out, "--prefix", "real-"]);
  expect(r.out).toContain("hits=0 structure diffs=0");
  const fixture = readFileSync(join(out, "real-u12-diff-0.json"), "utf8");
  expect(fixture.toLowerCase()).not.toContain("qzx");
  expect(JSON.parse(fixture).body.diffs[0].hunks[0].context).toMatch(/^sample context \d+$/);
  // A leaked context in another fixture is a scan hit.
  writeFileSync(join(out, "leak.json"), JSON.stringify({ context }));
  const leak = await run([join(SCRIPTS, "sanitize-fixtures.ts"), "--raw", raw, "--out", out, "--prefix", "real-"]);
  expect(leak.out).not.toContain("hits=0");
  expect(leak.code).toBe(1);
}, 30_000);

test("capture sends only GET requests, writes sanitized fixtures, and prints no values", async () => {
  tmp = mkdtempSync(join(tmpdir(), "rl-capture-test-"));
  const methods: string[] = [];
  const diff = {
    source: null,
    destination: {
      components: ["qzxdir", "qzxfile.ts"],
      name: "qzxfile.ts",
      extension: "ts",
      parent: "qzxdir",
      toString: "qzxdir/qzxfile.ts",
    },
  };
  const hunk = {
    segments: [
      { type: "ADDED", lines: [{ source: 4, destination: 5, line: "const qzxSecretLine = 1;", truncated: false, commentIds: [777001] }] },
    ],
  };
  const pr = {
    id: 1,
    version: 1,
    state: "OPEN",
    title: "qzx title text",
    fromRef: {
      id: "refs/heads/qzx-branch",
      displayId: "qzx-branch",
      latestCommit: H2,
      repository: { slug: "qzxrepo", name: "qzxrepo", scmId: "git", project: { key: "QZXP", name: "Qzx Project", type: "NORMAL" } },
    },
    links: { self: [{ href: `${HOST}/projects/QZXP/repos/qzxrepo/pull-requests/1` }] },
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      methods.push(req.method);
      const p = new URL(req.url).pathname;
      if (p.endsWith("/pull-requests/1")) return Response.json(pr);
      if (p.endsWith("/activities"))
        return Response.json(
          page([
            {
              id: 888001,
              action: "COMMENTED",
              commentAction: "ADDED",
              user,
              comment,
              commentAnchor: anchor,
              diff: { ...diff, hunks: [hunk] },
            },
            { id: 888002, action: "RESCOPED", user },
          ]),
        );
      if (p.endsWith("/comments")) return Response.json(page([comment]));
      if (p.includes("/diff/")) return Response.json({ fromHash: H1, toHash: H2, diffs: [{ ...diff, hunks: [hunk] }] });
      if (p.endsWith("/commits")) return Response.json(page([commit]));
      return new Response("not found", { status: 404 });
    },
  });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const raw = join(tmp, "raw");
    const out = join(tmp, "out");
    mkdirSync(out);
    const r = await run(
      [
        join(SCRIPTS, "capture-a.ts"),
        "--pr",
        `${base}/projects/QZXP/repos/qzxrepo/pull-requests/1`,
        "--step",
        "both",
        "--raw",
        raw,
        "--out",
        out,
      ],
      {
        GATE0_PROBE_TEST_URL: base,
        GATE0_PROBE_TEST_TOKEN: "test-token",
      },
    );
    expect(r.out).toContain("hits=0 structure diffs=0");
    expect(r.code).toBe(0);
    expect(new Set(methods)).toEqual(new Set(["GET"]));
    for (const f of ["u2-pull-request.json", "u2-activities-p0.json", "u2-comments-0-p0.json", "u2-diff-0.json", "u12-commits-p0.json"])
      expect(existsSync(join(raw, f))).toBe(true);
    expect(existsSync(join(raw, "u2-commits-p0.json"))).toBe(false);
    expect(readdirSync(out).sort()).toEqual(
      readdirSync(raw)
        .map((f) => `real-${f}`)
        .sort(),
    );
    expect(readAll(out).toLowerCase()).not.toContain("qzx");
    expect(r.out.toLowerCase()).not.toContain("qzx");
    expect(r.out).not.toContain("127.0.0.1");
    expect(r.out).toContain('actions={"COMMENTED":1,"RESCOPED":1}');
    expect(r.out).toContain("orphaned=true");
  } finally {
    server.stop(true);
  }
}, 60_000);

test("dry run sanitizes and summarizes the existing fixtures", async () => {
  const r = await run([join(SCRIPTS, "capture-a.ts"), "--dry-run"]);
  expect(r.code).toBe(0);
  expect(r.out).toContain("structure diffs=0");
  expect(r.out).toContain("comments with an anchor:");
}, 30_000);
