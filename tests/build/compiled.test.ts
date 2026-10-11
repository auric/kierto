// Checks the binary of `bun run compile` for this host. It skips when the binary is absent.
// It fails when an input of the compile is newer than the binary.
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { binPath, HOST } from "../../scripts/compile";
import { dbPath } from "../../src/server/config";
import { openDb } from "../../src/server/storage/db";
import type { TaskContextDto, TaskPreviewDto } from "../../src/shared/dto";
import { FAKE_TOKEN, key, startFakeBitbucket } from "../support/fake-bitbucket";
import { ISSUE_KEY, JIRA_TOKEN, startFakeJira } from "../support/fake-jira";
import { DASHBOARD_PATH, onePage } from "../support/scenarios";

const BIN = binPath(HOST);
const ROOT = join(import.meta.dir, "../..");
const WEB = join(ROOT, "dist/web");
// `bun run compile` builds dist/web from these and embeds it. A dist/web rebuild from the same inputs gives the same assets.
const INPUTS = ["src", "index.html", "vite.config.ts", "tsconfig.json", "package.json", "bun.lock", "scripts/compile.ts"];
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
  let session = "";

  beforeAll(async () => {
    const stale = newerInput();
    if (stale) throw new Error(`The binary is older than ${stale}: rebuild with bun run compile.`);
    root = mkdtempSync(join(tmpdir(), "rl-bin-"));
    fake = startFakeBitbucket({ routes: { [key("GET", DASHBOARD_PATH)]: { status: 200, body: onePage([]) } } });
    jira = startFakeJira();
    // An empty PATH keeps the real claude CLI out of the start-up runner check. Windows spells the name "Path".
    const emptyPath = join(root, "path");
    mkdirSync(emptyPath);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env))
      if (v !== undefined && k.toUpperCase() !== "PATH" && !k.startsWith("REVIEW_LOOP_")) env[k] = v;
    Object.assign(env, { PATH: emptyPath, REVIEW_LOOP_PORT: "0", REVIEW_LOOP_DATA_DIR: join(root, "data"), REVIEW_LOOP_SECRETS: "memory" });
    const p = Bun.spawn([BIN], { cwd: root, env, stdin: "ignore", stdout: "pipe", stderr: "inherit" });
    proc = p;

    let out = "";
    const stdout = p.stdout.getReader();
    const decoder = new TextDecoder();
    const started = (async () => {
      for (;;) {
        const { done, value } = await stdout.read();
        if (done) return null;
        out += decoder.decode(value, { stream: true });
        const m = /Review Loop \(([^)]+)\): (http:\/\/127\.0\.0\.1:\d+)\//.exec(out);
        if (m) return m;
      }
    })();
    const m = await Promise.race([started, p.exited.then(() => null), Bun.sleep(START_MS - 5_000).then(() => null)]);
    if (!m) throw new Error(`The binary did not start. Output:\n${out}`);
    origin = m[2] as string;
    console.log(`Binary: ${BIN}\nModified: ${statSync(BIN).mtime.toISOString()}\nBuild commit: ${m[1]}\nURL: ${origin}`);
    // Keep the pipe drained, so that a log line never blocks the binary.
    void (async () => {
      while (!(await stdout.read()).done);
    })().catch(() => {});
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

  test("a task fetch converts the Jira HTML to Markdown with the bundled turndown", async () => {
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
    // A failed conversion gives the fenced wiki text ("h3. Acceptance criteria") instead.
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
});
