// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Demo: the app on 127.0.0.1:7399 against a fake Bitbucket with synthetic data. No real server, data folder, or credential store.
// Reviews run the fake Claude Code CLI against a temp git remote. No real CLI and no network.
// The data covers every inbox group and every thread turn. Task IDs use the fictional key ABC. A fake Jira serves each ABC task.
// My PR 1004 shows Fix it: judgements, fix edits, and Apply into a temp clone that the demo makes and deletes.
import "../tests/support/no-real-claude";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serveStatic } from "hono/bun";
import { writeConfig } from "../src/server/config";
import { setFollowed } from "../src/server/inbox/queries";
import { createLive } from "../src/server/live";
import { startServer } from "../src/server/main";
import { SHIPPED_PROFILES } from "../src/server/review/catalog";
import { editRows, type Located, locate } from "../src/server/review/edits";
import { git, gitEnv } from "../src/server/review/git";
import { createReviewJobs } from "../src/server/review/jobs";
import { createSecrets } from "../src/server/secrets";
import { createSettings } from "../src/server/settings";
import { createSyncEngine } from "../src/server/sync/engine";
import { FAKE_TOKEN, FAKE_USER, fixture, key, startFakeBitbucket } from "../tests/support/fake-bitbucket";
import { JIRA_TOKEN, startFakeJira } from "../tests/support/fake-jira";
import { claudeStream, fakeRunner, REVIEW_RESULT, reviewRemote, stubListTools } from "../tests/support/review-fixture";
import * as S from "../tests/support/scenarios";

// No import reads these at load time. Every call below also gets the folder and the memory store explicitly.
const dataDir = mkdtempSync(join(tmpdir(), "review-loop-demo-"));
process.env.REVIEW_LOOP_DATA_DIR = dataDir;
process.env.REVIEW_LOOP_SECRETS = "memory";

// Fix it (plan r3): the result of each fix run. It fixes threads 2000 and 2010 of PR 1004. Each old text is unique in the source
// head (tests/support/review-fixture.ts). A fix run on another PR drops every edit as unrequested.
const FIX = {
  summary: "The lock release moves into a finally block, and the README notes the lock order.",
  threads: [
    { thread: 2000, fixed: true, reason: "Release the lock in a `finally` block." },
    { thread: 2010, fixed: true, reason: "Note the lock order in the README." },
  ],
  edits: [
    {
      thread: 2000,
      path: "src/cache/flush.ts",
      old: "    write(entry);\n    lock.release();\n",
      new: "    try {\n      write(entry);\n    } finally {\n      lock.release();\n    }\n",
    },
    { thread: 2010, path: "README.md", old: "# Sample\n", new: "# Sample\n\nflush() takes the write lock once per entry.\n" },
  ],
  coverage: { read: ["src/cache/flush.ts", "README.md"], skipped: [], unavailable: [], notChecked: [] },
};

// The fake CLI, its stream, and the git remote. PR 81 has new commits, so its head is the "next" commit.
// Reply runs judge the threads valid, partly, invalid, question, and null in turn (tests/support/fake-claude.ts).
const claudeDir = mkdtempSync(join(tmpdir(), "review-loop-demo-claude-"));
const runner = fakeRunner(claudeDir);

// A synthetic Claude Code config folder, so Settings never lists the skills, plugins, or MCP servers of the real one.
// Two user skills, one plugin with a skill and an MCP server, one user MCP server, and a global CLAUDE.md. Both MCP servers run fake-mcp.ts.
const claudeConfig = join(claudeDir, "config");
const skill = (dir: string, name: string, description: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\nCheck each changed function.\n`);
};
skill(join(claudeConfig, "skills", "test-check"), "test-check", "Finds changed code without a test.");
skill(join(claudeConfig, "skills", "lock-order"), "lock-order", "Checks that locks are taken in one order.");
const pluginDir = join(claudeConfig, "plugins", "cache", "demo-market", "review-kit", "1.0.0");
skill(join(pluginDir, "skills", "naming"), "naming", "Checks the naming style of new code.");
const fakeMcp = (extra: string[] = []) => ({
  command: process.execPath,
  args: [join(import.meta.dir, "../tests/support/fake-mcp.ts"), ...extra],
});
writeFileSync(join(pluginDir, ".mcp.json"), JSON.stringify({ mcpServers: { docs: fakeMcp() } }));
writeFileSync(join(claudeConfig, "settings.json"), JSON.stringify({ enabledPlugins: { "review-kit@demo-market": true } }));
writeFileSync(
  join(claudeConfig, "plugins", "installed_plugins.json"),
  JSON.stringify({ version: 2, plugins: { "review-kit@demo-market": [{ scope: "user", installPath: pluginDir, version: "1.0.0" }] } }),
);
writeFileSync(join(claudeConfig, ".claude.json"), JSON.stringify({ mcpServers: { "team-wiki": fakeMcp(["--extra=page_history"]) } }));
writeFileSync(join(claudeConfig, "CLAUDE.md"), "Name each lock in a comment where it is taken.\n");
process.env.CLAUDE_CONFIG_DIR = claudeConfig;

// The answers to the questions that an earlier run of PR 1001 posted in threads 1100 and 1150 (seeded below). A review of another
// PR drops both entries into its coverage, because those threads hold no question of the user there.
const ANSWERED = [
  {
    thread: 1100,
    question: null,
    outcome: "settled",
    evidence: 'Message 1101: "It takes the cache lock itself now."',
    reply: "Thanks, clear.",
    finding: null,
  },
  {
    thread: 1150,
    question: null,
    outcome: "followup",
    evidence: 'Message 1151: "The timer can start it, though."',
    reply: "Thanks. When the timer starts trim() during evict(), which of the two takes the lock first?",
    finding: null,
  },
];
// The verify phase of a review run gets one tool call and no subagent (docs/plans/review-v2/spec.md section 1.6).
runner.write({
  fixture: claudeStream(claudeDir, "tree", "claude/b9-wp8-flags.jsonl", REVIEW_RESULT),
  fix: FIX,
  answered: ANSWERED,
  bySchema: { verify: { fixture: claudeStream(claudeDir, "check", "claude/b6-hostile-repo.jsonl") } },
});
const SOURCE_PRS = [1001, 1002, 31, 210, 212, 77, 74, 33, 215, 9, 5, 2, 1004];
const remote = await reviewRemote(claudeDir, { ...Object.fromEntries(SOURCE_PRS.map((id) => [id, "source" as const])), 81: "next" });

// DEMO_PORT: scripts/screenshots.ts runs the demo on a spare port.
const PORT = Number(process.env.DEMO_PORT ?? 7399);
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
  Object.assign(refs[0] as object, { id: `refs/heads/${o.branch}`, displayId: o.branch });
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
for (const r of [own.fromRef, own.toRef] as unknown as { repository: { links: unknown } }[])
  r.repository.links = { self: [{ href: `${fake.url}/users/${FAKE_USER}/repos/sample-repo-1/browse` }] };
(own.toRef as { latestCommit: string }).latestCommit = remote.target;
// Fix it (plan r3): my PR. The reviewer asks for three changes. A reply run judges them valid, partly valid, and not valid.
// The demo clone below is the clone of PROJ1/sample-repo-4, so Apply commits there.
const fixing = makePr({
  project: "PROJ1",
  repo: "sample-repo-4",
  id: 1004,
  title: "[ABC-10688] Release the write lock after each entry",
  author: me,
  reviewers: [{ user: alex, status: "NEEDS_WORK" }],
  head: HEAD_A,
  branch: "fix/ABC-10688-flush-lock",
  minutes: 20,
  description: "flush() takes the write lock per entry, so a long flush no longer blocks the readers.",
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

// Thread history (docs/plans/thread-outcome.md section 10) of my PR "Replace the polling timer": a reply run drafts, I edit the
// draft, a fix commit revises it, I use the revision, post it, and resolve the thread. The fix commit is the PR head, so it is pushed.
const HISTORY = 3000;
const HISTORY_SHORT = HEAD_A.slice(0, 7);
const HISTORY_AI = "Right. I will stop the timer in dispose().";
const HISTORY_MINE = "Right. dispose() now stops the timer before the scheduler starts.";
const HISTORY_POSTED = `${HISTORY_MINE}\n\nFixed in ${HISTORY_SHORT}: dispose() clears the timer first.`;

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
      // A posted question of an earlier review run (seeded below). The answer is partial, so a review drafts a follow-up question.
      t = thread(t, 1150, me, 298, "Does trim() still run while evict() holds the lock?");
      t = reply(t, 1150, 1151, kenji, 290, "Usually not. The timer can start it, though.");
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
    fixing,
    () => {
      let t = thread(none(), 2000, alex, 45, "Release the lock in a `finally` block, so a throwing `write()` cannot leave it held.", {
        path: "src/cache/flush.ts",
        line: 5,
        code: [
          "  for (const entry of cache.dirty()) {",
          "    const lock = cache.lock();",
          "    write(entry);",
          "    lock.release();",
          "  }",
          "}",
          "",
        ],
      });
      t = thread(t, 2010, alex, 40, "Note the lock order in the README, so the next change keeps it.");
      return thread(t, 2020, alex, 35, "Take the lock once, before the loop. Another writer can run between two entries.");
    },
  ],
  [
    own,
    () => {
      // Thread history (seeded below): Alex asks for a change, my reply from a PR Review Inbox draft answers, and I resolve the thread.
      let t = thread(base(), HISTORY, alex, 150, "Stop the old timer in dispose(). It still fires after the scheduler takes over.");
      t = S.resolveThread(reply(t, HISTORY, HISTORY + 1, me, 110, HISTORY_POSTED), HISTORY, me, min(109));
      if (phase === 1) return t;
      return reply(
        reply(t, ROOT, 1000040, alex, 6, "The scheduler drops a tick on wake."),
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
// Every PR head is HEAD_A or HEAD_B of the demo remote, and every target head is remote.target.
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
// The changed files as Bitbucket lists them: the diff from the merge base to the source head, read from the demo remote.
// So the forge list and the git diff of Files give the same files.
const CHANGE_TYPE: Record<string, string> = { A: "ADD", M: "MODIFY", D: "DELETE", R: "MOVE", C: "COPY", T: "MODIFY" };
async function changesOf(head: string) {
  const g = async (args: string[]) => git(["--git-dir", remote.remote, ...args], { env: gitEnv(join(claudeDir, "empty.gitconfig")) });
  const base = (await g(["merge-base", remote.target, head])).trim();
  const out = (await g(["diff", "--name-status", "-z", "-M", base, head])).split("\0").filter(Boolean);
  const list: { path: { toString: string }; srcPath?: { toString: string }; type: string }[] = [];
  for (let i = 0; i < out.length; ) {
    const kind = (out[i++] ?? "")[0] ?? "";
    const src = kind === "R" || kind === "C" ? out[i++] : undefined;
    const path = out[i++] ?? "";
    list.push({ path: { toString: path }, ...(src && { srcPath: { toString: src } }), type: CHANGE_TYPE[kind] ?? "MODIFY" });
  }
  return list;
}
const CHANGES = new Map([
  [HEAD_A, await changesOf(HEAD_A)],
  [HEAD_B, await changesOf(HEAD_B)],
]);

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
  fake.routes[key("GET", `${pathOf(pr)}/changes`)] = { status: 200, body: S.onePage(CHANGES.get(head) ?? []) };
  fake.routes[key("GET", pathOf(pr))] = () => {
    const state = phase === 2 ? closed.get(pr) : undefined;
    return { status: 200, body: state ? { ...pr, state, updatedDate: min(15) } : pr };
  };
}

fake.routes[key("GET", S.DASHBOARD_PATH)] = (req) => {
  const role = new URL(req.url).searchParams.get("role");
  const open = Object.values(prs).filter((p) => p !== prs.authored && !(phase === 2 && closed.has(p)));
  return { status: 200, body: S.onePage(role === "AUTHOR" ? [own, prs.authored, fixing] : open) };
};

// The fake Jira serves every ABC task of the listed PRs, with the PR title as the summary. Each task lists the fixture
// attachments screenshot.png and sync-worker.log (fixtures/jira/README.md). ABC-10688 adds a dump that runs list by name only.
const jira = startFakeJira();
for (const p of [...Object.values(prs), fixing]) {
  const k = JSON.stringify(p).match(/ABC-\d+/)?.[0];
  if (k) jira.addIssue(k, String(p.title).replace(/^\[ABC-\d+\]\s*/, ""));
}
const dump = Buffer.concat([Buffer.from("MDMP", "latin1"), Buffer.alloc(4092)]);
jira.attach("ABC-10688", { id: "10102", filename: "flush-hang.dmp", mimeType: "application/octet-stream", body: dump });

// The user's clone of PROJ1/sample-repo-4: a temp clone of the demo remote on the PR source branch at its head, outside the data
// folder. Its own identity and no signing, so a commit never waits for a prompt. The commit runs the user's hooks, as Apply does.
const cloneDir = realpathSync.native(mkdtempSync(join(tmpdir(), "review-loop-demo-clone-")));
const cloneEnv = gitEnv(join(claudeDir, "empty.gitconfig"));
const inClone = (args: string[]) => git(["-C", cloneDir, ...args], { env: cloneEnv });
await git(["clone", "-q", "--no-checkout", remote.remote, cloneDir], { env: cloneEnv });
await inClone(["fetch", "-q", "origin", `+refs/pull-requests/${fixing.id}/from:refs/remotes/origin/pr/${fixing.id}`]);
await inClone(["checkout", "-q", "-B", "fix/ABC-10688-flush-lock", HEAD_A]);
const cloneConfig: [string, string][] = [
  ["user.name", "Jordan Doe"],
  ["user.email", `${FAKE_USER}@example.test`],
  ["commit.gpgsign", "false"],
];
for (const [k, v] of cloneConfig) await inClone(["config", k, v]);

// The prototype rules: every source, the default pattern, only the fictional key ABC.
const pattern = String.raw`[A-Z][A-Z0-9]+-\d+`;
writeConfig(dataDir, {
  baseUrl: fake.url,
  userSlug: FAKE_USER,
  notifications: false,
  taskRules: (["branch", "title", "description"] as const).map((source) => ({ source, pattern, keys: ["ABC"] })),
  taskLink: "https://tracker.example.test/browse/{key}",
  jira: { baseUrl: jira.url },
  // General gets skills and an MCP server of the synthetic config, so the brief, the run setup, and Settings show them.
  profiles: SHIPPED_PROFILES.map((p) =>
    p.id === "general"
      ? {
          ...p,
          skills: ["test-check", "review-kit:naming"],
          alwaysSkills: ["test-check"],
          mcp: [{ server: "team-wiki", tools: ["search", "lookup"] }],
        }
      : p,
  ),
});
const secrets = createSecrets(null);
await secrets.set(FAKE_TOKEN);
const jiraSecrets = createSecrets(null, "jira-token");
await jiraSecrets.set(JIRA_TOKEN);
const settings = createSettings({ dir: dataDir, secrets, jiraSecrets });
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
db?.query("INSERT INTO repo_clone (project, repo, path, updated_at) VALUES ('PROJ1', 'sample-repo-4', $path, $now)").run({
  path: cloneDir,
  now: Date.now(),
});
phase = 2;
await sync.syncNow();

// An earlier review run of PR 1001 posted one question in each of threads 1100 and 1150 (docs/plans/thread-outcome.md section 9).
// The other person answered both, so the next review drafts the replies of ANSWERED.
const evictPr = db?.query("SELECT id FROM pull_request WHERE project = 'PROJ1' AND pr_id = 1001").get() as { id: number } | null;
if (db && evictPr) {
  const { id: run } = db
    .query(
      `INSERT INTO review_run (pr, profile, note, idem_key, source_head, target_head, status, kind, summary_json, started_at, finished_at)
      VALUES ($pr, 'general', '', 'demo-earlier', $head, $target, 'completed', 'review', $summary, $at, $at) RETURNING id`,
    )
    .get({
      pr: evictPr.id,
      head: HEAD_A,
      target: remote.target,
      summary: JSON.stringify({
        summary: "Two questions about the lock.",
        risks: [],
        coverage: { read: [], skipped: [], unavailable: [], notChecked: [] },
        dropped: [],
      }),
      at: min(320),
    }) as { id: number };
  for (const [root, kind, text] of [
    [1100, "inline", "Does evict() still need the caller to hold the lock?"],
    [1150, "general", "Does trim() still run while evict() holds the lock?"],
  ] as const) {
    const { id } = db
      .query(
        "INSERT INTO review_item (run, kind, payload_json, body, status) VALUES ($run, 'question', $payload, $text, 'posted') RETURNING id",
      )
      .get({ run, payload: JSON.stringify({ text, why: "The lock order decides the fix." }), text }) as { id: number };
    db.query(
      `INSERT INTO post (pr, run, kind, idem_key, body, destination_json, items_json, state, remote_id, remote_version, created_at, updated_at)
      VALUES ($pr, $run, $kind, $key, $text, '{}', $items, 'confirmed', $root, 0, $at, $at)`,
    ).run({ pr: evictPr.id, run, kind, key: `demo-post-${root}`, text, items: JSON.stringify([{ id, revision: 0 }]), root, at: min(320) });
  }

  // A reply run drafted an answer to message 1124 of thread 1120, and I accepted it. Alex wrote 1125 later, so the draft is out of
  // date and the row shows the badge (docs/plans/thread-outcome.md section 11).
  const { id: replyRun } = db
    .query(
      `INSERT INTO review_run (pr, profile, note, idem_key, source_head, target_head, status, kind, summary_json, started_at, finished_at)
      VALUES ($pr, 'general', '', 'demo-reply-1120', $head, $target, 'completed', 'reply', $summary, $start, $end) RETURNING id`,
    )
    .get({
      pr: evictPr.id,
      head: HEAD_A,
      target: remote.target,
      summary: JSON.stringify({
        summary: "One reply about the budget getter.",
        risks: [],
        coverage: { read: [], skipped: [], unavailable: [], notChecked: [] },
        dropped: [],
      }),
      start: min(218),
      end: min(217),
    }) as { id: number };
  const body = "Agreed. Return a const reference, so a call copies nothing.";
  db.query(
    "INSERT INTO review_item (run, kind, payload_json, body, status, thread, edited) VALUES ($run, 'reply', $payload, $body, 'accepted', 1120, 0)",
  ).run({
    run: replyRun,
    body,
    payload: JSON.stringify({
      thread: 1120,
      action: "reply",
      body,
      reason: "Message 1124 is right: the getter returns the struct by value.",
      evidenceStatus: "code",
      judgement: "valid",
      resolve: false,
      resolveEvidence: "",
      replyTo: 1124,
      origin: "reply",
      threadOpen: true,
      touchedAt: min(214),
    }),
  });
}

// The PR Review Inbox side of thread HISTORY: the runs, the drafts, the fix edits and commit, and the confirmed post with its resolve.
const ownPr = db?.query("SELECT id FROM pull_request WHERE title = $title").get({ title: own.title }) as { id: number } | null;
if (db && ownPr) {
  const run = (kind: string, key: string, start: number, end: number, text: string, fix: unknown = null) =>
    (
      db
        .query(
          `INSERT INTO review_run (pr, profile, note, idem_key, source_head, target_head, status, kind, summary_json, started_at, finished_at, fix_json)
          VALUES ($pr, 'general', '', $key, $head, $target, 'completed', $kind, $summary, $start, $end, $fix) RETURNING id`,
        )
        .get({
          pr: ownPr.id,
          key,
          head: HEAD_A,
          target: remote.target,
          kind,
          summary: JSON.stringify({
            summary: text,
            risks: [],
            coverage: { read: [], skipped: [], unavailable: [], notChecked: [] },
            dropped: [],
          }),
          start: min(start),
          end: min(end),
          fix: fix === null ? null : JSON.stringify(fix),
        }) as { id: number }
    ).id;
  const item = (r: number, status: string, body: string, edited: number, payload: Record<string, unknown>) =>
    (
      db
        .query(
          `INSERT INTO review_item (run, kind, payload_json, body, status, thread, edited)
          VALUES ($run, 'reply', $payload, $body, $status, $thread, $edited) RETURNING id`,
        )
        .get({
          run: r,
          payload: JSON.stringify({ thread: HISTORY, action: "reply", replyTo: HISTORY, ...payload }),
          body,
          status,
          thread: HISTORY,
          edited,
        }) as {
        id: number;
      }
    ).id;
  const replyRun = run("reply", "demo-history-reply", 140, 139, "One reply about the timer.");
  const mine = item(replyRun, "discarded", HISTORY_MINE, 1, {
    body: HISTORY_AI,
    reason: "The comment is right: dispose() leaves the timer running.",
    evidenceStatus: "code",
    judgement: "valid",
    resolve: false,
    resolveEvidence: "",
    threadOpen: true,
    origin: "reply",
    touchedAt: min(135),
    discardedBy: "user",
  });
  const fixRun = run("fix", "demo-history-fix", 130, 127, "One fix for the timer.", [
    {
      thread: HISTORY,
      fixed: true,
      reason: "Clear the timer in dispose(), before the scheduler starts.",
      why: null,
      reply: "dispose() clears the timer first.",
    },
  ]);
  const file =
    "export class Poller {\n  private timer = setInterval(() => this.tick(), 1000);\n\n  dispose() {\n    this.scheduler.start();\n  }\n}\n";
  const edits = [
    ["  dispose() {\n    this.scheduler.start();", "  dispose() {\n    clearInterval(this.timer);\n    this.scheduler.start();"],
    ["  private timer = setInterval", "  private readonly timer = setInterval"],
  ].map(([old, next], ord) => {
    const at = locate(file, old as string, next as string) as Located;
    return (
      db
        .query(
          `INSERT INTO fix_edit (run, ord, thread, path, old, new, start, rows_json)
          VALUES ($run, $ord, $thread, 'src/poller.ts', $old, $new, $start, $rows) RETURNING id`,
        )
        .get({
          run: fixRun,
          ord,
          thread: HISTORY,
          old: at.old,
          new: at.new,
          start: at.start,
          rows: JSON.stringify(editRows(file, at)),
        }) as {
        id: number;
      }
    ).id;
  });
  const { id: commit } = db
    .query(
      `INSERT INTO fix_commit (pr, run, idem_key, edits_json, mode, before_head, commit_hash, short_hash, state, message, created_at, updated_at)
      VALUES ($pr, $run, $key, $edits, 'clone', $before, $hash, $short, 'committed', 'Clear the timer in dispose()', $at, $at) RETURNING id`,
    )
    .get({
      pr: ownPr.id,
      run: fixRun,
      key: `${fixRun}:clone:${edits.join(",")}`,
      edits: JSON.stringify(edits),
      before: remote.target,
      hash: HEAD_A,
      short: HISTORY_SHORT,
      at: min(120),
    }) as { id: number };
  const used = item(fixRun, "posted", HISTORY_POSTED, 0, {
    body: HISTORY_POSTED,
    reason: "The app committed the fix.",
    evidenceStatus: "code",
    judgement: null,
    fix: { id: commit, commit: HEAD_A, replaced: [mine] },
    resolve: true,
    resolveEvidence: `Commit ${HISTORY_SHORT} changes src/poller.ts.`,
    resolveTick: true,
    threadOpen: true,
    origin: "fix",
    revisionOf: mine,
    touchedAt: min(112),
  });
  db.query(
    `INSERT INTO post (pr, run, kind, idem_key, body, destination_json, items_json, state, remote_id, remote_version, created_at, updated_at,
      resolve_root, resolve_state)
    VALUES ($pr, $run, 'reply', 'demo-history-post', $body, $dest, $items, 'confirmed', $remote, 0, $at, $done, $root, 'done')`,
  ).run({
    pr: ownPr.id,
    run: fixRun,
    body: HISTORY_POSTED,
    dest: JSON.stringify({ kind: "reply", parentId: HISTORY }),
    items: JSON.stringify([{ id: used, revision: 0 }]),
    remote: HISTORY + 1,
    at: min(110),
    done: min(109),
    root: HISTORY,
  });
}

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

console.log(`PR Review Inbox demo: http://127.0.0.1:${server.port}/ (pid ${process.pid})`);
console.log(`Fake Bitbucket: ${fake.url}. Fake Jira: ${jira.url}. Data: ${dataDir}`);
console.log(`Follow by URL: paste ${fake.url}/projects/PROJ3/repos/tools/pull-requests/5 into the filter.`);
console.log(`Fix it: open "Release the write lock after each entry", draft replies, then fix. Apply commits in ${cloneDir}.`);

async function stop() {
  sync.stop();
  await review.stop();
  server.stop(true);
  fake.stop();
  jira.stop();
  db?.close();
  for (const dir of [dataDir, claudeDir, cloneDir])
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
