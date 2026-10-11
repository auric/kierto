// Runs git with an argument array and an isolated config (plan v3 section 2, "Git isolation").
const TIMEOUT_MS = 10 * 60_000;
const DRAIN_MS = 5_000;
const STDERR_TAIL = 2_000;

// Bun docs: BUN_BE_BUN=1 turns a compiled binary into the bun CLI. BUN_OPTIONS and NODE_OPTIONS add runtime flags. No child gets them.
export const RUNTIME_ENV = /^(?:BUN_BE_BUN|BUN_OPTIONS|NODE_OPTIONS)$/i;

export class GitError extends Error {
  override name = "GitError";
}

function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    // Inherited GIT_* variables can name another config, repository, or trace file. git runs SSH_ASKPASS before it reads GIT_TERMINAL_PROMPT.
    if (v === undefined || /^GIT_/i.test(k) || /^SSH_ASKPASS$/i.test(k) || RUNTIME_ENV.test(k)) continue;
    env[k] = v;
  }
  return env;
}

// The env of git in the user's clone (plan r3): the user's own config, identity, signing, and hooks.
export function userGitEnv(): Record<string, string> {
  return { ...baseEnv(), GIT_TERMINAL_PROMPT: "0" };
}

// The env of every git child. Only fetch gets extra config, for example the auth header.
// emptyGlobal: an empty file. It replaces ~/.gitconfig and the XDG config, so no user filter, hook, or helper runs.
export function gitEnv(emptyGlobal: string, config: [string, string][] = []): Record<string, string> {
  const env = baseEnv();
  const all: [string, string][] = [["credential.helper", ""], ["http.followRedirects", "false"], ...config];
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = emptyGlobal;
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_CONFIG_COUNT = String(all.length);
  all.forEach(([k, v], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = k;
    env[`GIT_CONFIG_VALUE_${i}`] = v;
  });
  return env;
}

// Returns stdout. A non-zero exit throws a GitError with the stderr tail.
export async function git(
  args: string[],
  opts: { env: Record<string, string>; cwd?: string; stdin?: string; timeoutMs?: number },
): Promise<string> {
  const p = Bun.spawn(["git", ...args], {
    cwd: opts.cwd,
    env: opts.env,
    stdin: opts.stdin === undefined ? "ignore" : new Blob([opts.stdin]),
    stdout: "pipe",
    stderr: "pipe",
    timeout: opts.timeoutMs ?? TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  const output = Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  // A leftover child can hold the pipes open. It must not block the caller.
  const [out, err] = await Promise.race([output, Bun.sleep(DRAIN_MS).then(() => ["", ""])]);
  if (code !== 0) {
    const cmd = args.find((a) => !a.startsWith("-") && !a.includes("=")) ?? "";
    throw new GitError(`git ${cmd} failed (exit ${code ?? p.signalCode}): ${err.trim().slice(-STDERR_TAIL)}`);
  }
  return out;
}
