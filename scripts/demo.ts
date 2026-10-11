// Demo: the app on 127.0.0.1:7399 against a fake Bitbucket with synthetic data. No real server, data folder, or credential store.
// Reviews run the fake Claude Code CLI against a temp git remote. No real CLI and no network.
// The data covers every inbox group and every thread turn. Task IDs use the fictional key ABC.
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serveStatic } from "hono/bun";
import { writeConfig } from "../src/server/config";
import { setFollowed } from "../src/server/inbox/queries";
import { createLive } from "../src/server/live";
import { startServer } from "../src/server/main";
import { createReviewJobs } from "../src/server/review/jobs";
import { createSecrets } from "../src/server/secrets";
import { createSettings } from "../src/server/settings";
import { createSyncEngine } from "../src/server/sync/engine";
import { FAKE_TOKEN, FAKE_USER, fixture, key, startFakeBitbucket } from "../tests/support/fake-bitbucket";
import { claudeStream, fakeRunner, REVIEW_RESULT, reviewRemote, stubListTools } from "../tests/support/review-fixture";
import * as S from "../tests/support/scenarios";

// No import reads these at load time. Every call below also gets the folder and the memory store explicitly.
const dataDir = mkdtempSync(join(tmpdir(), "review-loop-demo-"));
process.env.REVIEW_LOOP_DATA_DIR = dataDir;
process.env.REVIEW_LOOP_SECRETS = "memory";

// The fake CLI, its stream, and the git remote. PR 81 has new commits, so its head is the "next" commit.
const claudeDir = mkdtempSync(join(tmpdir(), "review-loop-demo-claude-"));
const runner = fakeRunner(claudeDir);
runner.write({ fixture: claudeStream(claudeDir, "tree", "claude/b9-wp8-flags.jsonl", REVIEW_RESULT) });
const SOURCE_PRS = [1001, 1002, 31, 210, 212, 77, 74, 33, 215, 9, 5, 2];
const remote = await reviewRemote(claudeDir, { ...Object.fromEntries(SOURCE_PRS.map((id) => [id, "source" as const])), 81: "next" });

const PORT = 7399;
const WEB_DIR = resolve(import.meta.dir, "../dist/web");
const index = join(WEB_DIR, "index.html");
if (!existsSync(index)) {
  console.error(`Missing ${index}. Run "bun run build" first.`);
  process.exit(1);
}

type User = ReturnType<typeof S.secondUser>;
type Pr = S.RawPr & Record<string, unknown>;

const NOW = Date.now();
const min = (m: number) => NOW - m * 60_000;
const alex = S.secondUser();
const person = (slug: string, displayName: string): User => ({
  ...S.clone(alex),
  slug,
  name: slug,
  displayName,
  emailAddress: `${slug}@example.test`,
});
const maria = person("mlopez", "Maria Lopez");
const kenji = person("kito", "Kenji Ito");
const me = { ...S.clone(alex), slug: FAKE_USER, name: FAKE_USER, displayName: "Jordan Doe", emailAddress: `${FAKE_USER}@example.test` };

const fake = startFakeBitbucket();
const API = "/rest/api/1.0";
const prPath = (project: string, repo: string, id: number) => `${API}/projects/${project}/repos/${repo}/pull-requests/${id}`;

type Spec = {
  project: string;
  repo: string;
  id: number;
  title: string;
  author: User;
  reviewers: { user: User; status: string; lastReviewedCommit?: string }[];
  head: string;
  branch: string;
  minutes: number;
  description?: string;
};

function makePr(o: Spec): Pr {
  const pr = S.reviewPr() as Pr;
  const refs = [pr.fromRef, pr.toRef] as { displayId: string; repository: { slug: string; project: { key: string }; links: unknown } }[];
  for (const r of refs) {
    r.repository.slug = o.repo;
    r.repository.project.key = o.project;
    r.repository.links = { self: [{ href: `${fake.url}/projects/${o.project}/repos/${o.repo}/browse` }] };
  }
  Object.assign(pr, {
    id: o.id,
    title: o.title,
    description: o.description ?? "Synthetic demo data.",
    state: "OPEN",
    updatedDate: min(o.minutes),
    author: { user: o.author, role: "AUTHOR", approved: false, status: "UNAPPROVED" },
    reviewers: o.reviewers.map((r) => ({ role: "REVIEWER", approved: r.status === "APPROVED", ...r })),
    links: { self: [{ href: `${fake.url}/projects/${o.project}/repos/${o.repo}/pull-requests/${o.id}` }] },
  });
  pr.fromRef.latestCommit = o.head;
  (pr.toRef as { latestCommit: string }).latestCommit = remote.target;
  (refs[0] as { displayId: string }).displayId = o.branch;
  return pr;
}

const HEAD_A = remote.source;
const HEAD_B = remote.next;
// I review with this status. A last reviewed commit equal to the head means no new commits.
const reviewing = (user: User, status = "UNAPPROVED", lastReviewedCommit?: string) => [
  { user: me, status, lastReviewedCommit },
  { user, status: "UNAPPROVED" },
];

const prs = {
  // Your turn: an unread reply in my inline thread. Also a resolved thread and a thread between others.
  yourTurn: makePr({
    project: "PROJ1",
    repo: "sample-repo-2",
    id: 1001,
    title: "[ABC-10145] Take the cache lock inside evict",
    author: alex,
    reviewers: reviewing(maria, "NEEDS_WORK", HEAD_A),
    head: HEAD_A,
    branch: "bugfix/ABC-10145-evict-takes-cache-lock",
    minutes: 8,
    description: "evict() now takes the cache lock itself. The trim pass runs after the lock ends.",
  }),
  // Review requested, with a thread between two others.
  requested: makePr({
    project: "PROJ1",
    repo: "sample-repo-2",
    id: 1002,
    title: "Add retry budget to the upload client",
    author: maria,
    reviewers: reviewing(kenji),
    head: HEAD_A,
    branch: "feature/ABC-10620-retry-budget",
    minutes: 95,
  }),
  // New commits since my review. My last reply waits.
  commits: makePr({
    project: "PROJ1",
    repo: "sample-repo-3",
    id: 81,
    title: "Batch cache writes in the sync worker",
    author: alex,
    reviewers: reviewing(maria, "NEEDS_WORK", HEAD_A),
    head: HEAD_B,
    branch: "feature/ABC-10613-batch-writes",
    minutes: 50,
  }),
  // New comments between others on a PR that I approved. The description holds a key that the rules skip.
  comments: makePr({
    project: "PROJ2",
    repo: "api",
    id: 31,
    title: "Paginate the audit log query",
    author: alex,
    reviewers: reviewing(kenji, "APPROVED", HEAD_A),
    head: HEAD_A,
    branch: "feature/audit-paging",
    minutes: 600,
    description: "Part of ABC-10598. Keeps UTF-8 user names intact.",
  }),
  // Waiting on others: my reply is the newest message.
  waiting: makePr({
    project: "PROJ2",
    repo: "web-app",
    id: 210,
    title: "Show build status on the release page",
    author: kenji,
    reviewers: reviewing(alex, "NEEDS_WORK", HEAD_A),
    head: HEAD_A,
    branch: "feature/build-status",
    minutes: 170,
  }),
  // Quiet: one resolved thread.
  quiet: makePr({
    project: "PROJ2",
    repo: "web-app",
    id: 212,
    title: "Cache the release notes per tag",
    author: maria,
    reviewers: reviewing(kenji, "NEEDS_WORK", HEAD_A),
    head: HEAD_A,
    branch: "chore/ABC-10577-notes-cache",
    minutes: 2000,
  }),
  // D1: merged after a reply to me, so it stays in Needs you with "Merged." first.
  merging: makePr({
    project: "PROJ1",
    repo: "sample-repo-3",
    id: 77,
    title: "Drop the legacy export endpoint",
    author: kenji,
    reviewers: reviewing(maria, "APPROVED", HEAD_A),
    head: HEAD_A,
    branch: "chore/drop-export",
    minutes: 300,
  }),
  // Declined with no new message: Done.
  declined: makePr({
    project: "PROJ1",
    repo: "sample-repo-3",
    id: 74,
    title: "Inline the export helper",
    author: alex,
    reviewers: reviewing(kenji, "APPROVED", HEAD_A),
    head: HEAD_A,
    branch: "chore/ABC-10544-inline-export",
    minutes: 4000,
  }),
  // The activities fail in phase 2: the row shows an incomplete check.
  broken: makePr({
    project: "PROJ2",
    repo: "api",
    id: 33,
    title: "Index the audit log by user",
    author: maria,
    reviewers: reviewing(alex),
    head: HEAD_A,
    branch: "feature/ABC-10640-audit-index",
    minutes: 700,
  }),
  // My PR: two read threads by a reviewer, so it is my turn in two threads.
  authored: makePr({
    project: "PROJ2",
    repo: "web-app",
    id: 215,
    title: "Move date formatting into one helper",
    author: me,
    reviewers: [{ user: kenji, status: "NEEDS_WORK" }],
    head: HEAD_A,
    branch: "chore/ABC-10655-date-helper",
    minutes: 2900,
  }),
  // On the dashboard, but unfollowed below. It shows only in Reviewing.
  unfollowed: makePr({
    project: "PROJ3",
    repo: "tools",
    id: 9,
    title: "Pin the linter version",
    author: kenji,
    reviewers: reviewing(maria),
    head: HEAD_A,
    branch: "chore/pin-linter",
    minutes: 3100,
  }),
};
const own = Object.assign(S.ownPr() as Pr, {
  title: "[ABC-10701] Replace the polling timer with a scheduler",
  updatedDate: min(12),
  reviewers: [{ user: alex, role: "REVIEWER", approved: false, status: "NEEDS_WORK" }],
  links: { self: [{ href: `${fake.url}/users/${FAKE_USER}/repos/sample-repo-1/pull-requests/2` }] },
});
own.fromRef.latestCommit = remote.source;
(own.toRef as { repository: { links: unknown } }).repository.links = {
  self: [{ href: `${fake.url}/users/${FAKE_USER}/repos/sample-repo-1/browse` }],
};
(own.toRef as { latestCommit: string }).latestCommit = remote.target;
// Not on the dashboard. Paste its URL into the filter to follow it.
const extra = makePr({
  project: "PROJ3",
  repo: "tools",
  id: 5,
  title: "Lint the release scripts",
  author: maria,
  reviewers: [{ user: alex, status: "UNAPPROVED" }],
  head: HEAD_A,
  branch: "chore/lint-scripts",
  minutes: 45,
});

const pathOf = (p: Pr) => {
  const to = p.toRef as { repository: { slug: string; project: { key: string } } };
  return prPath(to.repository.project.key, to.repository.slug, p.id);
};

// Phase 1 is the first import: everything counts as read. Phase 2 adds new activity.
let phase = 1;
const base = () => S.activities("activities-nested-reply.json");
const ROOT = 1000003;

function reply(list: S.Activity[], parent: number, id: number, user: User, minutes: number, text: string) {
  const out = S.addReply(list, parent, id, user);
  const c = S.findComment(out, id);
  Object.assign(c, { text, createdDate: min(minutes), updatedDate: min(minutes) });
  return out;
}

// code: 7 lines around the commented line. The middle line is the commented, added line. task: a BLOCKER task in that state.
type ThreadOpts = { path?: string; line?: number; resolved?: boolean; code?: string[]; task?: "OPEN" | "RESOLVED" };

// The activity diff of an inline comment, in the shape of fixtures/bitbucket/activities-v3-after-write.json.
function diffOf(line: number, code: string[]) {
  const at = (i: number) => ({ source: line - 3 + (i > 3 ? i - 1 : i), destination: line - 3 + i, line: code[i] ?? "", truncated: false });
  const seg = (type: string, from: number, to: number) => ({
    type,
    lines: code.slice(from, to).map((_, k) => at(from + k)),
    truncated: false,
  });
  return {
    hunks: [{ segments: [seg("CONTEXT", 0, 3), seg("ADDED", 3, 4), seg("CONTEXT", 4, code.length)], truncated: false }],
    truncated: false,
  };
}

// A new root comment. A path gives an inline comment on an added line.
function thread(list: S.Activity[], id: number, user: User, minutes: number, text: string, o: ThreadOpts = {}): S.Activity[] {
  const root = S.clone(S.findComment(base(), ROOT));
  Object.assign(root, { id, version: 0, text, author: user, createdDate: min(minutes), updatedDate: min(minutes), comments: [] });
  if (o.path) root.anchor = { path: o.path, line: o.line, lineType: "ADDED", fileType: "TO" };
  if (o.resolved) root.threadResolved = true;
  if (o.task) Object.assign(root, { severity: "BLOCKER", state: o.task, version: o.task === "RESOLVED" ? 1 : 0 });
  const diff = o.code && o.line ? { diff: diffOf(o.line, o.code) } : {};
  return [...S.clone(list), { id: id + 9_000_000, action: "COMMENTED", commentAction: "ADDED", comment: root, ...diff }];
}

const none = (): S.Activity[] => [];

const activities = new Map<Pr, () => S.Activity[]>([
  [
    prs.yourTurn,
    () => {
      let t = thread(none(), 1100, me, 300, "Does evict() still need the caller to hold the lock?", {
        path: "src/cache/evict.ts",
        line: 42,
        code: [
          "export function evict(cache: Cache, budget: number) {",
          "  let freed = 0;",
          "  for (const key of cache.oldest()) {",
          "    cache.lock.acquire();",
          "    freed += cache.drop(key);",
          "    if (freed >= budget) break;",
          "  }",
        ],
      });
      t = thread(t, 1140, maria, 275, "Add a test for an empty cache before this merges.", { task: "OPEN" });
      t = thread(t, 1110, maria, 280, "Typo in the comment above trim().", { path: "src/cache/trim.ts", line: 8, resolved: true });
      t = reply(t, 1110, 1111, alex, 270, "Fixed.");
      t = thread(t, 1120, maria, 260, "Can the eviction policy own the budget?");
      // A read side branch of 3 messages folds to one row.
      t = reply(t, 1120, 1130, kenji, 258, "The budget also feeds the stats page.");
      t = reply(t, 1130, 1131, maria, 257, "Then the stats page reads it from the policy.");
      t = reply(t, 1131, 1132, kenji, 256, "Fine with me.");
      // A main line deeper than 4 levels: the middle folds, and replies below level 4 quote their parent.
      t = reply(t, 1120, 1121, alex, 250, "Yes. That comes in the next pull request.");
      t = reply(t, 1121, 1122, me, 240, "Then keep the budget field private until then.");
      t = reply(t, 1122, 1123, alex, 230, "It is private now. The config reads it through a getter.");
      t = reply(t, 1123, 1124, maria, 220, "The getter copies the struct on every call.");
      t = reply(t, 1124, 1125, alex, 210, "It returns a const reference now.");
      return phase === 1 ? t : reply(t, 1100, 1101, alex, 8, "It takes the cache lock itself now. Callers must not lock.");
    },
  ],
  [
    prs.requested,
    () => reply(thread(none(), 1200, kenji, 90, "Is the budget per request or per upload?"), 1200, 1201, maria, 85, "Per upload."),
  ],
  [
    prs.commits,
    () => {
      let t = thread(none(), 1300, me, 400, "Flush the batch before the write lock?", {
        path: "src/sync/worker.ts",
        line: 118,
        code: [
          "  async run(batch: Write[]) {",
          "    const lock = await this.store.writeLock();",
          "    try {",
          "      await this.flush(batch);",
          "      await this.store.commit();",
          "    } finally {",
          "      lock.release();",
        ],
      });
      t = reply(t, 1300, 1301, alex, 380, "Done in the next push.");
      return reply(t, 1300, 1302, me, 370, "Thanks. I will look again after the push.");
    },
  ],
  [
    prs.comments,
    () => {
      if (phase === 1) return none();
      const t = thread(none(), 1400, kenji, 40, "The cursor skips rows with equal timestamps.", { path: "src/audit/query.ts", line: 57 });
      return reply(t, 1400, 1401, alex, 25, "Good catch. I add the row ID as a tiebreak.");
    },
  ],
  [
    prs.waiting,
    () => {
      let t = thread(none(), 1500, me, 200, "Does the badge update without a reload?");
      t = reply(t, 1500, 1501, kenji, 180, "Yes, through the poll.");
      return reply(t, 1500, 1502, me, 170, "Then show the time of the last poll next to it.");
    },
  ],
  [
    prs.quiet,
    () =>
      reply(thread(none(), 1600, kenji, 2100, "Is the cache size capped?", { resolved: true }), 1600, 1601, me, 2050, "Yes, at 50 tags."),
  ],
  [
    prs.merging,
    () => {
      const t = thread(none(), 1700, me, 400, "Is any client still on the export endpoint?");
      return phase === 1 ? t : reply(t, 1700, 1701, kenji, 15, "None in the logs since May. Merged. Thanks for the quick review.");
    },
  ],
  [prs.declined, () => thread(none(), 1800, me, 4100, "This moves the helper back into three files. Is that the plan?")],
  [prs.broken, none],
  [
    prs.authored,
    () => {
      const t = thread(none(), 1900, kenji, 2800, "Use Intl.DateTimeFormat here.", { path: "src/date/format.ts", line: 12 });
      return thread(t, 1910, kenji, 2790, "Please add a test for the leap day.", { task: "RESOLVED" });
    },
  ],
  [prs.unfollowed, none],
  [
    own,
    () => {
      if (phase === 1) return base();
      return reply(
        reply(base(), ROOT, 1000040, alex, 6, "The scheduler drops a tick on wake."),
        ROOT,
        1000041,
        kenji,
        3,
        "Seen the same on my laptop.",
      );
    },
  ],
  [extra, base],
]);

// Commits and changed files of each PR (plan v3 WP4). PR 81 has one commit after my review.
const [recorded] = fixture<{ values: Record<string, unknown>[] }>("pull-request-commits-page.json").body.values;
const commit = (id: string, parent: string, message: string, author: User, minutes: number) => ({
  ...S.clone(recorded),
  id,
  displayId: id.slice(0, 11),
  message,
  author,
  committer: author,
  authorTimestamp: min(minutes),
  committerTimestamp: min(minutes),
  parents: [{ id: parent, displayId: parent.slice(0, 11) }],
});
const FILES = new Map<Pr, [string, string][]>([
  [
    prs.yourTurn,
    [
      ["MODIFY", "src/cache/evict.ts"],
      ["MODIFY", "src/cache/trim.ts"],
      ["ADD", "src/cache/evict.test.ts"],
    ],
  ],
  [
    prs.commits,
    [
      ["MODIFY", "src/sync/worker.ts"],
      ["DELETE", "src/sync/legacy-queue.ts"],
    ],
  ],
  [
    prs.authored,
    [
      ["MODIFY", "src/date/format.ts"],
      ["MOVE", "src/date/parse.ts"],
    ],
  ],
]);
const change = ([type, path]: [string, string]) => ({
  path: { toString: path },
  ...(type === "MOVE" && { srcPath: { toString: path.replace("src/date/", "src/util/") } }),
  type,
});

// Merged and declined in phase 2. Both leave the dashboard and stay followed.
const closed = new Map<Pr, string>([
  [prs.merging, "MERGED"],
  [prs.declined, "DECLINED"],
]);

let firstId = 5_000_000;
for (const [pr, list] of activities) {
  // Posted comments and replies show in the next sync (plan v3 WP13a).
  const posts = S.commentPosts(pathOf(pr), list, me, firstId);
  firstId += 10_000;
  Object.assign(fake.routes, posts.routes);
  fake.routes[key("GET", `${pathOf(pr)}/activities`)] = () =>
    phase === 2 && pr === prs.broken
      ? { status: 500, body: { errors: [{ message: "Internal error." }] } }
      : { status: 200, body: S.onePage(posts.activities()) };
  const author = (pr.author as { user: User }).user;
  const head = pr.fromRef.latestCommit;
  const title = String(pr.title).replace(/^\[[A-Z0-9-]+\] /, "");
  const commits =
    head === HEAD_B
      ? [commit(HEAD_B, HEAD_A, "Flush the batch before the write lock", author, 60), commit(HEAD_A, remote.target, title, author, 500)]
      : [commit(head, remote.target, title, author, 500)];
  fake.routes[key("GET", `${pathOf(pr)}/commits`)] = { status: 200, body: S.onePage(commits) };
  fake.routes[key("GET", `${pathOf(pr)}/changes`)] = { status: 200, body: S.onePage((FILES.get(pr) ?? []).map(change)) };
  fake.routes[key("GET", pathOf(pr))] = () => {
    const state = phase === 2 ? closed.get(pr) : undefined;
    return { status: 200, body: state ? { ...pr, state, updatedDate: min(15) } : pr };
  };
}

fake.routes[key("GET", S.DASHBOARD_PATH)] = (req) => {
  const role = new URL(req.url).searchParams.get("role");
  const open = Object.values(prs).filter((p) => p !== prs.authored && !(phase === 2 && closed.has(p)));
  return { status: 200, body: S.onePage(role === "AUTHOR" ? [own, prs.authored] : open) };
};

// The prototype rules: every source, the default pattern, only the fictional key ABC.
const pattern = String.raw`[A-Z][A-Z0-9]+-\d+`;
writeConfig(dataDir, {
  baseUrl: fake.url,
  userSlug: FAKE_USER,
  notifications: false,
  taskRules: (["branch", "title", "description"] as const).map((source) => ({ source, pattern, keys: ["ABC"] })),
  taskLink: "https://tracker.example.test/browse/{key}",
});
const secrets = createSecrets(null);
await secrets.set(FAKE_TOKEN);
const settings = createSettings({ dir: dataDir, secrets });
const live = createLive();
const sync = createSyncEngine({ settings, live });
const review = createReviewJobs({
  settings,
  live,
  dataDir,
  runnerCommand: runner.command,
  listTools: stubListTools,
  gitRemote: remote.gitRemote,
});

await sync.syncNow();
const db = settings.db();
const hidden = db?.query("SELECT id FROM pull_request WHERE project = 'PROJ3' AND pr_id = 9").get() as { id: number } | null;
if (db && hidden) setFollowed(db, hidden.id, false);
phase = 2;
await sync.syncNow();

const server = startServer({
  port: PORT,
  token: randomBytes(32).toString("hex"),
  live,
  settings,
  sync,
  review,
  indexHtml: readFileSync(index, "utf8"),
  assets: serveStatic({ root: WEB_DIR }),
});
sync.start();
void review.start();

console.log(`Review Loop demo: http://127.0.0.1:${server.port}/ (pid ${process.pid})`);
console.log(`Fake Bitbucket: ${fake.url}. Data: ${dataDir}`);
console.log(`Follow by URL: paste ${fake.url}/projects/PROJ3/repos/tools/pull-requests/5 into the filter.`);

async function stop() {
  sync.stop();
  await review.stop();
  server.stop(true);
  fake.stop();
  db?.close();
  for (const dir of [dataDir, claudeDir])
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
