// Demo: the app on 127.0.0.1:7399 against a fake Bitbucket with synthetic data. No real server, data folder, or credential store.
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serveStatic } from "hono/bun";
import { writeConfig } from "../src/server/config";
import { setFollowed } from "../src/server/inbox/queries";
import { createLive } from "../src/server/live";
import { startServer } from "../src/server/main";
import { createSecrets } from "../src/server/secrets";
import { createSettings } from "../src/server/settings";
import { createSyncEngine } from "../src/server/sync/engine";
import { FAKE_TOKEN, FAKE_USER, key, startFakeBitbucket } from "../tests/support/fake-bitbucket";
import * as S from "../tests/support/scenarios";

// No import reads these at load time. Every call below also gets the folder and the memory store explicitly.
const dataDir = mkdtempSync(join(tmpdir(), "review-loop-demo-"));
process.env.REVIEW_LOOP_DATA_DIR = dataDir;
process.env.REVIEW_LOOP_SECRETS = "memory";

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
};

function makePr(o: Spec): Pr {
  const pr = S.reviewPr() as Pr;
  const refs = [pr.fromRef, pr.toRef] as { displayId: string; repository: { slug: string; project: { key: string } } }[];
  for (const r of refs) {
    r.repository.slug = o.repo;
    r.repository.project.key = o.project;
  }
  Object.assign(pr, {
    id: o.id,
    title: o.title,
    description: "Synthetic demo data.",
    state: "OPEN",
    updatedDate: min(o.minutes),
    author: { user: o.author, role: "AUTHOR", approved: false, status: "UNAPPROVED" },
    reviewers: o.reviewers.map((r) => ({ role: "REVIEWER", approved: r.status === "APPROVED", ...r })),
    links: { self: [{ href: `${fake.url}/projects/${o.project}/repos/${o.repo}/pull-requests/${o.id}` }] },
  });
  pr.fromRef.latestCommit = o.head;
  (refs[0] as { displayId: string }).displayId = o.branch;
  return pr;
}

const HEAD_A = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const HEAD_B = "b2c3d4e5f60718293a4b5c6d7e8f901234567890";
const reviewing = (user: User, status = "UNAPPROVED", lastReviewedCommit?: string) => [
  { user: me, status, lastReviewedCommit },
  { user, status: "UNAPPROVED" },
];

const prs = {
  commits: makePr({
    project: "PROJ1",
    repo: "sample-repo-2",
    id: 1001,
    title: "Batch cache writes in the sync worker",
    author: alex,
    reviewers: reviewing(maria, "NEEDS_WORK", HEAD_A),
    head: HEAD_B,
    branch: "feature/batch-writes",
    minutes: 30,
  }),
  requested: makePr({
    project: "PROJ1",
    repo: "sample-repo-2",
    id: 1002,
    title: "Add retry budget to the upload client",
    author: maria,
    reviewers: reviewing(kenji),
    head: HEAD_A,
    branch: "feature/retry-budget",
    minutes: 95,
  }),
  approved: makePr({
    project: "PROJ2",
    repo: "web-app",
    id: 210,
    title: "Show build status on the release page",
    author: kenji,
    reviewers: reviewing(alex, "APPROVED", HEAD_A),
    head: HEAD_A,
    branch: "feature/build-status",
    minutes: 1500,
  }),
  authored: makePr({
    project: "PROJ2",
    repo: "web-app",
    id: 215,
    title: "Move date formatting into one helper",
    author: me,
    reviewers: [{ user: kenji, status: "NEEDS_WORK" }],
    head: HEAD_A,
    branch: "chore/date-helper",
    minutes: 2900,
  }),
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
  broken: makePr({
    project: "PROJ2",
    repo: "api",
    id: 31,
    title: "Paginate the audit log query",
    author: alex,
    reviewers: reviewing(kenji),
    head: HEAD_A,
    branch: "feature/audit-paging",
    minutes: 600,
  }),
};
const own = Object.assign(S.ownPr() as Pr, {
  title: "Replace the polling timer with a scheduler",
  updatedDate: min(12),
  reviewers: [{ user: alex, role: "REVIEWER", approved: false, status: "NEEDS_WORK" }],
  links: { self: [{ href: `${fake.url}/users/${FAKE_USER}/repos/sample-repo-1/pull-requests/2` }] },
});
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

function newThread(list: S.Activity[], id: number, user: User, minutes: number, text: string): S.Activity[] {
  const root = S.clone(S.findComment(list, ROOT));
  Object.assign(root, { id, version: 0, text, author: user, createdDate: min(minutes), updatedDate: min(minutes), comments: [] });
  return [...S.clone(list), { id: id + 9_000_000, action: "COMMENTED", commentAction: "ADDED", comment: root }];
}

const activities = new Map<Pr, () => S.Activity[]>([
  [
    prs.commits,
    () => (phase === 1 ? base() : reply(base(), ROOT, 1000010, alex, 8, "Pushed a fix for the flush order. Can you look again?")),
  ],
  [
    prs.requested,
    () => {
      if (phase === 1) return base();
      const t = newThread(base(), 1000020, maria, 40, "The budget resets on every request. Is that intended?");
      return reply(t, 1000020, 1000021, kenji, 25, "It should reset per upload, not per request.");
    },
  ],
  [prs.approved, base],
  [prs.authored, base],
  [prs.merging, () => (phase === 1 ? base() : reply(base(), ROOT, 1000030, kenji, 15, "Merged. Thanks for the quick review."))],
  [prs.broken, base],
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

for (const [pr, list] of activities) {
  fake.routes[key("GET", `${pathOf(pr)}/activities`)] = () =>
    phase === 2 && pr === prs.broken
      ? { status: 500, body: { errors: [{ message: "Internal error." }] } }
      : { status: 200, body: S.onePage(list()) };
  fake.routes[key("GET", pathOf(pr))] = () =>
    pr === prs.merging && phase === 2 ? { status: 200, body: { ...pr, state: "MERGED", updatedDate: min(15) } } : { status: 200, body: pr };
}

fake.routes[key("GET", S.DASHBOARD_PATH)] = (req) => {
  const role = new URL(req.url).searchParams.get("role");
  const reviewer = phase === 1 ? Object.values(prs) : Object.values(prs).filter((p) => p !== prs.merging);
  const values = role === "AUTHOR" ? [own, prs.authored] : reviewer.filter((p) => p !== prs.authored);
  if (phase === 2) {
    const c = values.find((p) => p === prs.commits);
    if (c) c.updatedDate = min(8);
  }
  return { status: 200, body: S.onePage(values) };
};

writeConfig(dataDir, { baseUrl: fake.url, userSlug: FAKE_USER, notifications: false });
const secrets = createSecrets(null);
await secrets.set(FAKE_TOKEN);
const settings = createSettings({ dir: dataDir, secrets });
const live = createLive();
const sync = createSyncEngine({ settings, live });

await sync.syncNow();
const db = settings.db();
const approved = db?.query("SELECT id FROM pull_request WHERE pr_id = 210").get() as { id: number } | null;
if (db && approved) setFollowed(db, approved.id, false);
phase = 2;
await sync.syncNow();

const server = startServer({
  port: PORT,
  token: randomBytes(32).toString("hex"),
  live,
  settings,
  sync,
  indexHtml: readFileSync(index, "utf8"),
  assets: serveStatic({ root: WEB_DIR }),
});
sync.start();

console.log(`Review Loop demo: http://127.0.0.1:${server.port}/ (pid ${process.pid})`);
console.log(`Fake Bitbucket: ${fake.url}. Data: ${dataDir}`);
console.log(`Follow by URL: paste ${fake.url}/projects/PROJ3/repos/tools/pull-requests/5 into the filter.`);

function stop() {
  sync.stop();
  server.stop(true);
  fake.stop();
  db?.close();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {}
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
