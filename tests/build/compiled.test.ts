// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Checks the binary of `bun run compile` for this host. It skips when the binary is absent.
// It fails when an input of the compile is newer than the binary.
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import pkg from "../../package.json";
import { binPath, HOST } from "../../scripts/compile";
import { dbPath } from "../../src/server/config";
import { openDb } from "../../src/server/storage/db";
import type { MetaDto, TaskContextDto, TaskPreviewDto } from "../../src/shared/dto";
import { FAKE_TOKEN, key, startFakeBitbucket } from "../support/fake-bitbucket";
import { ISSUE_KEY, JIRA_TOKEN, startFakeJira } from "../support/fake-jira";
import { DASHBOARD_PATH, onePage } from "../support/scenarios";

const BIN = binPath(HOST);
const ROOT = join(import.meta.dir, "../..");
const WEB = join(ROOT, "dist/web");
// `bun run compile` builds dist/web from these and embeds it. A dist/web rebuild from the same inputs gives the same assets.
const INPUTS = [
  "src",
  "index.html",
  "vite.config.ts",
  "tsconfig.json",
  "package.json",
  "bun.lock",
  "scripts/compile.ts",
  "LICENSE",
  "NOTICE.md",
  "THIRD_PARTY_NOTICES.md",
];
const START_MS = 20_000;
const ID = String.raw`[A-Z][A-Z0-9]+-\d+`;

// The first input path that is newer than the binary, or null.
function newerInput(): string | null {
  const built = statSync(BIN).mtimeMs;
  for (const i of INPUTS) {
    const p = join(ROOT, i);
    const files = statSync(p).isDirectory() ? readdirSync(p, { recursive: true }).map((f) => join(p, String(f))) : [p];
    for (const f of files) if (statSync(f).mtimeMs > built) return relative(ROOT, f);
  }
  return null;
}

describe.skipIf(!existsSync(BIN))("compiled binary", () => {
  let root = "";
  let fake: ReturnType<typeof startFakeBitbucket> | undefined;
  let jira: ReturnType<typeof startFakeJira> | undefined;
  let proc: Bun.Subprocess<"ignore", "pipe", "inherit"> | undefined;
  let origin = "";
  let commit = "";
  let session = "";
  const env: Record<string, string> = {};

  // Starts one binary on the data folder of root and waits for its start line. The caller kills the process.
  async function launch() {
    const p = Bun.spawn([BIN], { cwd: root, env, stdin: "ignore", stdout: "pipe", stderr: "inherit" });
    let out = "";
    const stdout = p.stdout.getReader();
    const decoder = new TextDecoder();
    const started = (async () => {
      for (;;) {
        const { done, value } = await stdout.read();
        if (done) return null;
        out += decoder.decode(value, { stream: true });
        const m = /PR Review Inbox \(([^)]+)\): (http:\/\/127\.0\.0\.1:\d+)\//.exec(out);
        if (m) return m;
      }
    })();
    const m = await Promise.race([started, p.exited.then(() => null), Bun.sleep(START_MS - 5_000).then(() => null)]);
    if (!m) {
      p.kill();
      throw new Error(`The binary did not start. Output:\n${out}`);
    }
    // Keep the pipe drained, so that a log line never blocks the binary.
    void (async () => {
      while (!(await stdout.read()).done);
    })().catch(() => {});
    return { proc: p, origin: m[2] as string, commit: m[1] as string };
  }

  beforeAll(async () => {
    const stale = newerInput();
    if (stale) throw new Error(`The binary is older than ${stale}: rebuild with bun run compile.`);
    root = mkdtempSync(join(tmpdir(), "rl-bin-"));
    fake = startFakeBitbucket({ routes: { [key("GET", DASHBOARD_PATH)]: { status: 200, body: onePage([]) } } });
    jira = startFakeJira();
    // An empty PATH keeps the real claude CLI out of the start-up runner check. Windows spells the name "Path".
    const emptyPath = join(root, "path");
    mkdirSync(emptyPath);
    for (const [k, v] of Object.entries(process.env))
      if (v !== undefined && k.toUpperCase() !== "PATH" && !k.startsWith("REVIEW_LOOP_")) env[k] = v;
    Object.assign(env, { PATH: emptyPath, REVIEW_LOOP_PORT: "0", REVIEW_LOOP_DATA_DIR: join(root, "data"), REVIEW_LOOP_SECRETS: "memory" });
    const first = await launch();
    proc = first.proc;
    origin = first.origin;
    commit = first.commit;
    console.log(`Binary: ${BIN}\nModified: ${statSync(BIN).mtime.toISOString()}\nBuild commit: ${commit}\nURL: ${origin}`);
    const page = await (await fetch(`${origin}/`)).text();
    session = /<meta name="rl-session" content="([0-9a-f]{64})"/.exec(page)?.[1] ?? "";
  }, START_MS);

  afterAll(async () => {
    proc?.kill();
    if (proc) await Promise.race([proc.exited, Bun.sleep(5_000)]);
    fake?.stop();
    jira?.stop();
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });

  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${origin}${path}`, {
      method,
      headers: { origin, "x-rl-session": session, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const preview = async (body: unknown) => {
    const res = await call("POST", "/api/settings/task-rules/preview", body);
    expect(res.status).toBe(200);
    return (await res.json()) as TaskPreviewDto;
  };

  test("serves the embedded page with the session token and every asset", async () => {
    expect(session).toMatch(/^[0-9a-f]{64}$/);
    const files = readdirSync(join(WEB, "assets"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const r = await fetch(`${origin}/assets/${f}`);
      expect(r.status, f).toBe(200);
      expect(Buffer.from(await r.arrayBuffer()).equals(readFileSync(join(WEB, "assets", f))), f).toBe(true);
    }
  });

  test("meta names the package version and the build commit", async () => {
    expect(((await (await call("GET", "/api/meta")).json()) as MetaDto).app).toEqual({ version: pkg.version, commit });
  });

  test("a settings PUT creates the database at the last migration", async () => {
    const url = fake?.url as string;
    expect((await call("PUT", "/api/settings", { baseUrl: url, token: FAKE_TOKEN, notifications: false })).status).toBe(200);
    const version = (db: Database) => {
      try {
        return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
      } finally {
        db.close();
      }
    };
    const expected = version(openDb(join(root, "source.sqlite")));
    expect(expected).toBeGreaterThan(0);
    expect(version(new Database(dbPath(join(root, "data"), url), { readonly: true }))).toBe(expected);
  });

  test("a task fetch converts the Jira HTML to Markdown with the bundled turndown in the bundled worker", async () => {
    const url = fake?.url as string;
    expect((await call("PUT", "/api/settings", { baseUrl: url, token: FAKE_TOKEN, notifications: false })).status).toBe(200);
    expect((await call("PUT", "/api/settings/jira", { baseUrl: jira?.url, token: JIRA_TOKEN })).status).toBe(200);
    const db = new Database(dbPath(join(root, "data"), url));
    let pr = 0;
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      pr = (db.query("INSERT INTO pull_request (project, repo, pr_id) VALUES ('PROJ', 'repo', 1) RETURNING id").get() as { id: number }).id;
      db.query("INSERT INTO pr_task (pr, key, source, url, ord) VALUES (?, ?, 'title', NULL, 0)").run(pr, ISSUE_KEY);
    } finally {
      db.close();
    }
    const res = await call("POST", `/api/prs/${pr}/task-context/${ISSUE_KEY}`);
    expect(res.status).toBe(200);
    const dto = (await res.json()) as TaskContextDto;
    // A failed conversion, or a worker that does not start, gives the fenced wiki text ("h3. Acceptance criteria") instead.
    expect(dto.format).toBe("markdown");
    expect(dto.description).toContain("### Acceptance criteria\n\n-   Batch the writes.");
    expect(dto.description).toContain("| Flush \\| now | Alex Smith |");
    expect(dto.comments.at(-1)?.body).toBe("QA: test with an empty cache too.\n\nClick \\[here\\](javascript:alert(2)) now.");
  });

  test("the task-rule preview runs in the worker and recovers after a ReDoS rule", async () => {
    const plain = { rules: [{ source: "branch", pattern: ID }], sample: { branch: "bugfix/ABC-10145-name-of-ticket" }, prs: [] };
    expect((await preview(plain)).sample).toEqual([{ key: "ABC-10145", source: "branch" }]);

    const t0 = performance.now();
    const redos = await preview({
      rules: [{ source: "description", pattern: "(a+)+$" }],
      sample: { description: `${"a".repeat(19_999)}!` },
      prs: [],
    });
    const ms = Math.round(performance.now() - t0);
    console.log(`ReDoS preview: ${ms} ms`);
    expect(redos.rules).toEqual([{ error: null, timedOut: true }]);
    expect(ms).toBeLessThan(1_500);

    expect((await preview(plain)).sample).toEqual([{ key: "ABC-10145", source: "branch" }]);
  });

  test("--git-mcp lists exactly the four git tools", async () => {
    const hash = "0".repeat(40);
    const client = new Client({ name: "compiled-test", version: "0" });
    await client.connect(
      new StdioClientTransport({
        command: BIN,
        args: ["--git-mcp", `--git-dir=${root}`, `--head=${hash}`, `--base=${hash}`, `--target=${hash}`],
        stderr: "pipe",
      }),
    );
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["git_blame", "git_diff", "git_log", "git_show"]);
    } finally {
      await client.close();
    }
  });

  // docs/plans/review-v2/spec.md section 6.14 through the bundled xstate machine (src/server/tasks/machine.ts): the Bun support proof.
  test(
    "a restart stops a task whose Claude step was running, with the bundled xstate machine",
    async () => {
      const url = fake?.url as string;
      expect((await call("PUT", "/api/settings", { baseUrl: url, token: FAKE_TOKEN, notifications: false })).status).toBe(200);
      // The first binary runs its restart recovery on the first use of the database, so a later row stays for the second binary.
      expect((await call("GET", "/api/runs")).status).toBe(200);
      const path = dbPath(join(root, "data"), url);
      const db = new Database(path);
      let task = 0;
      let run = 0;
      try {
        db.exec("PRAGMA busy_timeout = 5000");
        task = (
          db
            .query(`INSERT INTO task (project, repo, key, title, state, size, target_branch, spec_dir, version, created_at, updated_at)
            VALUES ('PROJ', 'repo', 'ABC-7', 'Task', 'implementing', 'small', 'main', 'specs/ABC-7/', 2, 1, 1) RETURNING id`)
            .get() as { id: number }
        ).id;
        run = (
          db
            .query(`INSERT INTO review_run (pr, task, kind, profile, note, idem_key, source_head, target_head, status, started_at)
            VALUES (NULL, ?, 'implement', 'general', '', 'bin-task-run', 'a', 'b', 'running', 1) RETURNING id`)
            .get(task) as { id: number }
        ).id;
        db.query("INSERT INTO task_step (task, ord, kind, run, state, started_at) VALUES (?, 1, 'implement', ?, 'running', 1)").run(
          task,
          run,
        );
      } finally {
        db.close();
      }
      const read = () => {
        const d = new Database(path, { readonly: true });
        try {
          return {
            task: d.query("SELECT state, stopped_from, version FROM task WHERE id = ?").get(task),
            run: d.query("SELECT status, error_kind FROM review_run WHERE id = ?").get(run),
            step: d.query("SELECT state FROM task_step WHERE run = ?").get(run),
          };
        } finally {
          d.close();
        }
      };
      const second = await launch();
      try {
        const end = Date.now() + 5_000;
        let got = read();
        while ((got.task as { state: string }).state !== "stopped" && Date.now() < end) {
          await Bun.sleep(50);
          got = read();
        }
        expect(got).toEqual({
          task: { state: "stopped", stopped_from: "implementing", version: 3 },
          run: { status: "failed", error_kind: "restart" },
          step: { state: "failed" },
        });
      } finally {
        second.proc.kill();
        await Promise.race([second.proc.exited, Bun.sleep(5_000)]);
      }
    },
    START_MS + 10_000,
  );
});
