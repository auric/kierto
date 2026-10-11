// E2E server: the fake Bitbucket on FAKE_URL and the app on APP_PORT in one process (control.ts). Test code only.
// The app gets a temp data folder and memory secrets. It never sees the real data folder or the credential store.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serveStatic } from "hono/bun";
import { createLive } from "../../src/server/live";
import { startServer } from "../../src/server/main";
import { createOutbox } from "../../src/server/publish/outbox";
import { createReviewJobs } from "../../src/server/review/jobs";
import { createSecrets } from "../../src/server/secrets";
import { createSettings } from "../../src/server/settings";
import { createSyncEngine } from "../../src/server/sync/engine";
import { FAKE_USER, key, type Reply, startFakeBitbucket } from "../support/fake-bitbucket";
import { claudeStream, fakeRunner, REVIEW_RESULT, reviewRemote, stubListTools } from "../support/review-fixture";
import * as S from "../support/scenarios";
import { APP_PORT, type ClaudeScenario, E2E_TOKEN, FAKE_URL, type PostControl, type Scenario } from "./control";

const dataDir = mkdtempSync(join(tmpdir(), "review-loop-e2e-"));
process.env.REVIEW_LOOP_DATA_DIR = dataDir;
process.env.REVIEW_LOOP_SECRETS = "memory";

// The fake Claude Code CLI and the git remote of the reviews. Their folder stays outside the data folder, so a reset keeps them.
const claudeDir = mkdtempSync(join(tmpdir(), "review-loop-e2e-claude-"));
const runner = fakeRunner(claudeDir);
const runnerCommand = runner.command;

// ---------- Review data (plan v3 WP11) ----------
// Every e2e PR has its source head at refs/pull-requests/<id>/from and its target head at main.
const remote = await reviewRemote(claudeDir, { 1001: "source", 210: "source", 77: "source" });

const STREAMS: Record<ClaudeScenario["stream"], string> = {
  // b9: the main agent, two refused agents, and one rl-reviewer subagent with three calls.
  tree: claudeStream(claudeDir, "tree", "claude/b9-wp8-flags.jsonl", REVIEW_RESULT),
  schema: claudeStream(claudeDir, "schema", "claude/b9-wp8-flags.jsonl", { summary: "SCHEMA-CANARY", findings: "none" }),
  limit: claudeStream(claudeDir, "limit", "claude-synthetic/usage-limit.jsonl"),
};
function setClaude(c: ClaudeScenario) {
  runner.write({ fixture: STREAMS[c.stream], exitCode: c.stream === "limit" ? 1 : 0, hang: c.hang, replies: c.replies });
}
setClaude({ stream: "tree" });

const WEB_DIR = resolve(import.meta.dir, "../../dist/web");
const index = join(WEB_DIR, "index.html");
if (!existsSync(index)) {
  console.error(`Missing ${index}. Run "bun run build" first.`);
  process.exit(1);
}
const indexHtml = readFileSync(index, "utf8");

const INITIAL: Scenario = { reply: "none", turns: 0, tall: 0, merge: "open", down: false };
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
// Long names with few break points test the pane widths.
const B = makePr(
  "PLATFORM_RELEASE_ENGINEERING_TOOLS",
  "release-pipeline-observability-dashboard",
  210,
  "Show build status on the release page",
  maria,
  "APPROVED",
);
Object.assign(B.pr.fromRef, {
  id: "refs/heads/feature/release_pipeline_observability_dashboard_rollout",
  displayId: "feature/release_pipeline_observability_dashboard_rollout",
});
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

function repliesA(): S.Activity[] {
  if (sc.reply === "none" || sc.reply === "absent" || sc.reply === "deleted") return base();
  const out = sc.reply === "two" ? addReply(withReply(), ROOT, 1000011, maria, "One more point: keep the flush order.") : withReply();
  const dup = out.find((a) => a.comment);
  // The same activity twice, in reversed order.
  return sc.reply === "dup" && dup ? [...out, S.clone(dup)].reverse() : out;
}

function activitiesA(): S.Activity[] {
  let out = repliesA();
  for (let i = 1; i <= sc.turns; i++) {
    const root = S.clone(S.findComment(base(), ROOT));
    const at = T0 + i * 10;
    Object.assign(root, { id: 1000100 + i, version: 0, text: `Point ${i}: the flush must run first.`, author: me, comments: [] });
    Object.assign(root, { createdDate: at, updatedDate: at });
    out = [...out, { id: 10000100 + i, action: "COMMENTED", commentAction: "ADDED", comment: root }];
    out = addReply(out, 1000100 + i, 1000200 + i, alex, `Why must point ${i} run first?`);
  }
  return out;
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

// The comments that the app posts (plan v3 WP13a). They show in the activities of the next sync.
const postsA = S.commentPosts(A.path, activitiesA, me, 4_000_001);
const postsB = S.commentPosts(B.path, activitiesB, me, 4_100_001);
const postsC = S.commentPosts(C.path, activitiesC, me, 4_200_001);

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
// PR A posts (plan v3 WP14a): fail answers the next comment POST with this status. hide drops the activities of PR A.
const postA = { fail: null as number | null, hide: false };
r[key("GET", `${A.path}/activities`)] = (req) => (postA.hide ? DROP : paged(postsA.activities(), req, "null"));
r[key("GET", `${B.path}/activities`)] = () => ok(S.onePage(postsB.activities()));
r[key("GET", `${C.path}/activities`)] = (req) => paged(postsC.activities(), req, "absent");
Object.assign(r, postsA.routes, postsB.routes, postsC.routes);
const sendA = r[key("POST", `${A.path}/comments`)];
r[key("POST", `${A.path}/comments`)] = async (req) => {
  if (postA.fail === null) return typeof sendA === "function" ? sendA(req) : NOT_FOUND;
  const status = postA.fail;
  postA.fail = null;
  return { status, body: { errors: [{ message: "Refused by the e2e scenario." }] } };
};
r[key("GET", `${A.path}/comments/1000010`)] = () => (sc.reply === "deleted" ? NOT_FOUND : ok(S.findComment(withReply(), 1000010)));

// The app. A restart keeps the data folder and the secret store, as a process restart with the OS store does.
let secrets = createSecrets(null);
function boot() {
  const live = createLive();
  const settings = createSettings({ dir: dataDir, secrets });
  const sync = createSyncEngine({ settings, live });
  const review = createReviewJobs({ settings, live, dataDir, runnerCommand, listTools: stubListTools, gitRemote: remote.gitRemote });
  const outbox = createOutbox({ settings, live });
  const server = startServer({
    port: APP_PORT,
    token: randomBytes(32).toString("hex"),
    live,
    settings,
    sync,
    review,
    outbox,
    indexHtml,
    assets: serveStatic({ root: WEB_DIR }),
  });
  sync.start();
  void review.start();
  outbox.start();
  return { server, settings, sync, review, outbox };
}
let app = boot();

async function halt() {
  app.sync.stop();
  await app.review.stop();
  await app.outbox.stop();
  await app.server.stop(true);
  // Windows cannot remove an open SQLite file.
  app.settings.close();
}

const NO_CONTENT: Reply = { status: 204 };
r[key("POST", "/__control/reset")] = async () => {
  await halt();
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir);
  secrets = createSecrets(null);
  sc = { ...INITIAL };
  for (const p of [postsA, postsB, postsC]) p.reset();
  Object.assign(postA, { fail: null, hide: false });
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
// Changes the PR A post scenario. Answers with the comment POST bodies that PR A got so far.
r[key("POST", "/__control/posts")] = async (req) => {
  const change = (await req.json()) as PostControl;
  if (change.drop !== undefined) postsA.drop = change.drop;
  if (change.fail !== undefined) postA.fail = change.fail;
  if (change.hide !== undefined) postA.hide = change.hide;
  return ok({ bodies: postsA.bodies });
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
// A run from a worktree must show which checkout it serves.
console.log(`E2E code: ${import.meta.dir}. UI: ${WEB_DIR}`);
