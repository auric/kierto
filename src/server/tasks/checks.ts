// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The build, test, and lint commands of a task (docs/plans/review-v2/spec.md section 6.7 "Checks", design.md section 10 Q2). The app
// runs only the argv lists that the user approved for the repository, after the one-time warning, in the task worktree only. No shell
// runs: Bun.spawn gets the argument array. Each command has its timeout and a process-tree kill. Native Windows has no OS sandbox.
import type { Database } from "bun:sqlite";
import { mkdtempSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { type CommandKind, OUTPUT_TAIL, type StepDetail, type TaskCommand } from "../../shared/task";
import { log } from "../log";
import { childEnv, killTree } from "../review/claude";
import { repoPath } from "../review/validate";
import { endStep, insertStep } from "./implement";
import { repoSettings } from "./tasks";
import { inside, tasksRoot, type Worktree } from "./worktree";

// A child that a kill leaves can hold the pipes open. It must not block the step.
const DRAIN_MS = 5_000;
export const CHECK_KINDS: readonly CommandKind[] = ["build", "test", "lint"];

export type CommandResult = StepDetail["commands"][number] & { timedOut: boolean; stopped: boolean };

// spec.md section 6.7: the scrubbed child env (BRIEF section 7, "Child environment") plus CI=1. The GIT_* and SSH_ASKPASS variables go
// too, as for every git child (git.ts baseEnv): they can name another repository, config, or credential prompt. home: the folder for
// HOME, and USERPROFILE on Windows (Node os.homedir() reads it there). null keeps the user's home.
export function checkEnv(home: string | null): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(childEnv())) {
    if (/^GIT_/i.test(k) || /^SSH_ASKPASS$/i.test(k) || /^CLAUDE_CODE_DISABLE_BACKGROUND_TASKS$/i.test(k)) continue;
    env[k] = v;
  }
  env.CI = "1";
  if (home !== null) {
    for (const k of Object.keys(env)) if (/^(HOME|USERPROFILE)$/i.test(k)) delete env[k];
    env.HOME = home;
    if (process.platform === "win32") env.USERPROFILE = home;
  }
  return env;
}

// The program of argv[0]: a path is taken as is (relative to cwd), a bare name goes through PATH of env.
// Windows: a .cmd or .bat file runs through cmd.exe, which parses the arguments again (CVE-2024-27980), so it is refused.
export function program(argv0: string, cwd: string, env: Record<string, string>): { path: string } | { error: string } {
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const path = /[\\/]/.test(argv0)
    ? isAbsolute(argv0)
      ? argv0
      : resolve(cwd, argv0)
    : Bun.which(argv0, { PATH: env[pathKey] ?? "", cwd });
  if (!path || !statSync(path, { throwIfNoEntry: false })?.isFile()) return { error: `The command ${argv0} is not found.` };
  if (process.platform === "win32" && [".cmd", ".bat"].includes(extname(path).toLowerCase()))
    return {
      error: `${argv0} is a ${extname(path)} script, which runs through cmd.exe. Use the program itself, such as node.exe with the script.`,
    };
  return { path };
}

// Keeps the last max bytes of a stream of chunks.
function tailBuffer(max: number) {
  let chunks: Uint8Array[] = [];
  let size = 0;
  return {
    add(c: Uint8Array) {
      chunks.push(c);
      size += c.length;
      while (chunks.length > 1 && size - (chunks[0] as Uint8Array).length >= max) size -= (chunks.shift() as Uint8Array).length;
    },
    text() {
      const all = Buffer.concat(chunks);
      chunks = [];
      return new TextDecoder().decode(all.subarray(Math.max(0, all.length - max)));
    },
  };
}

async function pump(stream: ReadableStream<Uint8Array>, add: (c: Uint8Array) => void) {
  const r = stream.getReader();
  for (let c = await r.read(); !c.done; c = await r.read()) add(c.value);
}

// Runs one command. The output keeps the last tailBytes of stdout and stderr together, in arrival order. exit is null when the
// timeout or the signal killed the process tree.
export async function runCommand(
  cmd: Pick<TaskCommand, "name" | "argv" | "timeoutSec">,
  o: { cwd: string; env: Record<string, string>; signal?: AbortSignal; tailBytes?: number },
): Promise<CommandResult> {
  const started = performance.now();
  const base = { name: cmd.name, argv: cmd.argv };
  const done = (exit: number | null, tail: string, timedOut = false, stopped = false): CommandResult => ({
    ...base,
    exit,
    ms: Math.round(performance.now() - started),
    tail,
    timedOut,
    stopped,
  });
  if (o.signal?.aborted) return done(null, "The app stopped the checks before this command.", false, true);
  const prog = program(cmd.argv[0] as string, o.cwd, o.env);
  if ("error" in prog) return done(null, prog.error);
  const out = tailBuffer(o.tailBytes ?? OUTPUT_TAIL);
  const spawn = () =>
    Bun.spawn([prog.path, ...cmd.argv.slice(1)], {
      cwd: o.cwd,
      env: o.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      // POSIX: a new process group, so one kill ends the command and its children.
      detached: process.platform !== "win32",
    });
  let p: ReturnType<typeof spawn>;
  try {
    p = spawn();
  } catch (e) {
    return done(null, `The command ${cmd.argv[0]} did not start: ${(e as Error).message}`);
  }
  let timedOut = false;
  let stopped = false;
  const kill = () => void killTree(p.pid);
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, cmd.timeoutSec * 1000);
  const onAbort = () => {
    stopped = true;
    kill();
  };
  o.signal?.addEventListener("abort", onAbort, { once: true });
  const pipes = Promise.all([pump(p.stdout, out.add), pump(p.stderr, out.add)]).catch(() => {});
  const code = await p.exited;
  clearTimeout(timer);
  o.signal?.removeEventListener("abort", onAbort);
  // A leftover grandchild holds the pipes. The kill of a timeout or Stop already ended the tree.
  await Promise.race([pipes, Bun.sleep(DRAIN_MS)]);
  const note = timedOut
    ? `\n[The app stopped the command after ${cmd.timeoutSec} s.]\n`
    : stopped
      ? "\n[The app stopped the command.]\n"
      : "";
  return done(timedOut || stopped ? null : code, out.text() + note, timedOut, stopped);
}

// The scoped check of one task (spec.md section 6.4, Run line). run: the Run entries of the task. later: the Run entries of the later
// tasks of its plan part, whose tests the tests step wrote too and which stay red until their task.
export type Scope = { run: readonly string[]; later: readonly string[] };

// bun test (https://bun.sh/docs/cli/test): a filter that starts with "./" names one file, -t takes a regex of test names, and
// --path-ignore-patterns takes a glob of test files to skip. A positional argument in the approved argv is a path filter that adds
// files back, so only flags may follow "test".
const bunTest = (argv: readonly string[]) =>
  /^bun(\.exe)?$/i.test(basename(argv[0] ?? "")) && argv[1] === "test" && argv.slice(2).every((a) => a.startsWith("-"));
const GLOB_CHARS = /[*?[\]{}!]/;
const regexQuote = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Splits Run entries into test files and test names. A Run entry is a value for a filter of the runner, never a program or a flag.
// A file: a repository path of a file in cwd. A name: no path separator, no leading "-", no control character, and its first word is
// not a program on PATH. Any other entry refuses the whole Run line.
export function runEntries(
  run: readonly string[],
  cwd: string,
  env: Record<string, string>,
): { files: string[]; names: string[] } | { error: string } {
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const files: string[] = [];
  const names: string[] = [];
  for (const raw of run) {
    const x = raw.trim();
    const p = repoPath(x);
    if (p && statSync(join(cwd, p), { throwIfNoEntry: false })?.isFile()) files.push(p);
    else if (/[\\/]/.test(x)) return { error: `"${x}" names no file in the repository.` };
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the rule refuses control characters.
    else if (!x || x.startsWith("-") || /[\u0000-\u001f\u007f]/.test(x)) return { error: `"${x}" is not a test file or a test name.` };
    else {
      const word = x.split(/\s+/)[0] as string;
      if (Bun.which(word, { PATH: env[pathKey] ?? "", cwd }))
        return { error: `"${x}" starts with the program ${word}. A Run line names tests, never a command.` };
      names.push(x);
    }
  }
  return { files, names };
}

// The commands of a scoped check: the approved test command narrowed to the tests of the task. A refused Run line runs the approved
// command without the test files of the later tasks. No command: the app cannot narrow, and the full checks at the end of the part
// gate the tests. Each note says why.
export function scopedCommands(
  tests: readonly TaskCommand[],
  scope: Scope,
  cwd: string,
  env: Record<string, string>,
): { commands: TaskCommand[]; notes: string[] } {
  const cmd = tests[0];
  const end = "The full checks run at the end of the part.";
  if (!cmd || tests.length > 1 || !bunTest(cmd.argv))
    return {
      commands: [],
      notes: [`The app narrows only one approved "bun test" command with flags only, so it cannot run only the tests of this task. ${end}`],
    };
  const r = runEntries(scope.run, cwd, env);
  if (!("error" in r)) {
    const out: TaskCommand[] = [];
    if (r.files.length)
      out.push({ ...cmd, name: `${cmd.name}: test files of the task`, argv: [...cmd.argv, ...r.files.map((f) => `./${f}`)] });
    if (r.names.length)
      out.push({ ...cmd, name: `${cmd.name}: tests of the task`, argv: [...cmd.argv, "-t", r.names.map(regexQuote).join("|")] });
    return { commands: out, notes: [] };
  }
  const refused = `The app refused the Run line of the task: ${r.error}`;
  const later = runEntries(scope.later, cwd, env);
  if ("error" in later || later.names.length || later.files.some((f) => GLOB_CHARS.test(f)))
    return { commands: [], notes: [`${refused} The later tasks name tests that the app cannot skip. ${end}`] };
  return {
    commands: [{ ...cmd, argv: [...cmd.argv, ...later.files.map((f) => `--path-ignore-patterns=${f}`)] }],
    notes: [`${refused} The check runs ${cmd.name} without the test files of the later tasks.`],
  };
}

export type ChecksInput = {
  db: Database;
  dataDir: string;
  project: string;
  repo: string;
  wt: Worktree;
  // setup runs once per worktree. build, test, and lint are the checks after a step.
  kinds: readonly CommandKind[];
  // Set: only the test commands run, narrowed to the tests of one task (scopedCommands).
  scope?: Scope;
  // The isolate_home setting of the repository. Absent: the stored setting.
  isolateHome?: boolean;
  signal?: AbortSignal;
};

export type ChecksResult =
  | { status: "ran"; green: boolean; commands: CommandResult[]; notes: string[] }
  | { status: "refused"; reason: string };

// Runs the approved commands of the kinds in the order of repo_task_settings.commands_json. Green: every command exited with 0. The
// run stops at a stopped command. The commands come only from the stored settings, never from a caller.
export async function runChecks(i: ChecksInput): Promise<ChecksResult> {
  const s = repoSettings(i.db, i.project, i.repo);
  if (s.warnedAt === null) return { status: "refused", reason: "Accept the warning about app-run commands first." };
  if (!inside(tasksRoot(i.dataDir), i.wt.repo) || !inside(i.wt.dir, i.wt.repo))
    return { status: "refused", reason: "The app runs commands only in a task folder." };
  const home = (i.isolateHome ?? s.isolateHome) ? mkdtempSync(join(tmpdir(), "rl-home-")) : null;
  const env = checkEnv(home);
  const scoped = i.scope
    ? scopedCommands(
        s.commands.filter((c) => c.kind === "test"),
        i.scope,
        i.wt.repo,
        env,
      )
    : null;
  const list = scoped?.commands ?? s.commands.filter((c) => i.kinds.includes(c.kind));
  const commands: CommandResult[] = [];
  try {
    for (const c of list) {
      const r = await runCommand(c, { cwd: i.wt.repo, env, signal: i.signal });
      log(`Task check ${c.name}: exit ${r.exit ?? "none"} in ${r.ms} ms${r.timedOut ? " (timed out)" : r.stopped ? " (stopped)" : ""}.`);
      commands.push(r);
      if (r.stopped) break;
    }
  } finally {
    if (home) await rm(home, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
  return {
    status: "ran",
    green: commands.length === list.length && commands.every((c) => c.exit === 0),
    commands,
    notes: scoped?.notes ?? [],
  };
}

// The checks with their step row (kind check) for the Log tab: each command with argv, exit code, time, and the output tail.
export async function checkStep(
  i: ChecksInput & { task: number; part: number; item?: string | null; attempt?: number; now?: () => number },
): Promise<ChecksResult & { step: number }> {
  const now = i.now ?? Date.now;
  const step = insertStep(i.db, { task: i.task, part: i.part, kind: "check", item: i.item ?? null, attempt: i.attempt ?? 1 }, now());
  const r = await runChecks(i).catch((e): ChecksResult => ({ status: "refused", reason: (e as Error).message }));
  if (r.status === "refused") endStep(i.db, step, "failed", { notes: [r.reason] }, now());
  else
    endStep(
      i.db,
      step,
      !r.commands.length && i.scope ? "skipped" : r.green ? "ok" : r.commands.some((c) => c.stopped) ? "cancelled" : "failed",
      { commands: r.commands.map(({ name, argv, exit, ms, tail }) => ({ name, argv, exit, ms, tail })), notes: r.notes },
      now(),
    );
  return { ...r, step };
}
