// Fake `claude` CLI for tests. It replays a recorded stream-json fixture and never calls a model.
// Usage: bun tests/support/fake-claude.ts <scenario.json> <claude arguments>
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type FakeScenario = {
  // Each call appends one JSON line: { argv, env, cwd, stdin, pid }. A hang run adds { childPid }.
  record: string;
  version?: string;
  // The `auth status` JSON. projectsDirectory also receives the per-cwd session folder.
  auth: Record<string, unknown>;
  authExit?: number;
  fixture?: string;
  delayMs?: number;
  exitCode?: number;
  stderr?: string;
  // Start a child that ignores stdin EOF, stop before the first result event, and wait forever.
  hang?: boolean;
  // Reply runs only: the structured_output of the result. Absent: echoReplies() of the stdin.
  replies?: unknown;
};

const CHILD = "process.stdin.on('end', () => {}); process.stdin.resume(); setInterval(() => {}, 1000);";

// A reply result for each thread of the stdin "Threads:" line. Every third thread gets action none.
export function echoReplies(stdin: string) {
  const line = /^Threads: (.*)$/m.exec(stdin)?.[1] ?? "";
  const threads = [...line.matchAll(/(\d+) \(answer message (\d+)\)/g)].map((m) => ({ thread: Number(m[1]), replyTo: Number(m[2]) }));
  return {
    summary: `Drafted replies for ${threads.length} threads.`,
    replies: threads.map(({ thread, replyTo }, i) =>
      i % 3 === 2
        ? { thread, action: "none", body: "", reason: "The thread needs no answer from you.", evidenceStatus: "unverified" }
        : {
            thread,
            action: "reply",
            body: `Thanks. I checked message ${replyTo} against \`flush()\` and will change it.`,
            reason: "The comment asks for a change.",
            evidenceStatus: "code",
          },
    ),
    coverage: { read: ["src/cache/flush.ts"], skipped: [], unavailable: [], notChecked: [] },
  };
}

async function main() {
  const [scenarioPath = "", ...args] = process.argv.slice(2);
  const s: FakeScenario = JSON.parse(readFileSync(scenarioPath, "utf8"));
  const record = (x: Record<string, unknown>) => appendFileSync(s.record, `${JSON.stringify(x)}\n`);
  const run = args.includes("-p");
  const stdin = run ? await Bun.stdin.text() : "";
  record({ argv: args, env: process.env, cwd: process.cwd(), stdin, pid: process.pid });

  if (args[0] === "--version") {
    console.log(s.version ?? "2.1.295 (Claude Code)");
    return;
  }
  if (args[0] === "auth" && args[1] === "status") {
    console.log(JSON.stringify(s.auth, null, 2));
    process.exitCode = s.authExit ?? 0;
    return;
  }
  if (!run || !s.fixture) {
    console.error(`fake-claude: no answer for ${args.join(" ")}`);
    process.exitCode = 2;
    return;
  }

  // Gate B4: 2.1.295 writes these per-cwd folders also with --no-session-persistence.
  const name = process.cwd().replace(/[^a-zA-Z0-9]/g, "-");
  const session = "00000000-0000-4000-8000-000000000001";
  const files = [join(tmpdir(), "claude", name, session, "tasks", "agent.output")];
  if (typeof s.auth.projectsDirectory === "string")
    files.push(join(s.auth.projectsDirectory, name, session, "subagents", "agent-a.meta.json"));
  for (const f of files) {
    mkdirSync(join(f, ".."), { recursive: true });
    writeFileSync(f, "{}");
  }

  if (s.hang) {
    const child = Bun.spawn([process.execPath, "-e", CHILD], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    child.stdin.end();
    record({ childPid: child.pid });
  }

  // A reply run: --json-schema has properties.replies. Its result carries the replies.
  const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const replyRun = JSON.parse(flag("--json-schema") ?? "null")?.properties?.replies !== undefined;
  const agentTool = (flag("--tools") ?? "").split(",").includes("Agent");
  const rewrite = (l: string) => {
    if (!replyRun) return l;
    const e = JSON.parse(l);
    // Gate B8: init lists the agent tool as Task. The real CLI lists it only when --tools names Agent.
    if (e.type === "system" && e.subtype === "init" && Array.isArray(e.tools) && !agentTool)
      return JSON.stringify({ ...e, tools: e.tools.filter((t: unknown) => t !== "Task") });
    if (e.type === "result") return JSON.stringify({ ...e, structured_output: s.replies ?? echoReplies(stdin) });
    return l;
  };

  // The fixture paths name the recorded cwd. Replace it with the real cwd.
  const lines = readFileSync(s.fixture, "utf8").split("\n").filter(Boolean).map(rewrite);
  const init = lines.map((l) => JSON.parse(l)).find((e) => e.type === "system" && e.subtype === "init");
  const esc = (p: string) => JSON.stringify(p).slice(1, -1);
  for (const l of lines) {
    if (s.hang && JSON.parse(l).type === "result") break;
    await Bun.write(Bun.stdout, `${typeof init?.cwd === "string" ? l.replaceAll(esc(init.cwd), esc(process.cwd())) : l}\n`);
    await Bun.sleep(s.delayMs ?? 2);
  }
  if (s.stderr) await Bun.write(Bun.stderr, s.stderr);
  if (s.hang) {
    setInterval(() => {}, 1000);
    return;
  }
  process.exitCode = s.exitCode ?? 0;
}

if (import.meta.main) await main();
