// Read-only git MCP server over stdio (plan v3 WP7). It reads the cache clone with --git-dir and never runs git inside the worktree.
import { isAbsolute, win32 } from "node:path";
import { parseArgs } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { StdioServerSpec } from "./claude";
import { GitError, git, gitEnv } from "./git";
import type { Workspace } from "./workspace";

export const GIT_MCP_TOOLS = ["git_log", "git_blame", "git_show", "git_diff"];
export const MAX_COMMITS = 200;
export const MAX_BLAME_LINES = 400;
export const MAX_OUTPUT = 256 * 1024;
const FULL = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
// Pathspec magic stays off (--literal-pathspecs). "-" would read as an option.
const CONTROL = /\p{Cc}/u;
// --no-optional-locks: a read never writes the index or other optional files.
const GLOBAL = ["--no-pager", "--no-optional-locks", "--literal-pathspecs"];
const NO_DIFF_HELPERS = ["--no-ext-diff", "--no-textconv"];

type Pins = { gitDir: string; head: string; base: string; target: string };

// The RunSpec.mcpServers entry for one workspace. entry is the script that main.ts runs; a compiled binary ignores it (U13).
export function gitMcpServer(ws: Pick<Workspace, "cache" | "sourceHead" | "mergeBase" | "targetHead">, entry = Bun.main): StdioServerSpec {
  return {
    command: process.execPath,
    args: [entry, "--git-mcp", `--git-dir=${ws.cache}`, `--head=${ws.sourceHead}`, `--base=${ws.mergeBase}`, `--target=${ws.targetHead}`],
    tools: [...GIT_MCP_TOOLS],
  };
}

const rev = z
  .string()
  .regex(/^(?:[0-9a-f]{4,40}|[0-9a-f]{64}|HEAD|BASE|TARGET)$/, "Use a hex commit hash (4 to 40 characters) or HEAD, BASE, or TARGET.")
  .describe("A commit: a hex hash, or HEAD (PR source head), BASE (merge base), or TARGET (target branch head).");

const path = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (p) =>
      !p.startsWith("-") &&
      !isAbsolute(p) &&
      !win32.isAbsolute(p) &&
      !/^[A-Za-z]:/.test(p) &&
      !CONTROL.test(p) &&
      !p.split(/[\\/]/).includes(".."),
    "Use a relative repository path without '..' that does not start with '-'.",
  )
  .describe("A file path relative to the repository root, with '/' separators.");

// Keeps at most MAX_OUTPUT bytes and adds a marker.
export function capOutput(out: string) {
  if (!out) return "(no output)";
  const b = Buffer.from(out);
  if (b.length <= MAX_OUTPUT) return out;
  return `${b.subarray(0, MAX_OUTPUT).toString()}\n[truncated: the output exceeds ${MAX_OUTPUT} bytes. Use a narrower path, range, or count.]`;
}

export function createGitMcp(pins: Pins) {
  const env = gitEnv("/dev/null");
  // ponytail: git() buffers the full stdout before the cap. Stream and kill at MAX_OUTPUT if memory becomes a problem.
  const run = (args: string[]) => git([...GLOBAL, `--git-dir=${pins.gitDir}`, ...args], { env, timeoutMs: 60_000 });
  const aliases: Record<string, string> = { HEAD: pins.head, BASE: pins.base, TARGET: pins.target };

  const isAncestor = async (a: string, b: string) => {
    try {
      await run(["merge-base", "--is-ancestor", "--end-of-options", a, b]);
      return true;
    } catch (e) {
      // merge-base --is-ancestor exits 1 for "no". git() reports it as "(exit 1)".
      if (e instanceof GitError && e.message.includes("(exit 1)")) return false;
      throw e;
    }
  };

  // Returns the full hash. The commit must be in the history of the pinned head or the pinned target.
  const resolve = async (r: string) => {
    const alias = aliases[r];
    if (alias) return alias;
    let hash = "";
    try {
      hash = (await run(["rev-parse", "--verify", "--quiet", "--end-of-options", `${r}^{commit}`])).trim();
    } catch {}
    if (!FULL.test(hash)) throw new Error(`Unknown or ambiguous commit: ${r}. Use a longer hash.`);
    if ((await isAncestor(hash, pins.head)) || (await isAncestor(hash, pins.target))) return hash;
    throw new Error(`Commit ${r} is not in the history of HEAD or TARGET.`);
  };

  const text = (out: string) => ({ content: [{ type: "text" as const, text: capOutput(out) }] });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const server = new McpServer({ name: "review-loop-git", version: "1.0.0" });

  server.registerTool(
    "git_log",
    {
      title: "Git log",
      description: `List commits reachable from a commit, newest first. One commit per entry: full hash, date, author, and subject. Set since to list only commits after it, for example since BASE to list the PR commits. Set path to list only commits that change that path. At most ${MAX_COMMITS} commits.`,
      inputSchema: z
        .object({
          rev: rev.default("HEAD"),
          since: rev.optional().describe("Leave out this commit and its history."),
          path: path.optional(),
          max_count: z.number().int().min(1).max(MAX_COMMITS).default(50),
        })
        .strict(),
      annotations,
    },
    async (a) => {
      const to = await resolve(a.rev);
      const range = a.since ? `${await resolve(a.since)}..${to}` : to;
      return text(
        await run([
          "log",
          "--no-color",
          ...NO_DIFF_HELPERS,
          `--max-count=${a.max_count}`,
          "--date=short",
          "--format=%H %ad %an%n    %s",
          "--end-of-options",
          range,
          "--",
          ...(a.path ? [a.path] : []),
        ]),
      );
    },
  );

  server.registerTool(
    "git_blame",
    {
      title: "Git blame",
      description: `Show the commit, author, and date of each line of a file at a commit. Lines start at start_line. At most ${MAX_BLAME_LINES} lines per call.`,
      inputSchema: z
        .object({
          path,
          rev: rev.default("HEAD"),
          start_line: z.number().int().min(1).default(1),
          max_lines: z.number().int().min(1).max(MAX_BLAME_LINES).default(MAX_BLAME_LINES),
        })
        .strict(),
      annotations,
    },
    async (a) =>
      // git 2.56 blame reads a "--" after --end-of-options as a revision. Path validation replaces it.
      text(
        await run([
          "blame",
          "--no-color-lines",
          "--no-color-by-age",
          ...NO_DIFF_HELPERS,
          "-l",
          "--date=short",
          "-L",
          `${a.start_line},+${a.max_lines}`,
          "--end-of-options",
          await resolve(a.rev),
          a.path,
        ]),
      ),
  );

  server.registerTool(
    "git_show",
    {
      title: "Git show",
      description:
        "Without path: show a commit with its message, a file summary, and its patch. With path: show the file content at that commit.",
      inputSchema: z.object({ rev, path: path.optional() }).strict(),
      annotations,
    },
    async (a) => {
      const hash = await resolve(a.rev);
      const opts = a.path ? [] : ["--format=fuller", "--stat", "--patch"];
      const object = a.path ? `${hash}:${a.path}` : hash;
      return text(await run(["show", "--no-color", ...NO_DIFF_HELPERS, ...opts, "--end-of-options", object, "--"]));
    },
  );

  server.registerTool(
    "git_diff",
    {
      title: "Git diff",
      description:
        "Show the diff between two commits. The default is BASE to HEAD, the PR changes. Set path to limit the diff to one path. Set stat_only for a file summary.",
      inputSchema: z
        .object({ from: rev.default("BASE"), to: rev.default("HEAD"), path: path.optional(), stat_only: z.boolean().default(false) })
        .strict(),
      annotations,
    },
    async (a) =>
      text(
        await run([
          "diff",
          "--no-color",
          ...NO_DIFF_HELPERS,
          "-M",
          a.stat_only ? "--stat" : "-U3",
          "--end-of-options",
          await resolve(a.from),
          await resolve(a.to),
          "--",
          ...(a.path ? [a.path] : []),
        ]),
      ),
  );

  return server;
}

// Entry for `--git-mcp`. args: the arguments after --git-mcp.
export async function runGitMcp(args: string[]) {
  const { values } = parseArgs({
    args,
    strict: true,
    options: { "git-dir": { type: "string" }, head: { type: "string" }, base: { type: "string" }, target: { type: "string" } },
  });
  const pins = { gitDir: values["git-dir"] ?? "", head: values.head ?? "", base: values.base ?? "", target: values.target ?? "" };
  if (!isAbsolute(pins.gitDir) || ![pins.head, pins.base, pins.target].every((h) => FULL.test(h))) {
    console.error("usage: --git-mcp --git-dir=<absolute path> --head=<hash> --base=<hash> --target=<hash>");
    process.exit(2);
  }
  await createGitMcp(pins).connect(new StdioServerTransport());
  process.stdin.on("end", () => process.exit(0));
}
