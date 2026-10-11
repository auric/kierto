// E2E server: the fake Bitbucket on 127.0.0.1:7398 and the app on 127.0.0.1:7399 in one process. Test code only.
// The app gets a temp data folder and memory secrets. It never sees the real data folder or the credential store.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serveStatic } from "hono/bun";
import { createLive } from "../../src/server/live";
import { startServer } from "../../src/server/main";
import { DOC_SERVERS } from "../../src/server/review/catalog";
import { git, gitEnv } from "../../src/server/review/git";
import { createReviewJobs } from "../../src/server/review/jobs";
import { createSecrets } from "../../src/server/secrets";
import { createSettings } from "../../src/server/settings";
import { createSyncEngine } from "../../src/server/sync/engine";
import { FAKE_USER, key, type Reply, startFakeBitbucket } from "../support/fake-bitbucket";
import type { FakeScenario } from "../support/fake-claude";
import * as S from "../support/scenarios";
import { APP_PORT, type ClaudeScenario, E2E_TOKEN, FAKE_URL, type Scenario } from "./control";

const dataDir = mkdtempSync(join(tmpdir(), "review-loop-e2e-"));
process.env.REVIEW_LOOP_DATA_DIR = dataDir;
process.env.REVIEW_LOOP_SECRETS = "memory";

// The fake Claude Code CLI and the git remote of the reviews. Their folder stays outside the data folder, so a reset keeps them.
const claudeDir = mkdtempSync(join(tmpdir(), "review-loop-e2e-claude-"));
const claudeScenario = join(claudeDir, "scenario.json");
const runnerCommand = [process.execPath, resolve(import.meta.dir, "../support/fake-claude.ts"), claudeScenario];

// ---------- Review data (plan v3 WP11) ----------
// A bare remote. Every e2e PR has its source head at refs/pull-requests/<id>/from and its target head at main.
const FLUSH_BASE = [
  "export function flush(cache: Cache) {",
  "  const lock = cache.lock();",
  "  for (const entry of cache.dirty()) {",
  "    write(entry);",
  "  }",
  "  lock.release();",
  "}",
  "",
].join("\n");
const FLUSH_HEAD = [
  "export function flush(cache: Cache) {",
  "  for (const entry of cache.dirty()) {",
  "    const lock = cache.lock();",
  "    write(entry);",
  "    lock.release();",
  "  }",
  "}",
  "",
].join("\n");
const PR_IDS = [1001, 210, 77];

async function reviewRemote(root: string) {
  const empty = join(root, "empty.gitconfig");
  writeFileSync(empty, "");
  const remote = join(root, "remote.git");
  const env = {
    ...gitEnv(empty),
    GIT_AUTHOR_NAME: "e2e",
    GIT_AUTHOR_EMAIL: "e2e@example.invalid",
    GIT_COMMITTER_NAME: "e2e",
    GIT_COMMITTER_EMAIL: "e2e@example.invalid",
    GIT_INDEX_FILE: join(root, "e2e.index"),
  };
  const g = async (args: string[], stdin?: string) => (await git(["--git-dir", remote, ...args], { env, stdin })).trim();
  await git(["init", "-q", "--bare", "--template=", remote], { env });
  let n = 0;
  async function commit(parent: string | null, files: Record<string, string>, msg: string) {
    await g(parent ? ["read-tree", parent] : ["read-tree", "--empty"]);
    const entries = Object.entries(files);
    const blobs = entries.map(([, text]) => {
      const f = join(root, `blob-${n++}`);
      writeFileSync(f, text);
      return f;
    });
    const shas = (await g(["hash-object", "-w", "--no-filters", "--stdin-paths"], `${blobs.join("\n")}\n`)).split("\n");
    await g(["update-index", "--index-info"], `${entries.map(([path], i) => `100644 ${shas[i]}\t${path}`).join("\n")}\n`);
    return g(["commit-tree", await g(["write-tree"]), ...(parent ? ["-p", parent] : []), "-m", msg]);
  }
  const base = await commit(null, { "src/cache/flush.ts": FLUSH_BASE, "README.md": "# Sample\n" }, "base");
  const target = await commit(base, { "docs/main.md": "main\n" }, "main moves");
  const source = await commit(base, { "src/cache/flush.ts": FLUSH_HEAD }, "Lock each entry");
  await g(["update-ref", "refs/heads/main", target]);
  await g(["update-ref", "refs/heads/feature", source]);
  for (const id of PR_IDS) await g(["update-ref", `refs/pull-requests/${id}/from`, source]);
  return { remote, source, target };
}
const remote = await reviewRemote(claudeDir);

// The structured result of a review: an exact, a moved, and an outside finding, one dropped finding, and one question.
const finding = (o: Record<string, unknown>) => ({
  path: "src/cache/flush.ts",
  side: "new",
  lineEnd: null,
  category: "Concurrency",
  evidenceStatus: "code",
  confidence: "high",
  agent: null,
  evidence: "",
  ...o,
});
const RESULT = {
  summary: "The lock moves into the loop. A reader can see a partly flushed batch.",
  risks: ["Lock scope in `flush()`.", "Readers of the cache during a flush."],
  questions: [
    { text: "Must `flush()` stay atomic for readers?", why: "The description does not say if a reader may see a partial batch." },
  ],
  coverage: {
    read: ["src/cache/flush.ts"],
    skipped: [],
    unavailable: [],
    notChecked: ["Tests did not run, because the review has read-only tools."],
  },
  findings: [
    finding({
      line: 3,
      anchorText: "const lock = cache.lock();",
      severity: "blocker",
      body: "The lock now covers one entry at a time. Another writer can run between two entries. Take the lock once, before the loop.",
      evidence: "`write()` reads `cache.version` without the lock.",
      agent: "rl-reviewer",
    }),
    finding({
      line: 6,
      anchorText: "lock.release();",
      severity: "minor",
      category: "Error handling",
      body: "`lock.release()` does not run when `write()` throws. Release the lock in a `finally` block.",
      confidence: "medium",
    }),
    finding({
      path: "README.md",
      line: 1,
      anchorText: "# Sample",
      severity: "nit",
      category: "Documentation",
      body: "The README does not name the flush order.",
    }),
    finding({
      path: "src/cache/gone.ts",
      line: 4,
      anchorText: "evict()",
      severity: "major",
      body: "A file that the snapshot does not have.",
    }),
  ],
};

// Real Gate B streams with the init tools and MCP servers of a review run, and the given structured output.
const GIT_TOOLS = ["git_log", "git_blame", "git_show", "git_diff"].map((t) => `mcp__rl-git__${t}`);
const REVIEW_TOOLS = ["Task", "Read", "Grep", "Glob", ...GIT_TOOLS, "StructuredOutput"];
const FIXTURES = resolve(import.meta.dir, "../../fixtures");
function derive(name: string, file: string, structured?: unknown) {
  const lines = readFileSync(join(FIXTURES, file), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const e = JSON.parse(l);
      if (e.type === "system" && e.subtype === "init")
        return {
          ...e,
          tools: REVIEW_TOOLS,
          mcp_servers: ["rl-git", ...Object.keys(DOC_SERVERS)].map((s) => ({ name: s, status: "connected", source: "dynamic" })),
        };
      return e.type === "result" && structured !== undefined ? { ...e, structured_output: structured } : e;
    });
  const out = join(claudeDir, `${name}.jsonl`);
  writeFileSync(out, `${lines.map((e) => JSON.stringify(e)).join("\n")}\n`);
  return out;
}
const STREAMS: Record<ClaudeScenario["stream"], string> = {
  // b9: the main agent, two refused agents, and one rl-reviewer subagent with three calls.
  tree: derive("tree", "claude/b9-wp8-flags.jsonl", RESULT),
  schema: derive("schema", "claude/b9-wp8-flags.jsonl", { summary: "SCHEMA-CANARY", findings: "none" }),
  limit: derive("limit", "claude-synthetic/usage-limit.jsonl"),
};
function setClaude(c: ClaudeScenario) {
  writeFileSync(
    claudeScenario,
    JSON.stringify({
      record: join(claudeDir, "calls.jsonl"),
      auth: { loggedIn: true, authMethod: "claude.ai", projectsDirectory: join(claudeDir, "projects") },
      fixture: STREAMS[c.stream],
      exitCode: c.stream === "limit" ? 1 : 0,
      hang: c.hang,
      delayMs: 5,
    } satisfies FakeScenario),
  );
}
setClaude({ stream: "tree" });

const WEB_DIR = resolve(import.meta.dir, "../../dist/web");
const index = join(WEB_DIR, "index.html");
if (!existsSync(index)) {
  console.error(`Missing ${index}. Run "bun run build" first.`);
  process.exit(1);
}
const indexHtml = readFileSync(index, "utf8");

const INITIAL: Scenario = { reply: "none", tall: 0, merge: "open", down: false };
let sc: Scenario = { ...INITIAL };

// Scenario data.
const T0 = Date.now() - 60 * 60_000;
const ROOT = 1000003;
const alex = S.secondUser();
const person = (slug: string, displayName: string) => ({
  ...S.clone(alex),
  slug,
  name: slug,
  displayName,
  emailAddress: `${slug}@example.test`,
});
const maria = person("mlopez", "Maria Lopez");
const kenji = person("kito", "Kenji Ito");
const me = person(FAKE_USER, "Jordan Doe");
const API = "/rest/api/1.0";

function makePr(project: string, repo: string, id: number, title: string, author: unknown, myStatus: string) {
  const pr = S.reviewPr() as S.RawPr & {
    fromRef: { repository: Repo; latestCommit: string };
    toRef: { repository: Repo; latestCommit: string };
  };
  for (const r of [pr.fromRef, pr.toRef]) Object.assign(r.repository, { slug: repo, project: { ...r.repository.project, key: project } });
  pr.fromRef.latestCommit = remote.source;
  pr.toRef.latestCommit = remote.target;
  Object.assign(pr, {
    id,
    title,
    description: "Synthetic e2e data.",
    author: { user: author, role: "AUTHOR", approved: false, status: "UNAPPROVED" },
    reviewers: [{ user: me, role: "REVIEWER", approved: myStatus === "APPROVED", status: myStatus }],
    links: { self: [{ href: `${FAKE_URL}/projects/${project}/repos/${repo}/pull-requests/${id}` }] },
  });
  return { pr, path: `${API}/projects/${project}/repos/${repo}/pull-requests/${id}` };
}
type Repo = { slug: string; project: { key: string } };

const A = makePr("PROJ1", "sample-repo-2", 1001, "Batch cache writes in the sync worker", alex, "UNAPPROVED");
const B = makePr("PROJ2", "web-app", 210, "Show build status on the release page", maria, "APPROVED");
const C = makePr("PROJ1", "sample-repo-3", 77, "Drop the legacy export endpoint", kenji, "APPROVED");

const base = () => S.activities("activities-nested-reply.json");
const long = (label: string) =>
  Array.from({ length: 14 }, (_, i) => `${label}, point ${i + 1}: the cache flush must run before the write lock.`).join("\n\n");

function addReply(list: S.Activity[], parent: number, id: number, user: unknown, text: string, version = 0) {
  const out = S.addReply(list, parent, id, user);
  Object.assign(S.findComment(out, id), { text, version, createdDate: T0 + (id % 1000), updatedDate: T0 + (id % 1000) });
  return out;
}

const withReply = () =>
  sc.reply === "edit"
    ? addReply(base(), ROOT, 1000010, alex, "Edited: the flush order is fixed now.", 1)
    : addReply(base(), ROOT, 1000010, alex, "Can you check the flush order again?");

function activitiesA(): S.Activity[] {
  if (sc.reply === "none" || sc.reply === "absent" || sc.reply === "deleted") return base();
  const out = withReply();
  const dup = out.find((a) => a.comment);
  // The same activity twice, in reversed order.
  return sc.reply === "dup" && dup ? [...out, S.clone(dup)].reverse() : out;
}

function activitiesB(): S.Activity[] {
  const list = base();
  if (!sc.tall) return list;
  const root = S.clone(S.findComment(list, ROOT));
  Object.assign(root, {
    id: 2000000,
    version: 0,
    text: long("Thread start"),
    author: maria,
    createdDate: T0,
    updatedDate: T0,
    comments: [],
  });
  let out: S.Activity[] = [...list, { id: 20000000, action: "COMMENTED", commentAction: "ADDED", comment: root }];
  for (let i = 1; i <= sc.tall; i++) out = addReply(out, 2000000, 2000000 + i, i % 2 ? kenji : maria, long(`Reply ${i}`));
  return out;
}

const activitiesC = () => (sc.merge === "open" ? base() : addReply(base(), ROOT, 3000001, kenji, "Merged. Thanks for the quick review."));

const ok = (body: unknown): Reply => ({ status: 200, body });
const DROP: Reply = { drop: true };
const NOT_FOUND: Reply = { status: 404, body: { errors: [{ message: "Not found." }] } };
const start = (req: Request) => Number(new URL(req.url).searchParams.get("start") ?? 0);
// One value per page, so every list has several pages.
const paged = <T>(values: T[], req: Request, last: "absent" | "null") => {
  const p = S.pages(
    values,
    values.map(() => 1),
    last,
  ).find((x) => x.start === start(req));
  return p ? ok(p) : ok(S.onePage([]));
};

const fake = startFakeBitbucket({ port: Number(new URL(FAKE_URL).port) });
fake.token = E2E_TOKEN;
const r = fake.routes;
r[key("GET", S.DASHBOARD_PATH)] = (req) => {
  if (new URL(req.url).searchParams.get("role") === "AUTHOR") return sc.down ? DROP : ok(S.onePage([]));
  if (sc.down && start(req) > 0) return DROP;
  return paged(sc.merge === "merged" ? [A.pr, B.pr] : [A.pr, B.pr, C.pr], req, "absent");
};
r[key("GET", A.path)] = ok(A.pr);
r[key("GET", B.path)] = ok(B.pr);
r[key("GET", C.path)] = () => ok(sc.merge === "merged" ? { ...C.pr, state: "MERGED" } : C.pr);
r[key("GET", `${A.path}/activities`)] = (req) => paged(activitiesA(), req, "null");
r[key("GET", `${B.path}/activities`)] = () => ok(S.onePage(activitiesB()));
r[key("GET", `${C.path}/activities`)] = (req) => paged(activitiesC(), req, "absent");
r[key("GET", `${A.path}/comments/1000010`)] = () => (sc.reply === "deleted" ? NOT_FOUND : ok(S.findComment(withReply(), 1000010)));

// The app. A restart keeps the data folder and the secret store, as a process restart with the OS store does.
let secrets = createSecrets(null);
function boot() {
  const live = createLive();
  const settings = createSettings({ dir: dataDir, secrets });
  const sync = createSyncEngine({ settings, live });
  // No e2e run reaches the documentation servers. The stub names one tool per server.
  const listTools = async (url: string): Promise<string[]> => [url === DOC_SERVERS.learn ? "docs_search" : "ask_question"];
  const gitRemote = async () => ({
    url: remote.remote,
    sourceUrl: remote.remote,
    sourceRef: "refs/heads/feature",
    targetRef: "refs/heads/main",
    fetchConfig: [] as [string, string][],
  });
  const review = createReviewJobs({ settings, live, dataDir, runnerCommand, listTools, gitRemote });
  const server = startServer({
    port: APP_PORT,
    token: randomBytes(32).toString("hex"),
    live,
    settings,
    sync,
    review,
    indexHtml,
    assets: serveStatic({ root: WEB_DIR }),
  });
  sync.start();
  void review.start();
  return { server, settings, sync, review };
}
let app = boot();

async function halt() {
  app.sync.stop();
  await app.review.stop();
  await app.server.stop(true);
  // Windows cannot remove an open SQLite file.
  app.settings.db()?.close();
}

const NO_CONTENT: Reply = { status: 204 };
r[key("POST", "/__control/reset")] = async () => {
  await halt();
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir);
  secrets = createSecrets(null);
  sc = { ...INITIAL };
  setClaude({ stream: "tree" });
  app = boot();
  return NO_CONTENT;
};
// The stream and the mode of the next fake CLI run.
r[key("POST", "/__control/claude")] = async (req) => {
  setClaude((await req.json()) as ClaudeScenario);
  return NO_CONTENT;
};
r[key("POST", "/__control/restart")] = async () => {
  await halt();
  app = boot();
  return NO_CONTENT;
};
// Lets the running cycle end, changes the scenario, then runs one full cycle.
r[key("POST", "/__control/state")] = async (req) => {
  const change = (await req.json()) as Partial<Scenario>;
  await app.sync.syncNow();
  Object.assign(sc, change);
  await app.sync.syncNow();
  return ok(app.sync.status());
};
r[key("POST", "/__control/shutdown")] = () => {
  setTimeout(stop, 10);
  return NO_CONTENT;
};

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await halt();
  fake.stop();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(claudeDir, { recursive: true, force: true });
  process.exit(0);
}
// Playwright kills the process without a signal on Windows. The global teardown calls the shutdown route first.
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

console.log(`E2E app: http://127.0.0.1:${APP_PORT}/ (pid ${process.pid}). Fake Bitbucket: ${fake.url}. Data: ${dataDir}`);
