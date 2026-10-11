import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { git, gitEnv } from "../../src/server/review/git";
import { GIT_MCP_TOOLS, gitMcpServer, MAX_OUTPUT } from "../../src/server/review/git-mcp";

const MAIN = resolve(import.meta.dir, "../../src/server/main.ts");
const SLOW = 60_000;

let root = "";
let cache = "";
let client: Client;
const c = { c1: "", c2: "", c3: "", c4: "", c5: "" };

// A bare repository like the WP6 cache. Commits go through a temp index.
// c1 -> c2 (target); c1 -> c3 -> c4 (head); c1 -> c5 (side, unrelated to both pins). The merge base is c1.
async function fixture() {
  root = mkdtempSync(join(tmpdir(), "rl-wp7-"));
  cache = join(root, "cache.git");
  const empty = join(root, "empty.gitconfig");
  writeFileSync(empty, "");
  const env = {
    ...gitEnv(empty),
    GIT_AUTHOR_NAME: "Ann",
    GIT_AUTHOR_EMAIL: "ann@example.invalid",
    GIT_COMMITTER_NAME: "Ann",
    GIT_COMMITTER_EMAIL: "ann@example.invalid",
    GIT_INDEX_FILE: join(root, "author.index"),
  };
  const g = async (args: string[], stdin?: string) => (await git([`--git-dir=${cache}`, ...args], { env, stdin })).trim();
  await git(["init", "-q", "--bare", "--template=", cache], { env });
  let n = 0;
  const commit = async (parent: string | null, files: Record<string, string>, msg: string) => {
    await g(parent ? ["read-tree", parent] : ["read-tree", "--empty"]);
    for (const [path, body] of Object.entries(files)) {
      const f = join(root, `blob-${n++}`);
      writeFileSync(f, body);
      const sha = await g(["hash-object", "-w", "--no-filters", f]);
      await g(["update-index", "--add", "--cacheinfo", `100644,${sha},${path}`]);
    }
    return g(["commit-tree", await g(["write-tree"]), ...(parent ? ["-p", parent] : []), "-m", msg]);
  };
  const big = `${"x".repeat(99)}\n`.repeat(4000);
  c.c1 = await commit(null, { "a.txt": "one\ntwo\nthree\n", "big.txt": big }, "first commit");
  c.c2 = await commit(c.c1, { "a.txt": "one\ntwo\nthree\nfour\n" }, "target change");
  c.c3 = await commit(c.c1, { "src/b.txt": "bee\n" }, "add bee");
  c.c4 = await commit(c.c3, { "a.txt": "one\nTWO\nthree\n" }, "shout two");
  c.c5 = await commit(c.c1, { "side.txt": "side\n" }, "side work");
  await g(["update-ref", "refs/rl/1/source", c.c4]);
  await g(["update-ref", "refs/rl/1/target", c.c2]);
  await g(["update-ref", "refs/heads/side", c.c5]);
  rmSync(join(root, "author.index"));
}

// Every file under refs, objects, and the config files, by relative path.
function snapshot() {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(cache, p)] = readFileSync(p).toString("base64");
    }
  };
  walk(join(cache, "refs"));
  walk(join(cache, "objects"));
  for (const f of ["config", "packed-refs", "HEAD"]) {
    try {
      out[f] = readFileSync(join(cache, f)).toString("base64");
    } catch {}
  }
  return out;
}

let before: Record<string, string> = {};

beforeAll(async () => {
  await fixture();
  before = snapshot();
  const spec = gitMcpServer({ cache, sourceHead: c.c4, rangeBase: c.c1, targetHead: c.c2 }, MAIN);
  client = new Client({ name: "wp7-test", version: "0" });
  await client.connect(new StdioClientTransport({ command: spec.command, args: spec.args, stderr: "pipe" }));
}, SLOW);

afterAll(async () => {
  await client?.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

type Result = { isError?: boolean; content: { type: string; text: string }[] };
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as Result;
const ok = async (name: string, args: Record<string, unknown>) => {
  const r = await call(name, args);
  expect(r.isError, r.content[0]?.text).toBeFalsy();
  return r.content[0]?.text ?? "";
};
const refused = async (name: string, args: Record<string, unknown>) => {
  const r = await call(name, args);
  expect(r.isError).toBe(true);
  return r.content[0]?.text ?? "";
};

describe("git MCP server", () => {
  test("the RunSpec entry names the server command and the four tools", () => {
    const spec = gitMcpServer({ cache, sourceHead: c.c4, rangeBase: c.c1, targetHead: c.c2 }, MAIN);
    expect(spec.command).toBe(process.execPath);
    expect(spec.args.slice(0, 3)).toEqual([MAIN, "--git-mcp", `--git-dir=${cache}`]);
    expect(spec.tools).toEqual(GIT_MCP_TOOLS);
  });

  test("offers exactly the four read-only tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["git_blame", "git_diff", "git_log", "git_show"]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
  });

  test("git_log lists the head history and the PR commits", async () => {
    const all = await ok("git_log", {});
    for (const h of [c.c4, c.c3, c.c1]) expect(all).toContain(h);
    expect(all).not.toContain(c.c2);
    const pr = await ok("git_log", { since: "BASE" });
    expect(pr).toContain(c.c4);
    expect(pr).toContain(c.c3);
    expect(pr).not.toContain(c.c1);
    expect(await ok("git_log", { rev: "TARGET", path: "a.txt", max_count: 1 })).toContain("target change");
    await refused("git_log", { max_count: 201 });
  });

  test("git_blame names the commit of each line", async () => {
    const out = await ok("git_blame", { path: "a.txt" });
    const lines = out.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain(c.c1.slice(0, 39));
    expect(lines[1]).toStartWith(c.c4);
    expect(await ok("git_blame", { path: "a.txt", start_line: 2, max_lines: 1 })).toContain("TWO");
    await refused("git_blame", { path: "a.txt", max_lines: 401 });
  });

  test("git_show shows a commit and a file at a commit", async () => {
    const commit = await ok("git_show", { rev: c.c3.slice(0, 7) });
    expect(commit).toContain("add bee");
    expect(commit).toContain("+bee");
    expect(await ok("git_show", { rev: "HEAD", path: "src/b.txt" })).toBe("bee\n");
  });

  test("git_diff shows the PR changes", async () => {
    const out = await ok("git_diff", {});
    expect(out).toContain("+TWO");
    expect(out).toContain("src/b.txt");
    expect(await ok("git_diff", { from: "BASE", to: "TARGET", stat_only: true })).toContain("a.txt");
  });

  test("refuses options, traversal, refs, and commits outside the pinned history", async () => {
    for (const bad of ["--output=x", "-c", "-p", "HEAD~1", "refs/rl/1/source", "side", "main"]) {
      await refused("git_show", { rev: bad });
      await refused("git_diff", { from: bad });
    }
    for (const bad of ["--output=x", "-c", "../x", "src/../../x", "..", "/etc/passwd", "C:/x", "C:x", "\\\\host\\share"]) {
      await refused("git_show", { rev: "HEAD", path: bad });
      await refused("git_blame", { path: bad });
      await refused("git_log", { path: bad });
    }
    expect(await refused("git_show", { rev: c.c5 })).toContain("not in the history");
    expect(await refused("git_log", { rev: c.c5.slice(0, 8) })).toContain("not in the history");
    await refused("git_log", { rev: "HEAD", extra: "--output=x" });
    // TARGET history is allowed.
    expect(await ok("git_show", { rev: c.c2 })).toContain("target change");
  });

  test("caps the output with a marker", async () => {
    const out = await ok("git_show", { rev: "BASE", path: "big.txt" });
    expect(out).toContain("[truncated");
    expect(Buffer.byteLength(out)).toBeLessThan(MAX_OUTPUT + 200);
  });

  test("leaves refs, objects, and config byte-equal", () => {
    expect(snapshot()).toEqual(before);
  });
});

test("gitEnv drops Bun and Node runtime flags from every git child", () => {
  const set = { BUN_BE_BUN: "1", BUN_OPTIONS: "--smol", NODE_OPTIONS: "--inspect", RL_KEEP_ME: "kept" };
  const saved = Object.fromEntries(Object.keys(set).map((k) => [k, process.env[k]]));
  Object.assign(process.env, set);
  try {
    for (const env of [gitEnv("/dev/null"), gitEnv("/dev/null", [["http.extraHeader", "x"]])]) {
      const keys = Object.keys(env).map((k) => k.toUpperCase());
      for (const k of ["BUN_BE_BUN", "BUN_OPTIONS", "NODE_OPTIONS"]) expect(keys).not.toContain(k);
      expect(env.RL_KEEP_ME).toBe("kept");
    }
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
