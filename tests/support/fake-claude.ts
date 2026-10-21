// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Fake `claude` CLI for tests. It replays a recorded stream-json fixture and never calls a model.
// Usage: bun tests/support/fake-claude.ts <scenario.json> <claude arguments>
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

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
  // The structured_output of the result, by the --json-schema shape. Absent: the echo of the stdin.
  // replies: a reply run (properties.replies). rereview: a re-review (properties.earlier). answer: an ask run (properties.answer).
  // fix: a fix run (properties.edits); its notes can carry why and reply. improve: a prompt proposal (properties.reasons). consult: a session run (properties.answers),
  // with properties.fix when the run also asks for fixes (session-consult.md part D).
  replies?: unknown;
  rereview?: unknown;
  // The answered list of a review or re-review result (docs/plans/thread-outcome.md section 9). It replaces the answered key when the
  // schema has one. Absent: the result keeps its own answered key, or none.
  answered?: unknown;
  answer?: unknown;
  fix?: unknown;
  improve?: unknown;
  consult?: unknown;
};

const CHILD = "process.stdin.on('end', () => {}); process.stdin.resume(); setInterval(() => {}, 1000);";
const NO_COVERAGE = { read: [], skipped: [], unavailable: [], notChecked: [] };
const JUDGEMENTS = ["valid", "partly", "invalid", "question", null] as const;

// A reply result for each thread of the stdin "Threads:" line. Every third thread gets action none.
// The judgements cycle valid, partly, invalid, question, null.
export function echoReplies(stdin: string) {
  const line = /^Threads: (.*)$/m.exec(stdin)?.[1] ?? "";
  const threads = [...line.matchAll(/(\d+) \(answer message (\d+)[^)]*\)/g)].map((m) => ({ thread: Number(m[1]), replyTo: Number(m[2]) }));
  return {
    summary: `Drafted replies for ${threads.length} threads.`,
    replies: threads.map(({ thread, replyTo }, i) => ({
      ...(i % 3 === 2
        ? { thread, action: "none", body: "", reason: "The thread needs no answer from you.", evidenceStatus: "unverified" }
        : {
            thread,
            action: "reply",
            body: `Thanks. I checked message ${replyTo} against \`flush()\` and will change it.`,
            reason: "The comment asks for a change.",
            evidenceStatus: "code",
          }),
      judgement: JUDGEMENTS[i % JUDGEMENTS.length],
    })),
    coverage: { read: ["src/cache/flush.ts"], skipped: [], unavailable: [], notChecked: [] },
  };
}

// A fix result with one note per thread of the stdin "Fix threads:" line and per ID of the "Fix findings:" line, no fix, and no edit.
// why null and an empty reply: the app makes no nofix draft (docs/plans/thread-outcome.md). A scenario fix result can set both.
export function echoFix(stdin: string) {
  const line = /^Fix threads: (.*)$/m.exec(stdin)?.[1] ?? "";
  const threads = [...line.matchAll(/(\d+)(?: \([^)]*\))?/g)].map((m) => Number(m[1]));
  const findings = [...(/^Fix findings: (.*)$/m.exec(stdin)?.[1] ?? "").matchAll(/\d+/g)].map((m) => Number(m[0]));
  const none = { fixed: false, reason: "Echo", why: null, reply: "" };
  return {
    summary: findings.length ? `Checked ${threads.length} threads and ${findings.length} findings.` : `Checked ${threads.length} threads.`,
    threads: [...threads.map((thread) => ({ thread, ...none })), ...findings.map((finding) => ({ finding, ...none }))],
    edits: [],
    coverage: NO_COVERAGE,
  };
}

const VERDICTS = ["open", "fixed", "outdated"] as const;

// A re-review result: the fixture result with no findings, and one verdict per ID of the stdin "Earlier findings:" line.
// The verdicts cycle open, fixed, outdated.
export function echoRereview(stdin: string, fixture: unknown) {
  const line = /^Earlier findings: (.*)$/m.exec(stdin)?.[1] ?? "";
  const ids = [...line.matchAll(/\d+/g)].map((m) => Number(m[0]));
  return {
    ...(fixture && typeof fixture === "object" ? fixture : {}),
    findings: [],
    earlier: ids.map((id, i) => {
      const status = VERDICTS[i % VERDICTS.length];
      return { id, status, reason: `The echo marks finding ${id} ${status}.`, path: null, line: null };
    }),
  };
}

// A prompt proposal: the fenced current prompt of the stdin with one added line, or a new prompt when the stdin has none.
export function echoImprove(stdin: string) {
  const fence = /^# Current prompt$[^#]*?^(`{3,})$\n([\s\S]*?)\n^\1$/m.exec(stdin);
  const current = fence?.[2] ?? "Find defects in the change.";
  return { prompt: `${current}\nEcho: report each finding with its trigger.`, reasons: ["Echo: added the trigger rule."] };
}

// An ask result. The question line is the last line with text in the "# Your instructions" section of the stdin.
export function echoAnswer(stdin: string) {
  const lines = stdin.split(/\r?\n/);
  const start = lines.indexOf("# Your instructions");
  const end = lines.findIndex((l, i) => i > start && l.startsWith("# "));
  const section = start < 0 ? [] : lines.slice(start + 1, end < 0 ? undefined : end);
  const question = section.filter((l) => l.trim()).at(-1) ?? "";
  return { answer: `Echo: ${question}`, coverage: NO_COVERAGE };
}

// A session answer (docs/plans/session-consult.md part C): one reject per item tag with status open in the stdin.
// fix: the schema asks for fixes too (part D). A reject needs no fix, so the fix has no note and no edit.
export function echoConsult(stdin: string, fix = false) {
  const answers: { id: string; verdict: string; reason: string }[] = [];
  for (const l of stdin.split(/\r?\n/)) {
    const id = /^<item-[0-9a-f]+ id="([TF]\d+)" status="open">$/.exec(l)?.[1];
    if (id) answers.push({ id, verdict: "reject", reason: `Echo: the session rejects ${id}.` });
  }
  return fix ? { answers, fix: { summary: "Echo: no fix.", threads: [], edits: [], coverage: NO_COVERAGE } } : { answers };
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
  // docs/plans/session-consult.md section 1: a resume without --fork-session attaches to a running session or exits with code 1.
  const resume = args.includes("--resume") ? args[args.indexOf("--resume") + 1] : undefined;
  if (resume !== undefined && (!args.includes("--fork-session") || !existsSync(resume))) {
    console.error(args.includes("--fork-session") ? `No conversation found at ${resume}` : "fake-claude: --resume needs --fork-session");
    process.exitCode = 1;
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

  // The --json-schema shape picks the result. A review run keeps the fixture result.
  const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const props = JSON.parse(flag("--json-schema") ?? "null")?.properties ?? {};
  const agentTool = (flag("--tools") ?? "").split(",").includes("Agent");
  // code.claude.com/docs/en/cli-reference: --tools "" disables every built-in tool. No MCP server stays, so init keeps StructuredOutput only.
  const noTools = flag("--tools") === "";
  const result = (fixture: unknown) => {
    if (props.replies !== undefined) return s.replies ?? echoReplies(stdin);
    if (props.earlier !== undefined) return s.rereview ?? echoRereview(stdin, fixture);
    if (props.answer !== undefined) return s.answer ?? echoAnswer(stdin);
    if (props.edits !== undefined) return s.fix ?? echoFix(stdin);
    if (props.reasons !== undefined) return s.improve ?? echoImprove(stdin);
    if (props.answers !== undefined) return s.consult ?? echoConsult(stdin, props.fix !== undefined);
    return undefined;
  };
  const rewrite = (l: string) => {
    const e = JSON.parse(l);
    // A resume with --tools and --strict-mcp-config: init lists those tools and StructuredOutput. Gate B16 checks the real CLI.
    if (e.type === "system" && e.subtype === "init" && resume !== undefined)
      return JSON.stringify({ ...e, tools: [...(flag("--tools") ?? "").split(",").filter(Boolean), "StructuredOutput"], mcp_servers: [] });
    // Gate B8: init lists the agent tool as Task. The real CLI lists it only when --tools names Agent.
    if (e.type === "system" && e.subtype === "init" && Array.isArray(e.tools) && noTools)
      return JSON.stringify({ ...e, tools: e.tools.filter((t: unknown) => t === "StructuredOutput"), mcp_servers: [] });
    if (e.type === "system" && e.subtype === "init" && Array.isArray(e.tools) && !agentTool)
      return JSON.stringify({ ...e, tools: e.tools.filter((t: unknown) => t !== "Task") });
    const found = e.type === "result" ? result(e.structured_output) : undefined;
    const r =
      e.type === "result" && s.answered !== undefined && props.answered !== undefined
        ? { ...(found ?? e.structured_output), answered: s.answered }
        : found;
    return r === undefined ? l : JSON.stringify({ ...e, structured_output: r });
  };

  // The fixture paths name the recorded Windows cwd. Replace it and its separator with the real cwd and separator.
  const lines = readFileSync(s.fixture, "utf8").split("\n").filter(Boolean).map(rewrite);
  const init = lines.map((l) => JSON.parse(l)).find((e) => e.type === "system" && e.subtype === "init");
  const esc = (p: string) => JSON.stringify(p).slice(1, -1);
  for (const l of lines) {
    if (s.hang && JSON.parse(l).type === "result") break;
    await Bun.write(
      Bun.stdout,
      `${typeof init?.cwd === "string" ? l.replaceAll(esc(`${init.cwd}\\`), esc(process.cwd() + sep)).replaceAll(esc(init.cwd), esc(process.cwd())) : l}\n`,
    );
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
