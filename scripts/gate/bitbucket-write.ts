// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Gate G1 to G7 (docs/plans/review-v2/tasks.md WP-G0, docs/gate-v2.md): the Bitbucket write facts for building Jira tasks.
// It WRITES to the server: branches, pull requests, and one branch delete. Run it only on a test repository that you may change.
// Usage: bun scripts/gate/bitbucket-write.ts --repo <repository URL> --target <branch> --authorize-writes [--only G1,G2] [G3 ...]
//          [--reviewer <user slug>] [--build-commit <commit>] [--readonly-token-env <VAR>] [--jira-key <KEY>] [--keep]
//        bun scripts/gate/bitbucket-write.ts --repo <repository URL> --authorize-writes --cleanup
//        bun scripts/gate/bitbucket-write.ts --dry-run [--only G1,G2]
// --dry-run: the same steps against a loopback fake server and a local bare repository. It reads no secret, and nothing leaves the machine.
// Token: GATE_BITBUCKET_TOKEN, else the token of scripts/gate0/set-token.ts. The stored token goes only to the stored URL origin.
// Console output and .gate0/bitbucket-write/*.json hold only status codes, booleans, key names, enum-like strings, and gate branch names.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gitEnv } from "../../src/server/review/git";

const SERVICE = "review-loop";
const ROOT = resolve(import.meta.dir, "../..");
const OUT = join(ROOT, ".gate0/bitbucket-write");
const HTTP_TIMEOUT_MS = 30_000;
const GIT_TIMEOUT_MS = 120_000;
const G5_WAIT_MS = 30_000;
const G5_POLL_MS = 2_000;
// Every branch that the script creates or deletes has this prefix. The target branch never gets a push.
const PREFIX = "rl-gate-";
const CHECKS = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"] as const;
type CheckId = (typeof CHECKS)[number];
const USAGE = [
  "usage: bun scripts/gate/bitbucket-write.ts --repo <repository URL> --target <branch> --authorize-writes [--only G1,G2] [G3 ...]",
  "         [--reviewer <user slug>] [--build-commit <commit>] [--readonly-token-env <VAR>] [--jira-key <KEY>] [--keep]",
  "       bun scripts/gate/bitbucket-write.ts --repo <repository URL> --authorize-writes --cleanup",
  "       bun scripts/gate/bitbucket-write.ts --dry-run [--only G1,G2]",
].join("\n");

function usage(msg: string): never {
  console.error(msg);
  console.error(USAGE);
  process.exit(2);
}

// ---------- arguments ----------
const argv = process.argv.slice(2);
const FLAGS = new Set(["--dry-run", "--authorize-writes", "--keep", "--cleanup"]);
const VALUES = new Set(["--repo", "--target", "--reviewer", "--build-commit", "--readonly-token-env", "--jira-key", "--only"]);
const flags = new Set<string>();
const opt: Record<string, string> = {};
const only = new Set<CheckId>();
const addIds = (v: string) => {
  for (const id of v.split(",").map((s) => s.trim().toUpperCase())) {
    if (!(CHECKS as readonly string[]).includes(id)) usage(`unknown check: ${id}. Use one of ${CHECKS.join(", ")}.`);
    only.add(id as CheckId);
  }
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i] ?? "";
  if (FLAGS.has(a)) flags.add(a);
  else if (VALUES.has(a)) {
    const v = argv[++i];
    if (v === undefined || v.startsWith("--")) usage(`${a} needs a value.`);
    if (a === "--only") addIds(v);
    else opt[a] = v;
  } else if (/^g\d+$/i.test(a)) addIds(a);
  else usage(`unknown argument: ${a}`);
}
const selected = CHECKS.filter((c) => only.size === 0 || only.has(c));
const DRY = flags.has("--dry-run");

// A project or personal repository web URL: <base>/projects/<KEY>/repos/<slug> or <base>/users/<slug>/repos/<slug>.
function parseRepoUrl(input: string) {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    usage("--repo is not a URL.");
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) usage("--repo needs an http or https URL without user info.");
  const m = u.pathname.match(/^(.*?)\/(projects|users)\/([^/]+)\/repos\/([^/]+)(?:\/|$)/);
  if (!m?.[3] || !m[4]) usage("--repo is not a repository URL. Use <base>/projects/<KEY>/repos/<slug>.");
  const owner = decodeURIComponent(m[3]);
  // A personal repository uses the REST project key ~<USER SLUG> in upper case (src/shared/pr-url.ts).
  return { base: u.origin + (m[1] ?? ""), project: m[2] === "users" ? `~${owner.toUpperCase()}` : owner, repo: decodeURIComponent(m[4]) };
}

// ---------- sanitized output ----------
type Status = "PASS" | "FAIL" | "INFO" | "SKIPPED";
type Result = { check: string; status: Status; evidence: string; data?: unknown };
// A Java exception class name is enum-like enough to keep. Error messages are not kept.
const exceptionNames = (body: unknown): string[] =>
  ((body as { errors?: { exceptionName?: unknown }[] } | null)?.errors ?? [])
    .map((e) => e.exceptionName)
    .filter((n): n is string => typeof n === "string" && /^[A-Za-z0-9_.$]+$/.test(n));
const keysOf = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v).sort() : []);
const enumLike = (v: unknown) => (typeof v === "string" && /^[A-Z][A-Z0-9_]*$/.test(v) ? v : v === undefined ? "absent" : "<value>");
const hash = (s: unknown) => (typeof s === "string" ? createHash("sha256").update(s).digest("hex") : null);
// git output markers. Remote text can hold names, so only these tokens leave the script.
const MARKERS = /\[new branch\]|\[deleted\]|\[rejected\]|\[remote rejected\]|\(stale info\)|non-fast-forward|fetch first|up to date/g;
function gitFacts(text: string) {
  const markers = [...new Set(text.match(MARKERS) ?? [])];
  const http = text.match(/returned error: (\d{3})|HTTP (\d{3})/);
  return { markers, http: http ? Number(http[1] ?? http[2]) : null };
}

type Ctx = {
  base: string;
  project: string;
  repo: string;
  token: string;
  target: string;
  // Dry run only: a local bare repository in place of the http clone link.
  pushUrl?: string;
  readonlyToken?: string;
  reviewer?: string;
  buildCommit?: string;
  jiraKey?: string;
  keep: boolean;
};
type Call = { status: number; body: unknown };
type Pr = { id?: unknown; version?: unknown; state?: unknown; title?: unknown; toRef?: { id?: unknown }; reviewers?: unknown[] };

// ---------- the session: HTTP, git, and the objects that this run made ----------
function session(ctx: Ctx) {
  const repoPath = `/rest/api/1.0/projects/${encodeURIComponent(ctx.project)}/repos/${encodeURIComponent(ctx.repo)}`;
  const stamp = Date.now().toString(36);
  const name = (role: string) => `${PREFIX}${stamp}-${role}`;
  const dir = mkdtempSync(join(tmpdir(), "rl-gate-bw-"));
  const cache = join(dir, "cache.git");
  const emptyGlobal = join(dir, "empty.gitconfig");
  writeFileSync(emptyGlobal, "");
  const identity = {
    GIT_AUTHOR_NAME: "Review gate",
    GIT_AUTHOR_EMAIL: "gate@example.invalid",
    GIT_COMMITTER_NAME: "Review gate",
    GIT_COMMITTER_EMAIL: "gate@example.invalid",
  };
  const envFor = (token: string) => ({ ...gitEnv(emptyGlobal, [["http.extraHeader", `Authorization: Bearer ${token}`]]), ...identity });
  const env = envFor(ctx.token);
  let cloneUrl: string | undefined;

  // Removes every value that can name the server, the repository, or the token.
  const clean = (s: string) => {
    let out = s;
    for (const [v, r] of [
      [ctx.token, "<token>"],
      [ctx.readonlyToken, "<token>"],
      [cloneUrl, "<clone url>"],
      [ctx.base, "<server>"],
      [new URL(ctx.base).host, "<server>"],
    ] as const)
      if (v) out = out.split(v).join(r);
    return out;
  };

  async function call(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<Call> {
    try {
      const res = await fetch(ctx.base + path, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${ctx.token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {}
      return { status: res.status, body: json };
    } catch (e) {
      return { status: 0, body: { network: (e as Error).name } };
    }
  }

  function git(args: string[], opts: { env?: Record<string, string>; stdin?: string } = {}) {
    const r = Bun.spawnSync(["git", `--git-dir=${cache}`, ...args], {
      env: opts.env ?? env,
      stdin: opts.stdin === undefined ? "ignore" : new Blob([opts.stdin]),
      stdout: "pipe",
      stderr: "pipe",
      timeout: GIT_TIMEOUT_MS,
    });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  }
  function must(args: string[], opts: { env?: Record<string, string>; stdin?: string } = {}) {
    const r = git(args, opts);
    if (r.code !== 0) {
      const f = gitFacts(r.out + r.err);
      // URLs and quoted values in a git message can name the server, the repository, or a path.
      const first = clean(r.err.split(/\r?\n/).find((l) => /^(fatal|error):/.test(l)) ?? "")
        .replace(/'[^']*'|\S+:\/\/\S+|[A-Za-z]:[\\/]\S+/g, "<value>")
        .slice(0, 200);
      throw new Error(`git ${args[0]} failed (exit ${r.code}) markers=${f.markers.join(",") || "none"} http=${f.http ?? "none"} ${first}`);
    }
    return r.out.trim();
  }

  const init = Bun.spawnSync(["git", "init", "-q", "--bare", "--template=", cache], { env, stdout: "pipe", stderr: "pipe" });
  if (init.exitCode !== 0) throw new Error("git init failed");

  const repoInfo: { status?: number; cloneNames?: string[]; httpSameOrigin?: boolean } = {};
  async function url() {
    if (cloneUrl) return cloneUrl;
    const r = await call("GET", repoPath);
    const links = ((r.body as { links?: { clone?: { name?: unknown; href?: unknown }[] } } | null)?.links?.clone ?? []).filter(
      (l) => typeof l.href === "string",
    );
    repoInfo.status = r.status;
    repoInfo.cloneNames = links.map((l) => (typeof l.name === "string" && /^[a-z0-9]+$/.test(l.name) ? l.name : "<name>"));
    const http = links.find((l) => l.name === "http")?.href as string | undefined;
    if (!http) throw new Error(`no http clone link: HTTP ${r.status} links=${repoInfo.cloneNames.join(",") || "none"}`);
    const u = new URL(http);
    u.username = "";
    u.password = "";
    // The token goes only to the server origin of --repo.
    repoInfo.httpSameOrigin = u.origin === new URL(ctx.base).origin;
    if (!repoInfo.httpSameOrigin) throw new Error("the http clone link has another origin. Nothing was pushed.");
    cloneUrl = ctx.pushUrl ?? u.href;
    return cloneUrl;
  }

  let head: string | undefined;
  async function targetHead() {
    if (!head) {
      must(["fetch", "-q", "--no-tags", "--depth", "1", await url(), `refs/heads/${ctx.target}`]);
      head = must(["rev-parse", "FETCH_HEAD"]);
    }
    return head;
  }
  // A commit on parent that adds one file, so a pull request from it has a diff.
  function commitOn(parent: string, label: string) {
    const index = { ...env, GIT_INDEX_FILE: join(dir, `index-${label}`) };
    const blob = must(["hash-object", "-w", "--stdin"], { stdin: `Gate ${label} ${stamp}\n` });
    must(["read-tree", parent], { env: index });
    must(["update-index", "--add", "--cacheinfo", `100644,${blob},rl-gate/${stamp}-${label}.txt`], { env: index });
    const tree = must(["write-tree"], { env: index });
    return must(["commit-tree", tree, "-p", parent, "-m", `Gate ${label}`]);
  }
  // refspec "<commit>" pushes it to the branch; null deletes the branch. lease "" means: the branch must not exist.
  async function push(branch: string, commit: string | null, lease: string, token = ctx.token) {
    if (!branch.startsWith(PREFIX)) throw new Error("refusing to push a branch without the gate prefix");
    const spec = `${commit ?? ""}:refs/heads/${branch}`;
    const r = git(["push", "--porcelain", await url(), `--force-with-lease=refs/heads/${branch}:${lease}`, spec], { env: envFor(token) });
    return { code: r.code, ...gitFacts(r.out + r.err) };
  }
  async function remoteAt(branch: string) {
    const line = must(["ls-remote", "--heads", await url(), `refs/heads/${branch}`]);
    return line.split(/\s+/)[0] || null;
  }

  // Objects that this run made. cleanup() declines the PRs and deletes the branches, except the kept ones (G7).
  const branches = new Map<string, string>();
  const prs = new Map<number, string>();
  const kept = new Set<string>();
  const pushes: Record<string, { code: number | null; markers: string[]; http: number | null }> = {};

  async function branch(role: string, parent: string) {
    const b = name(role);
    const sha = commitOn(parent, role);
    const r = await push(b, sha, "");
    pushes[role] = r;
    if (r.code !== 0)
      throw new Error(`push of a new branch failed (exit ${r.code}) markers=${r.markers.join(",") || "none"} http=${r.http ?? "none"}`);
    branches.set(b, sha);
    return { name: b, sha };
  }
  const memo = <T>(fn: () => Promise<T>) => {
    let p: Promise<T> | undefined;
    return () => {
      p ??= fn();
      return p;
    };
  };
  const lower = memo(async () => branch("lower", await targetHead()));
  const upper = memo(async () => branch("upper", (await lower()).sha));

  const ref = (b: string) => ({ id: `refs/heads/${b}`, repository: { slug: ctx.repo, project: { key: ctx.project } } });
  const prPath = (id: number) => `${repoPath}/pull-requests/${id}`;
  async function createPr(from: string, to: string, title: string, reviewers: string[] = []) {
    const r = await call("POST", `${repoPath}/pull-requests`, {
      title,
      description: "Review gate check. The script declines this pull request and deletes its branch at the end.",
      fromRef: ref(from),
      toRef: ref(to),
      reviewers: reviewers.map((n) => ({ user: { name: n } })),
    });
    const pr = (r.body ?? {}) as Pr;
    if (typeof pr.id === "number") prs.set(pr.id, from);
    return { ...r, pr };
  }
  const getPr = async (id: number) => {
    const r = await call("GET", prPath(id));
    return { status: r.status, pr: (r.body ?? {}) as Pr };
  };
  const stacked = memo(async () => {
    const [l, u] = [await lower(), await upper()];
    const r = await createPr(u.name, l.name, `Review gate stack ${stamp}`);
    if (r.status !== 201 || typeof r.pr.id !== "number")
      throw new Error(`create of the stacked PR failed: HTTP ${r.status} ${exceptionNames(r.body).join(",")}`);
    return { id: r.pr.id, lower: l, upper: u };
  });

  async function decline(id: number) {
    const g = await getPr(id);
    if (g.pr.state !== "OPEN") return g.status === 200 ? "not open" : `HTTP ${g.status}`;
    const r = await call("POST", `${prPath(id)}/decline?version=${String(g.pr.version)}`, {});
    return `HTTP ${r.status}`;
  }
  async function cleanup() {
    const declined: string[] = [];
    for (const [id, from] of prs) if (!kept.has(from)) declined.push(await decline(id));
    const deleted: string[] = [];
    for (const [b, sha] of branches) {
      if (kept.has(b)) continue;
      const r = await push(b, null, sha);
      deleted.push(r.code === 0 ? "ok" : `exit ${r.code} ${r.markers.join(",")}`);
    }
    return `cleanup: declined PRs=${declined.join(",") || "none"}; deleted branches=${deleted.join(",") || "none"}`;
  }
  // --cleanup: every gate branch on the server, with its open outgoing PRs.
  async function cleanupAll() {
    const lines = must(["ls-remote", "--heads", await url()]).split(/\r?\n/);
    const found = lines
      .map((l) => l.split(/\s+/))
      .filter(([, r]) => r?.startsWith(`refs/heads/${PREFIX}`))
      .map(([sha, r]) => ({ sha: sha as string, branch: (r as string).slice("refs/heads/".length) }));
    const out: string[] = [];
    for (const f of found) {
      const r = await call(
        "GET",
        `${repoPath}/pull-requests?at=${encodeURIComponent(`refs/heads/${f.branch}`)}&direction=OUTGOING&state=OPEN&limit=25`,
      );
      const ids = ((r.body as { values?: { id?: unknown }[] } | null)?.values ?? [])
        .map((v) => v.id)
        .filter((id): id is number => typeof id === "number");
      const d = [];
      for (const id of ids) d.push(await decline(id));
      const p = await push(f.branch, null, f.sha);
      out.push(`${f.branch}: PRs declined=${d.join(",") || "none"} branch deleted=${p.code === 0}`);
    }
    return out.length ? out : ["no gate branches found"];
  }

  return {
    ctx,
    stamp,
    name,
    call,
    commitOn,
    push,
    remoteAt,
    branch,
    branches,
    kept,
    pushes,
    repoInfo,
    lower,
    upper,
    stacked,
    createPr,
    getPr,
    ref,
    prPath,
    targetHead,
    envFor,
    clean,
    cleanup,
    cleanupAll,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}
type Session = ReturnType<typeof session>;

// ---------- checks ----------
const isRef = (pr: Pr, b: string) => pr.toRef?.id === `refs/heads/${b}`;

async function g1(s: Session): Promise<Result> {
  const l = await s.lower();
  const at = await s.remoteAt(l.name);
  const p = s.pushes.lower;
  let readonly = "read-only token: not given";
  if (s.ctx.readonlyToken) {
    const b = s.name("readonly");
    const r = await s.push(b, s.commitOn(l.sha, "readonly"), "", s.ctx.readonlyToken);
    if (r.code === 0) s.branches.set(b, (await s.remoteAt(b)) ?? "");
    readonly = `read-only token push: exit=${r.code} markers=${r.markers.join(",") || "none"} http=${r.http ?? "none"}`;
  }
  const pass = !!s.repoInfo.httpSameOrigin && p?.code === 0 && at === l.sha;
  return {
    check: "G1",
    status: pass ? "PASS" : "FAIL",
    evidence: `repository GET: HTTP ${s.repoInfo.status} clone links=${s.repoInfo.cloneNames?.join(",")} http same origin=${s.repoInfo.httpSameOrigin}; push with empty lease: exit=${p?.code} markers=${p?.markers.join(",") || "none"} remote at pushed commit=${at === l.sha}; ${readonly}`,
  };
}

async function g2(s: Session): Promise<Result> {
  const l = await s.lower();
  const r = await s.createPr(l.name, s.ctx.target, `Review gate G2 ${s.stamp}`, [s.ctx.reviewer as string]);
  const reviewers = Array.isArray(r.pr.reviewers) ? r.pr.reviewers.length : null;
  const pass = r.status === 201 && typeof r.pr.id === "number" && typeof r.pr.version === "number" && reviewers === 1;
  return {
    check: "G2",
    status: pass ? "PASS" : "FAIL",
    evidence: `create PR: HTTP ${r.status}${exceptionNames(r.body).length ? ` ${exceptionNames(r.body).join(",")}` : ""} id=${typeof r.pr.id === "number"} version=${String(r.pr.version)} state=${enumLike(r.pr.state)} reviewers=${reviewers} keys=${keysOf(r.body).join(",")}`,
  };
}

async function g3(s: Session): Promise<Result> {
  const stats = async (sha: string) => {
    const r = await s.call("GET", `/rest/build-status/1.0/commits/stats/${sha}`);
    const b = (r.body ?? {}) as Record<string, unknown>;
    const nums = ["successful", "inProgress", "failed"].every((k) => typeof b[k] === "number");
    const total = nums ? (b.successful as number) + (b.inProgress as number) + (b.failed as number) : null;
    return {
      r,
      b,
      nums,
      total,
      line: `HTTP ${r.status} keys=${keysOf(r.body).join(",") || "none"} counts=${nums ? `${b.successful}/${b.inProgress}/${b.failed}` : "n/a"}`,
    };
  };
  const none = await stats((await s.lower()).sha);
  const withBuilds = s.ctx.buildCommit ? await stats(s.ctx.buildCommit) : null;
  const noneOk = none.r.status === 200 && none.nums;
  const status: Status = !noneOk
    ? "FAIL"
    : !withBuilds
      ? "INFO"
      : withBuilds.r.status === 200 && withBuilds.nums && (withBuilds.total ?? 0) > 0
        ? "PASS"
        : "FAIL";
  return {
    check: "G3",
    status,
    evidence: `build stats (successful/inProgress/failed) of a new commit: ${none.line}; of --build-commit: ${withBuilds ? withBuilds.line : "not given"}`,
  };
}

async function g4(s: Session): Promise<Result> {
  const st = await s.stacked();
  const before = await s.getPr(st.id);
  const put = await s.call("PUT", s.prPath(st.id), { version: before.pr.version, toRef: s.ref(s.ctx.target) });
  const after = await s.getPr(st.id);
  const moved = isRef(after.pr, s.ctx.target);
  // Back to the stacked target, so G5 can delete it.
  const back = await s.call("PUT", s.prPath(st.id), { version: after.pr.version, toRef: s.ref(st.lower.name) });
  const reviewers = (p: Pr) => (Array.isArray(p.reviewers) ? p.reviewers.length : null);
  return {
    check: "G4",
    status: put.status === 200 && moved ? "PASS" : "FAIL",
    evidence: `PUT with a new toRef: HTTP ${put.status}${exceptionNames(put.body).length ? ` ${exceptionNames(put.body).join(",")}` : ""} version ${String(before.pr.version)}->${String(after.pr.version)} toRef moved=${moved} title unchanged=${hash(after.pr.title) === hash(before.pr.title)} reviewers ${reviewers(before.pr)}->${reviewers(after.pr)}; PUT back: HTTP ${back.status}`,
  };
}

async function g5(s: Session): Promise<Result> {
  const st = await s.stacked();
  const before = await s.getPr(st.id);
  if (!isRef(before.pr, st.lower.name))
    return {
      check: "G5",
      status: "FAIL",
      evidence: `the stacked PR does not target the lower branch: HTTP ${before.status} state=${enumLike(before.pr.state)}`,
    };
  const del = await s.push(st.lower.name, null, st.lower.sha);
  if (del.code === 0) s.branches.delete(st.lower.name);
  let after = before;
  const end = Date.now() + G5_WAIT_MS;
  while (Date.now() < end) {
    after = await s.getPr(st.id);
    if (after.pr.state !== "OPEN" || !isRef(after.pr, st.lower.name)) break;
    await Bun.sleep(G5_POLL_MS);
  }
  const to = isRef(after.pr, st.lower.name) ? "lower branch" : isRef(after.pr, s.ctx.target) ? "target branch" : "other";
  return {
    check: "G5",
    status: del.code === 0 && after.status === 200 ? "PASS" : "FAIL",
    evidence: `delete of the target branch: exit=${del.code} markers=${del.markers.join(",") || "none"}; outcome: state=${enumLike(after.pr.state)} toRef=${to} version ${String(before.pr.version)}->${String(after.pr.version)} (read within ${G5_WAIT_MS / 1000} s)`,
  };
}

async function g6(s: Session): Promise<Result> {
  const u = await s.upper();
  const moved = s.commitOn(u.sha, "moved");
  const r1 = await s.push(u.name, moved, u.sha);
  if (r1.code === 0) s.branches.set(u.name, moved);
  const r2 = await s.push(u.name, s.commitOn(u.sha, "stale"), u.sha);
  const at = await s.remoteAt(u.name);
  const pass = r1.code === 0 && r2.code !== 0 && r2.markers.includes("(stale info)") && at === moved;
  return {
    check: "G6",
    status: pass ? "PASS" : "FAIL",
    evidence: `move the remote branch: exit=${r1.code}; push with the old lease: exit=${r2.code} markers=${r2.markers.join(",") || "none"}; remote keeps the moved commit=${at === moved}`,
  };
}

async function g7(s: Session): Promise<Result> {
  const b = await s.branch("g7", await s.targetHead());
  s.kept.add(b.name);
  const r = await s.createPr(b.name, s.ctx.target, `${s.ctx.jiraKey}: Review gate G7`);
  return {
    check: "G7",
    status: r.status === 201 ? "INFO" : "FAIL",
    evidence: `create PR with the Jira key in its title: HTTP ${r.status} id=${String(r.pr.id)}. The script keeps this PR. Sync the app, open PR ${String(r.pr.id)}, and record whether it shows the task chip. Then run --cleanup.`,
  };
}

const RUNNERS: Record<CheckId, (s: Session) => Promise<Result>> = { G1: g1, G2: g2, G3: g3, G4: g4, G5: g5, G6: g6, G7: g7 };

async function runGate(ctx: Ctx) {
  const s = session(ctx);
  const results: Result[] = [];
  let tail = "";
  try {
    for (const id of selected) {
      try {
        results.push(await RUNNERS[id](s));
      } catch (e) {
        results.push({ check: id, status: "FAIL", evidence: `exception: ${s.clean((e as Error).message)}` });
      }
    }
  } finally {
    tail = ctx.keep
      ? `cleanup: skipped (--keep). Gate branches start with ${PREFIX}${s.stamp}.`
      : await s.cleanup().catch((e) => `cleanup failed: ${s.clean((e as Error).message)}`);
    s.dispose();
  }
  for (const r of results) r.evidence = s.clean(r.evidence);
  return { results, tail: s.clean(tail) };
}

function report(results: Result[], tail: string, file: string) {
  for (const r of results) console.log(`${r.status.padEnd(7)} ${r.check} ${r.evidence}`);
  console.log(tail);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, file),
    `${JSON.stringify({ at: new Date().toISOString(), mode: DRY ? "dry-run" : "run", selected, results, tail }, null, 2)}\n`,
  );
  console.log(`Recorded in .gate0/bitbucket-write/${file}.`);
}
const part = selected.length === CHECKS.length ? "" : `.${selected.join("-").toLowerCase()}`;

// ---------- dry run: a loopback fake server and a local bare repository ----------
// The fake declines a PR whose target or source branch is gone. That is one possible G5 outcome, not a verified one.
function fakeServer(token: string, origin: string, buildCommit: string) {
  const exists = (b: string) =>
    Bun.spawnSync(["git", `--git-dir=${origin}`, "rev-parse", "--verify", "-q", b], { stdout: "pipe", stderr: "pipe" }).exitCode === 0;
  const prs = new Map<
    number,
    Record<string, unknown> & { version: number; state: string; fromRef: { id: string }; toRef: { id: string } }
  >();
  const json = (status: number, body: unknown) => Response.json(body, { status });
  const repoPath = "/ctx/rest/api/1.0/projects/DRY/repos/dry-repo";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      if (req.headers.get("authorization") !== `Bearer ${token}`) return json(401, { errors: [{ message: "Authentication failed." }] });
      const url = new URL(req.url);
      const p = url.pathname;
      if (p.startsWith("/ctx/rest/build-status/1.0/commits/stats/")) {
        const n = p.endsWith(`/${buildCommit}`) ? 1 : 0;
        return json(200, { successful: n, inProgress: 0, failed: 0 });
      }
      if (req.method === "GET" && p === repoPath)
        return json(200, {
          slug: "dry-repo",
          links: {
            clone: [
              { name: "http", href: `${url.origin}/ctx/scm/dry/dry-repo.git` },
              { name: "ssh", href: "ssh://git@127.0.0.1:7999/dry/dry-repo.git" },
            ],
          },
        });
      if (p === `${repoPath}/pull-requests` && req.method === "GET") {
        const at = url.searchParams.get("at");
        return json(200, { values: [...prs.values()].filter((x) => x.fromRef.id === at && x.state === "OPEN"), isLastPage: true });
      }
      if (p === `${repoPath}/pull-requests` && req.method === "POST") {
        const b = (await req.json()) as {
          title?: string;
          fromRef?: { id?: string };
          toRef?: { id?: string };
          reviewers?: { user?: { name?: string } }[];
        };
        if (!b.fromRef?.id || !b.toRef?.id || !exists(b.fromRef.id) || !exists(b.toRef.id))
          return json(404, { errors: [{ exceptionName: "dry.NoSuchBranch" }] });
        const id = prs.size + 1;
        const pr = {
          id,
          version: 0,
          title: b.title,
          state: "OPEN",
          fromRef: { id: b.fromRef.id },
          toRef: { id: b.toRef.id },
          reviewers: (b.reviewers ?? []).map((r) => ({ user: { name: r.user?.name }, role: "REVIEWER", status: "UNAPPROVED" })),
          links: {},
        };
        prs.set(id, pr);
        return json(201, pr);
      }
      const m = p.match(/\/pull-requests\/(\d+)(\/decline)?$/);
      const pr = m ? prs.get(Number(m[1])) : undefined;
      if (!pr) return json(404, { errors: [{ exceptionName: "dry.NoSuchPullRequest" }] });
      if (pr.state === "OPEN" && (!exists(pr.toRef.id) || !exists(pr.fromRef.id)))
        Object.assign(pr, { state: "DECLINED", version: pr.version + 1 });
      if (req.method === "GET") return json(200, pr);
      if (m?.[2]) {
        if (Number(url.searchParams.get("version")) !== pr.version) return json(409, { errors: [{ exceptionName: "dry.OutOfDate" }] });
        Object.assign(pr, { state: "DECLINED", version: pr.version + 1 });
        return json(200, pr);
      }
      const b = (await req.json()) as { version?: number; toRef?: { id?: string } };
      if (b.version !== pr.version) return json(409, { errors: [{ exceptionName: "dry.OutOfDate" }] });
      if (b.toRef?.id) {
        if (!exists(b.toRef.id)) return json(404, { errors: [{ exceptionName: "dry.NoSuchBranch" }] });
        pr.toRef = { id: b.toRef.id };
      }
      pr.version++;
      return json(200, pr);
    },
  });
  return server;
}

if (DRY) {
  const dir = mkdtempSync(join(tmpdir(), "rl-gate-bw-dry-"));
  const origin = join(dir, "origin.git");
  const env = {
    ...gitEnv(join(dir, "none.gitconfig")),
    GIT_AUTHOR_NAME: "dry",
    GIT_AUTHOR_EMAIL: "dry@example.invalid",
    GIT_COMMITTER_NAME: "dry",
    GIT_COMMITTER_EMAIL: "dry@example.invalid",
  };
  writeFileSync(join(dir, "none.gitconfig"), "");
  const g = (args: string[], stdin?: string) => {
    const r = Bun.spawnSync(["git", ...args], {
      env: { ...env, GIT_INDEX_FILE: join(dir, "index") },
      stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (r.exitCode !== 0) throw new Error(`dry setup: git ${args[0]} failed: ${r.stderr.toString().trim()}`);
    return r.stdout.toString().trim();
  };
  g(["init", "-q", "--bare", "--template=", origin]);
  const blob = g([`--git-dir=${origin}`, "hash-object", "-w", "--stdin"], "dry\n");
  g([`--git-dir=${origin}`, "update-index", "--add", "--cacheinfo", `100644,${blob},README.md`]);
  const first = g([`--git-dir=${origin}`, "commit-tree", g([`--git-dir=${origin}`, "write-tree"]), "-m", "dry"]);
  g([`--git-dir=${origin}`, "update-ref", "refs/heads/main", first]);
  const token = "dry-run-token";
  const server = fakeServer(token, origin, first);
  try {
    const { results, tail } = await runGate({
      base: `http://127.0.0.1:${server.port}/ctx`,
      project: "DRY",
      repo: "dry-repo",
      token,
      target: "main",
      pushUrl: origin,
      reviewer: "dry-reviewer",
      buildCommit: first,
      jiraKey: "DRY-1",
      keep: false,
    });
    console.log("[dry run: loopback fake server and a local bare repository, no secret read]");
    report(results, tail, `result${part}.dry-run.json`);
    const ok = results.length === selected.length && results.every((r) => r.status !== "FAIL");
    console.log(ok ? "dry run: PASS" : "dry run: FAIL");
    process.exitCode = ok ? 0 : 1;
  } finally {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  // ---------- live run: separate authorization, a repository named on the command line ----------
  if (!opt["--repo"]) usage("--repo is required. Name your test repository.");
  if (!flags.has("--authorize-writes"))
    usage("Refused: this script creates branches and pull requests and deletes a branch. Add --authorize-writes for your test repository.");
  const repo = parseRepoUrl(opt["--repo"]);
  const cleanupMode = flags.has("--cleanup");
  const target = opt["--target"];
  if (!cleanupMode) {
    if (!target) usage("--target is required: the branch that the gate branches start from.");
    if (!/^[A-Za-z0-9._/-]+$/.test(target) || target.includes("..") || target.startsWith(PREFIX))
      usage("--target is not a usable branch name.");
    if (selected.includes("G2") && !opt["--reviewer"]) usage("G2 needs --reviewer <user slug>.");
    if (selected.includes("G7") && !/^[A-Z][A-Z0-9]+-\d+$/.test(opt["--jira-key"] ?? "")) usage("G7 needs --jira-key <KEY-123>.");
    if (opt["--build-commit"] && !/^[0-9a-f]{7,40}$/i.test(opt["--build-commit"])) usage("--build-commit needs a commit ID.");
  }
  const roName = opt["--readonly-token-env"];
  if (roName && !process.env[roName]) usage(`--readonly-token-env: ${roName} is empty.`);
  let token = process.env.GATE_BITBUCKET_TOKEN;
  if (!token) {
    const storedUrl = await Bun.secrets.get({ service: SERVICE, name: "bitbucket-url" });
    token = (await Bun.secrets.get({ service: SERVICE, name: "bitbucket-token" })) ?? undefined;
    if (!token) usage("No token. Set GATE_BITBUCKET_TOKEN, or run: bun scripts/gate0/set-token.ts");
    if (!storedUrl || new URL(storedUrl).origin !== new URL(repo.base).origin)
      usage("Refused: the stored token belongs to another server, or no server URL is stored. Set GATE_BITBUCKET_TOKEN for this server.");
  }
  const ctx: Ctx = {
    ...repo,
    token,
    target: target ?? "",
    readonlyToken: roName ? process.env[roName] : undefined,
    reviewer: opt["--reviewer"],
    buildCommit: opt["--build-commit"],
    jiraKey: opt["--jira-key"],
    keep: flags.has("--keep"),
  };
  if (cleanupMode) {
    const s = session(ctx);
    try {
      for (const l of await s.cleanupAll()) console.log(s.clean(l));
    } catch (e) {
      console.error(`cleanup failed: ${s.clean((e as Error).message)}`);
      process.exitCode = 1;
    } finally {
      s.dispose();
    }
  } else {
    const { results, tail } = await runGate(ctx);
    report(results, tail, `result${part}.json`);
    console.log("Copy the lines above into the Review v2 rows G1 to G7 of integration-check.md.");
    if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
  }
}
