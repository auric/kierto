// MCP servers of the user's Claude config (user scope) for review profiles. Entries can hold secrets: no URL, header, command, args, or env value leaves this module except into the run's mcp.json.
import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpPick, McpServerDto, McpToolDto } from "../../shared/dto";
import { DOC_SERVERS, GIT_SERVER } from "./catalog";
import { childEnv, killTree, NAME, type UserMcpEntry, type UserServerSpec } from "./claude";

const LIST_TIMEOUT_MS = 10_000;
const MAX_PAGES = 10;
const MAX_DESCRIPTION = 500;
// The app's own servers keep these names.
const RESERVED = new Set([GIT_SERVER, ...Object.keys(DOC_SERVERS)]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Claude Code 2.1.x (getGlobalClaudeFile): <config home>/.config.json when it exists, else .claude.json in CLAUDE_CONFIG_DIR or the home folder.
// configDir: CLAUDE_CONFIG_DIR. The child env of the CLI keeps it.
export function claudeJsonPath(configDir = process.env.CLAUDE_CONFIG_DIR) {
  const legacy = join(configDir || join(homedir(), ".claude"), ".config.json");
  return existsSync(legacy) ? legacy : join(configDir || homedir(), ".claude.json");
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): Record<string, string> | null =>
  v === undefined ? {} : record(v) && Object.values(v).every((x) => typeof x === "string") ? (v as Record<string, string>) : null;

// A remote server needs https. Plain http stays on this machine.
function remoteUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK.has(u.hostname)) ? v : null;
  } catch {
    return null;
  }
}

// Keeps only the fields that the CLI needs to start the server. null: the entry is not usable.
function entryOf(v: unknown): UserMcpEntry | null {
  if (!record(v)) return null;
  const type = v.type ?? "stdio";
  if (type === "stdio") {
    const args = v.args ?? [];
    const env = strings(v.env);
    if (typeof v.command !== "string" || !v.command || !Array.isArray(args) || !args.every((a) => typeof a === "string") || !env)
      return null;
    return { type, command: v.command, args, env };
  }
  if (type === "http" || type === "sse") {
    const url = remoteUrl(v.url);
    const headers = strings(v.headers);
    return url && headers ? { type, url, headers } : null;
  }
  return null;
}

// The top-level mcpServers of the config file. Reads the disk on each call. A missing file or bad JSON gives no servers, never an error.
export function readUserServers(file = claudeJsonPath()): Map<string, UserMcpEntry> {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return new Map();
  }
  const servers = record(json) && record(json.mcpServers) ? json.mcpServers : {};
  const out = new Map<string, UserMcpEntry>();
  for (const [name, v] of Object.entries(servers)) {
    const e = NAME.test(name) && !RESERVED.has(name) ? entryOf(v) : null;
    if (e) out.set(name, e);
  }
  return out;
}

export const discoverMcpServers = (file = claudeJsonPath()): McpServerDto[] =>
  [...readUserServers(file)].map(([name, e]) => ({ name, transport: e.type, source: "user" }));

// code.claude.com/docs/en/mcp, "Environment variable expansion": ${VAR} and ${VAR:-default}. The run's CLI expands the copied entry itself.
const expand = (s: string, env: Record<string, string>) =>
  s.replace(/\$\{([^}:]+)(?::-([^}]*))?\}/g, (m, k: string, d?: string) => env[k] ?? d ?? m);
const expandAll = (o: Record<string, string>, env: Record<string, string>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, expand(v, env)]));

// A failure with a message that holds no URL, header, or command text.
export class McpListError extends Error {
  override name = "McpListError";
}

function safeError(e: unknown): McpListError {
  const err = e as { code?: unknown; name?: unknown };
  // McpError RequestTimeout is -32001. AbortSignal.timeout gives a TimeoutError. The SDK HTTP errors carry the HTTP status as code.
  if (err?.code === -32001 || err?.name === "TimeoutError") return new McpListError(`no answer in ${LIST_TIMEOUT_MS / 1000} s`);
  if (err?.code === "ENOENT") return new McpListError("the command was not found");
  if (typeof err?.code === "number" && err.code >= 400 && err.code < 600) return new McpListError(`HTTP ${err.code}`);
  return new McpListError("the server did not start or did not answer");
}

export type ListUserTools = (entry: UserMcpEntry) => Promise<McpToolDto[]>;

// Starts or calls one server and runs tools/list. Tool names that the CLI flags cannot hold are dropped.
export const listUserTools: ListUserTools = async (entry) => {
  const env = childEnv();
  let transport: Transport;
  let stdio: StdioClientTransport | null = null;
  if (entry.type === "stdio") {
    stdio = new StdioClientTransport({
      command: expand(entry.command, env),
      args: entry.args.map((a) => expand(a, env)),
      env: { ...env, ...expandAll(entry.env, env) },
      // The CLI starts the server in the run folder. Discovery has no run folder.
      cwd: tmpdir(),
      stderr: "ignore",
    });
    transport = stdio;
  } else {
    const url = new URL(expand(entry.url, env));
    const requestInit = { headers: expandAll(entry.headers, env) };
    transport =
      entry.type === "http" ? new StreamableHTTPClientTransport(url, { requestInit }) : new SSEClientTransport(url, { requestInit });
  }
  const client = new Client({ name: "review-loop", version: "1" });
  const timer = AbortSignal.timeout(LIST_TIMEOUT_MS);
  try {
    await client.connect(transport, { timeout: LIST_TIMEOUT_MS, signal: timer });
    const out: McpToolDto[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const r = await client.listTools(cursor ? { cursor } : undefined, { timeout: LIST_TIMEOUT_MS, signal: timer });
      for (const t of r.tools)
        if (NAME.test(t.name))
          out.push({
            name: t.name,
            description: (t.description ?? "").slice(0, MAX_DESCRIPTION),
            readOnlyHint: typeof t.annotations?.readOnlyHint === "boolean" ? t.annotations.readOnlyHint : null,
          });
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    return out;
  } catch (e) {
    throw safeError(e);
  } finally {
    // A command such as npx starts child processes. On Windows only taskkill /T ends the tree. It runs first, so the PID is not reused yet.
    const pid = stdio?.pid;
    if (pid && process.platform === "win32") await killTree(pid).catch(() => {});
    await client.close().catch(() => {});
  }
};

// The servers of the run for the profile picks. It re-reads the config, so a run gets the current entries.
// gaps: one line for each picked server or tool that the run does not get. A pick with no tools is skipped.
export async function userServers(
  picks: McpPick[],
  file = claudeJsonPath(),
  list: ListUserTools = listUserTools,
): Promise<{ servers: Record<string, UserServerSpec>; gaps: string[] }> {
  const servers: Record<string, UserServerSpec> = {};
  const gaps: string[] = [];
  const used = picks.filter((p) => p.tools.length);
  if (!used.length) return { servers, gaps };
  const config = readUserServers(file);
  const found = await Promise.allSettled(
    used.map(async (p) => {
      const user = config.get(p.server);
      return user ? { user, tools: (await list(user)).map((t) => t.name) } : null;
    }),
  );
  used.forEach((p, i) => {
    const r = found[i] as PromiseSettledResult<{ user: UserMcpEntry; tools: string[] } | null>;
    if (r.status === "rejected") {
      gaps.push(`MCP server ${p.server}: unavailable (${r.reason instanceof McpListError ? r.reason.message : "error"})`);
      return;
    }
    if (!r.value) {
      gaps.push(`MCP server ${p.server}: not found in the Claude config`);
      return;
    }
    const { user, tools } = r.value;
    for (const t of p.tools) if (!tools.includes(t)) gaps.push(`MCP tool ${p.server}/${t}: not found`);
    const chosen = p.tools.filter((t) => tools.includes(t));
    if (chosen.length) servers[p.server] = { user, tools: chosen, deny: tools.filter((t) => !chosen.includes(t)) };
  });
  return { servers, gaps };
}
