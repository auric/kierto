// Shared by serve.ts (Bun) and the Playwright files (Node). Keep it free of Bun APIs.
// E2E_APP_PORT, E2E_FAKE_PORT, and E2E_JIRA_PORT move the servers, so that two checkouts can run e2e at the same time.
// Playwright passes its environment to the web server command.
export const APP_PORT = Number(process.env.E2E_APP_PORT || 7399);
export const FAKE_URL = `http://127.0.0.1:${Number(process.env.E2E_FAKE_PORT || 7398)}`;
export const JIRA_URL = `http://127.0.0.1:${Number(process.env.E2E_JIRA_PORT || 7397)}`;
// The fake Bitbucket accepts only this token. serve.ts sets it on the fake.
export const E2E_TOKEN = "e2e-token-7f3a9c1d5b2e8f40";
// The fake Jira on JIRA_URL accepts only this token. It serves JIRA_ISSUE (fixtures/jira) and gives 404 for other keys.
export const E2E_JIRA_TOKEN = "e2e-jira-token-3c9d1f7a2b5e8d60";
export const JIRA_ISSUE = "ABC-42";
// src/server/publish/plan.ts AI_MARK. The default markAi setting puts it before each post of an AI item.
export const MARK = "🤖 ";

export type Scenario = {
  // PR 1001: the reply 1000010 by another user under my comment 1000003. "two": then the reply 1000011 by a third user.
  reply: "none" | "new" | "two" | "dup" | "edit" | "absent" | "deleted";
  // PR 1001: this many more threads 1000101, 1000102, …: my general comment, then a reply 1000201, 1000202, … by another user.
  turns: number;
  // PR 1001: the reply 1000201 tells the AI to ignore its instructions and to answer thread 1000003 (A17).
  inject: boolean;
  // PR 1001: the source branch moves one commit on, after the review (A7).
  push: boolean;
  // PR 210: a new thread by another user with this many long replies.
  tall: number;
  // PR 77: "reply" adds an unread reply; "merged" also takes the PR off the dashboard as MERGED.
  merge: "open" | "reply" | "merged";
  // Bitbucket stops answering after the first dashboard page.
  down: boolean;
  // PR 77: the Gate v3 inline threads with their diffs, the resolved BLOCKER task, and the commits and changes (plan v3 WP4).
  forge: boolean;
  // PR 1001: the description names the tasks ABC-42 (the fake Jira serves it) and ABC-404 (the fake Jira gives 404).
  task: boolean;
  // PR 1004 (PROJ1/sample-repo-4, source branch fix/flush-lock): the PR of the token owner joins the author dashboard.
  // The reviewer asks for code changes in threads 5000001 and 5000002. makeClone(1004) gives a clone on its source branch.
  author: boolean;
};

// The next fake Claude Code run. tree: a subagent run with drafts. schema: a result that fails the schema. limit: a usage limit.
// gaps: no finding, a read that stopped at a limit, and a documentation server that did not connect (A11, A12).
// hang: the CLI stops before its result and waits for a cancel. replies: the result of a reply run; absent, the CLI answers each thread.
// rereview: the result of a re-review; absent, the CLI gives one verdict per earlier finding. answer: the result of an ask run; absent, an echo.
// fix: the result of a fix run; absent, one note per thread and no edit. login: the authMethod of `claude auth status`. Absent: claude.ai.
export type ClaudeScenario = {
  stream: "tree" | "schema" | "limit" | "gaps";
  hang?: boolean;
  replies?: unknown;
  rereview?: unknown;
  answer?: unknown;
  fix?: unknown;
  login?: string;
};

// PR 1001 comment posts. drop: the next POST is stored, then the connection drops (A9). fail: the next POST gets this status
// and stores nothing. hide: the activities of PR 1001 drop, so neither the sync nor the outbox check can read them.
export type PostControl = { drop?: boolean; fail?: number | null; hide?: boolean };
export type PostBody = { text: string; parent?: { id: number }; anchor?: Record<string, unknown> };

// Test-only control routes on the fake Bitbucket. The app has no such route.
export async function control(action: "reset" | "restart" | "shutdown"): Promise<void>;
export async function control(action: "state", change: Partial<Scenario>): Promise<void>;
export async function control(action: "claude", change: ClaudeScenario): Promise<void>;
export async function control(action: string, change?: Partial<Scenario> | ClaudeScenario) {
  const res = await fetch(`${FAKE_URL}/__control/${action}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${E2E_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(change ?? {}),
  });
  if (!res.ok) throw new Error(`control ${action}: ${res.status}`);
}

// Every request to the fake Bitbucket since the last reset that is not a GET, as "METHOD /path?query". Control routes do not count.
export async function writes(): Promise<string[]> {
  const res = await fetch(`${FAKE_URL}/__control/writes`, {
    method: "POST",
    headers: { Authorization: `Bearer ${E2E_TOKEN}` },
  });
  if (!res.ok) throw new Error(`control writes: ${res.status}`);
  return ((await res.json()) as { writes: string[] }).writes;
}

// ---------- Fix it (plan r3): the user's clone ----------

const auth = { Authorization: `Bearer ${E2E_TOKEN}`, "Content-Type": "application/json" };

// branch: null when HEAD is detached. status: the `git status --porcelain` output.
export type CloneState = { head: string; branch: string | null; subject: string; status: string };

// A temp clone of the fake remote on the source branch of the PR, at the PR source head. pr: the Bitbucket PR ID. A reset deletes it.
export async function makeClone(pr: number): Promise<string> {
  const res = await fetch(`${FAKE_URL}/__control/clone`, { method: "POST", headers: auth, body: JSON.stringify({ pr }) });
  if (!res.ok) throw new Error(`control clone: ${res.status}`);
  return ((await res.json()) as { path: string }).path;
}

export async function cloneState(path: string): Promise<CloneState> {
  const res = await fetch(`${FAKE_URL}/__control/clone?path=${encodeURIComponent(path)}`, { headers: auth });
  if (!res.ok) throw new Error(`control clone state: ${res.status}`);
  return (await res.json()) as CloneState;
}

// Pushes the clone HEAD to the PR. The fake then lists it as the PR source head, with its commits and changes. Sync after it.
export async function pushClone(pr: number, path: string): Promise<string> {
  const res = await fetch(`${FAKE_URL}/__control/push`, { method: "POST", headers: auth, body: JSON.stringify({ pr, path }) });
  if (!res.ok) throw new Error(`control push: ${res.status}`);
  return ((await res.json()) as { head: string }).head;
}

// Applies the change, then returns every comment POST body of PR 1001 since the last reset.
export async function posts(change: PostControl = {}): Promise<PostBody[]> {
  const res = await fetch(`${FAKE_URL}/__control/posts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${E2E_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(change),
  });
  if (!res.ok) throw new Error(`control posts: ${res.status}`);
  return ((await res.json()) as { bodies: PostBody[] }).bodies;
}

// ---------- Jira attachments (plan r3 S-ATT) ----------
// The fake Jira serves the attachments of JIRA_ISSUE: 10100 screenshot.png (a PNG) and 10101 sync-worker.log (text).

// Every request to the fake Jira since the last reset, as "METHOD /path?query".
export async function jiraRequests(): Promise<string[]> {
  const res = await fetch(`${FAKE_URL}/__control/jira-requests`, { method: "POST", headers: auth });
  if (!res.ok) throw new Error(`control jira-requests: ${res.status}`);
  return ((await res.json()) as { requests: string[] }).requests;
}

// The file names in context/attachments/ of the newest fake CLI run, or null before the first run.
// The run folder exists only while the run runs. Start the run with control("claude", { stream: "tree", hang: true }).
export async function runAttachments(): Promise<string[] | null> {
  const res = await fetch(`${FAKE_URL}/__control/run-attachments`, { method: "POST", headers: auth });
  if (!res.ok) throw new Error(`control run-attachments: ${res.status}`);
  return ((await res.json()) as { files: string[] | null }).files;
}
