// Starts, watches, and stops one Claude Code review process. The flags, env, and cwd rules come from integration-check.md, "Gate v3, local".
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { RunErrorKind, RunEvent, SDKResultMessage, SDKSystemMessage } from "../../shared/run-log";
import { log } from "../log";
import { RUNTIME_ENV } from "./git";
import { classify, createStreamParser } from "./stream";

// Gate B ran on this version. Older versions have other flags and event shapes.
export const MIN_CLI_VERSION = "2.1.295";
export const MAIN_AGENT = "rl-main";
const READ_TOOLS = ["Read", "Grep", "Glob"];
// Names go into comma lists of CLI flags.
export const NAME = /^[A-Za-z0-9_-]+$/;
const STDERR_TAIL = 16_384;
const EXEC_TIMEOUT_MS = 30_000;
const DRAIN_TIMEOUT_MS = 5_000;
const RUN_TIMEOUT_MS = 60 * 60_000;

export type AgentSpec = { description: string; prompt: string };
// tools: the tool names the server offers, without the mcp__<server>__ prefix. A remote server gets no headers or credentials.
export type StdioServerSpec = { command: string; args: string[]; tools: string[] };
export type McpServerSpec = StdioServerSpec | { type: "http"; url: string; tools: string[] };
export type RunSpec = {
  // The work folder. The runner uses its long path.
  cwd: string;
  // The runner writes mcp.json and agents.json here. It must be outside cwd.
  appDir: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTurns: number;
  main: AgentSpec;
  // Review subagents, by name. rl-main can call only these.
  agents: Record<string, AgentSpec>;
  mcpServers: Record<string, McpServerSpec>;
};

export type RunnerCheck =
  | { ok: true; command: string[]; version: string; projectsDir: string }
  | { ok: false; kind: "unavailable" | "auth"; message: string };

export type RunOutcome = {
  status: "completed" | "failed" | "cancelled";
  kind: RunErrorKind | null;
  text: string | null;
  // completed: the result that carries structured_output.
  result: SDKResultMessage | null;
  init: SDKSystemMessage | null;
  events: RunEvent[];
  exitCode: number | null;
  stderrTail: string;
};

export type RunnerOptions = {
  // The CLI argv prefix. Default: `claude` on PATH. Tests pass the fake CLI.
  command?: string[];
  timeoutMs?: number;
};

// Gate B: ANTHROPIC_* selects API billing. CLAUDECODE, CLAUDE_PID, and CLAUDE_CODE_* mark a nested session.
// The git MCP child gets this env through the CLI. mcp.json sets no env for it.
export function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    // Windows env names ignore case.
    const K = process.platform === "win32" ? k.toUpperCase() : k;
    if (v === undefined || K === "ANTHROPIC_API_KEY" || K === "ANTHROPIC_AUTH_TOKEN" || K === "CLAUDECODE" || K === "CLAUDE_PID") continue;
    if (K.startsWith("CLAUDE_CODE_") || RUNTIME_ENV.test(K)) continue;
    env[k] = v;
  }
  // Gate B3: with this switch, subagents run in the foreground and the run sends one result event.
  env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = "1";
  return env;
}

function older(v: string, min: string) {
  const a = v.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}

async function exec(argv: string[], env: Record<string, string>) {
  try {
    const p = Bun.spawn(argv, { env, stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: EXEC_TIMEOUT_MS, killSignal: "SIGKILL" });
    const out = await new Response(p.stdout).text();
    return { code: await p.exited, out };
  } catch {
    return { code: -1, out: "" };
  }
}

// TS 5.9 types ReadableStream without an async iterator.
async function readText(stream: ReadableStream<Uint8Array>, each: (text: string) => void) {
  const r = stream.getReader();
  const dec = new TextDecoder();
  for (let c = await r.read(); !c.done; c = await r.read()) each(dec.decode(c.value, { stream: true }));
  each(dec.decode());
}

async function killTree(pid: number) {
  // Gate 0 g: taskkill /T ends claude.exe and its MCP children.
  if (process.platform === "win32")
    await Bun.spawn(["taskkill", "/T", "/F", "/PID", String(pid)], { stdout: "ignore", stderr: "ignore", timeout: EXEC_TIMEOUT_MS }).exited;
  else
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
}

// Gate B4: --no-session-persistence still writes these per-cwd folders. Their name is the cwd with each non-alphanumeric character replaced by "-".
function removeCwdFolders(cwd: string, projectsDir: string) {
  const name = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  for (const dir of [join(projectsDir, name), join(tmpdir(), "claude", name)])
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch (e) {
      log(`Could not delete a Claude Code session folder: ${(e as Error).message}`);
    }
}

// Writes the MCP and agents files and returns the CLI arguments and the init tool allowlist.
function prepare(spec: RunSpec) {
  const reviewers = Object.keys(spec.agents);
  const servers = Object.entries(spec.mcpServers);
  for (const n of [...reviewers, ...servers.flatMap(([s, c]) => [s, ...c.tools])])
    if (!NAME.test(n)) throw new Error(`Invalid agent, server, or tool name: ${n}`);
  if (reviewers.includes(MAIN_AGENT)) throw new Error(`${MAIN_AGENT} cannot be a review agent.`);
  for (const [s, c] of servers)
    if ("url" in c && new URL(c.url).protocol !== "https:") throw new Error(`MCP server ${s} needs an https URL.`);

  // Gate B9: agent tool lists need full MCP tool names. --allowedTools needs mcp__<server>; a wildcard does not work.
  const mcpTools = servers.flatMap(([s, c]) => c.tools.map((t) => `mcp__${s}__${t}`));
  const readTools = [...READ_TOOLS, ...mcpTools];
  const agentTool = reviewers.length ? [`Agent(${reviewers.join(", ")})`] : [];
  mkdirSync(spec.appDir, { recursive: true });
  const mcpFile = join(spec.appDir, "mcp.json");
  writeFileSync(
    mcpFile,
    // code.claude.com/docs/en/mcp: a remote entry needs "type": "http"; without it the CLI reads the entry as stdio.
    JSON.stringify({
      mcpServers: Object.fromEntries(
        servers.map(([s, c]) => [s, "url" in c ? { type: "http", url: c.url } : { command: c.command, args: c.args }]),
      ),
    }),
  );
  const agentsFile = join(spec.appDir, "agents.json");
  // Gate B9: without StructuredOutput in the rl-main tools, no result carries structured_output.
  const agents = {
    [MAIN_AGENT]: { ...spec.main, tools: [...agentTool, ...readTools, "StructuredOutput"] },
    ...Object.fromEntries(
      reviewers.map((n) => [
        n,
        {
          ...spec.agents[n],
          tools: readTools,
          disallowedTools: ["Bash", "PowerShell", "Write", "Edit", "NotebookEdit", "Agent"],
          omitClaudeMd: true,
        },
      ]),
    ),
  };
  writeFileSync(agentsFile, JSON.stringify(agents));

  // Never --bare: it breaks the subscription login. Never --permission-mode: 2.1.295 has no "default" choice.
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--restricted",
    "--strict-mcp-config",
    "--mcp-config",
    mcpFile,
    "--tools",
    [...READ_TOOLS, ...(reviewers.length ? ["Agent"] : [])].join(","),
    "--allowedTools",
    [...READ_TOOLS, ...servers.map(([s]) => `mcp__${s}`)].join(","),
    "--agents",
    agentsFile,
    "--agent",
    MAIN_AGENT,
    "--json-schema",
    JSON.stringify(spec.schema),
    "--max-turns",
    String(spec.maxTurns),
    "--no-session-persistence",
  ];
  const allowed = new Set([...readTools, "StructuredOutput", ...(reviewers.length ? ["Agent", "Task"] : [])]);
  return { args, allowed };
}

export function createClaudeRunner(opts: RunnerOptions = {}) {
  let active: { cancelled: boolean; pid?: number } | undefined;

  // Finds the CLI, checks its version, and runs `claude auth status`. It starts no model call.
  async function check(): Promise<RunnerCheck> {
    const unavailable = (message: string): RunnerCheck => ({ ok: false, kind: "unavailable", message });
    const found = opts.command ? undefined : Bun.which("claude");
    const command = opts.command ?? (found ? [found] : undefined);
    if (!command?.[0]) return unavailable("Claude Code is not on PATH.");
    // Gate 0: the native claude.exe. A .cmd shim runs through cmd.exe, which parses the arguments again.
    if (process.platform === "win32" && !command[0].toLowerCase().endsWith(".exe"))
      return unavailable(`${basename(command[0])} is not the native claude.exe.`);
    const env = childEnv();
    const v = await exec([...command, "--version"], env);
    const version = v.out.match(/\d+\.\d+\.\d+/)?.[0];
    if (v.code !== 0 || !version) return unavailable("claude --version failed.");
    if (older(version, MIN_CLI_VERSION)) return unavailable(`Claude Code ${version} is older than ${MIN_CLI_VERSION}.`);

    const a = await exec([...command, "auth", "status"], env);
    let auth: Record<string, unknown> = {};
    try {
      const j = JSON.parse(a.out);
      if (j && typeof j === "object") auth = j;
    } catch {}
    // The output holds account data. Log only authMethod.
    log(`claude auth status: authMethod=${String(auth.authMethod)}`);
    if (a.code !== 0 || auth.authMethod !== "claude.ai")
      return { ok: false, kind: "auth", message: `authMethod is ${String(auth.authMethod)}. Review needs the claude.ai login.` };
    const configDir =
      typeof auth.configDirectory === "string" ? auth.configDirectory : (env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"));
    const projectsDir = typeof auth.projectsDirectory === "string" ? auth.projectsDirectory : join(configDir, "projects");
    return { ok: true, command, version, projectsDir };
  }

  // Runs one review. onEvents gets each new or changed run_event. Only one run is active at a time.
  async function run(spec: RunSpec, onEvents: (events: RunEvent[]) => void = () => {}): Promise<RunOutcome> {
    if (active) throw new Error("A review run is active.");
    const self: { cancelled: boolean; pid?: number } = { cancelled: false };
    active = self;
    const empty = (status: RunOutcome["status"], kind: RunErrorKind | null, text: string | null): RunOutcome => ({
      status,
      kind,
      text,
      result: null,
      init: null,
      events: [],
      exitCode: null,
      stderrTail: "",
    });
    let cwd: string | undefined;
    let projectsDir: string | undefined;
    let proc: { exitCode: number | null; exited: Promise<number> } | undefined;
    try {
      const c = await check();
      if (!c.ok) return empty("failed", c.kind === "auth" ? "auth" : "process", c.message);
      if (self.cancelled) return empty("cancelled", null, null);
      // Gate B9: an 8.3 short cwd makes the CLI refuse Reads inside it.
      cwd = realpathSync.native(spec.cwd);
      projectsDir = c.projectsDir;
      const { args, allowed } = prepare(spec);
      const parser = createStreamParser({ cwd, allowedTools: allowed });
      const p = Bun.spawn([...c.command, ...args], {
        cwd,
        env: childEnv(),
        stdin: new Blob([spec.prompt]),
        stdout: "pipe",
        stderr: "pipe",
        // POSIX: a new process group, so one kill ends the CLI and its MCP children.
        detached: process.platform !== "win32",
      });
      proc = p;
      self.pid = p.pid;

      let stopped = false;
      let error: unknown;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        void killTree(p.pid);
      }, opts.timeoutMs ?? RUN_TIMEOUT_MS);
      const handle = (line: string) => {
        if (stopped || self.cancelled || !line.trim()) return;
        const changed = parser.line(line);
        if (parser.state.badTools.length) {
          stopped = true;
          void killTree(p.pid);
          return;
        }
        if (changed.length) onEvents(changed);
      };
      let buf = "";
      const out = readText(p.stdout, (text) => {
        buf += text;
        for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
          handle(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      })
        .then(() => handle(buf))
        .catch((e) => {
          error ??= e;
          stopped = true;
          void killTree(p.pid);
        });
      let stderr = "";
      const err = readText(p.stderr, (text) => {
        stderr = (stderr + text).slice(-STDERR_TAIL);
      }).catch(() => {});

      const exitCode = await p.exited;
      clearTimeout(timer);
      // A leftover child can hold the pipes open. It must not block the run.
      await Promise.race([Promise.all([out, err]), Bun.sleep(DRAIN_TIMEOUT_MS)]);
      stopped = true;
      if (error) throw error;
      const tail = parser.stop();
      if (tail.length) onEvents(tail);
      const verdict = classify(parser.state, { exitCode, cancelled: self.cancelled, timedOut });
      return { ...verdict, init: parser.state.inits[0] ?? null, events: parser.events(), exitCode, stderrTail: stderr };
    } finally {
      if (proc && proc.exitCode === null && self.pid !== undefined) {
        await killTree(self.pid);
        await Promise.race([proc.exited, Bun.sleep(DRAIN_TIMEOUT_MS)]);
      }
      if (cwd && projectsDir) removeCwdFolders(cwd, projectsDir);
      active = undefined;
    }
  }

  // Cancels the active run. The run then ends with status cancelled.
  function cancel(): boolean {
    if (!active) return false;
    active.cancelled = true;
    if (active.pid !== undefined) void killTree(active.pid);
    return true;
  }

  return { check, run, cancel };
}

export type ReviewRunner = ReturnType<typeof createClaudeRunner>;
