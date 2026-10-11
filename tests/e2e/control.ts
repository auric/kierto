// Shared by serve.ts (Bun) and the Playwright files (Node). Keep it free of Bun APIs.
// E2E_APP_PORT and E2E_FAKE_PORT move the servers, so that two checkouts can run e2e at the same time.
// Playwright passes its environment to the web server command.
export const APP_PORT = Number(process.env.E2E_APP_PORT || 7399);
export const FAKE_URL = `http://127.0.0.1:${Number(process.env.E2E_FAKE_PORT || 7398)}`;
// The fake Bitbucket accepts only this token. serve.ts sets it on the fake.
export const E2E_TOKEN = "e2e-token-7f3a9c1d5b2e8f40";

export type Scenario = {
  // PR 1001: the reply 1000010 by another user under my comment 1000003. "two": then the reply 1000011 by a third user.
  reply: "none" | "new" | "two" | "dup" | "edit" | "absent" | "deleted";
  // PR 210: a new thread by another user with this many long replies.
  tall: number;
  // PR 77: "reply" adds an unread reply; "merged" also takes the PR off the dashboard as MERGED.
  merge: "open" | "reply" | "merged";
  // Bitbucket stops answering after the first dashboard page.
  down: boolean;
};

// The next fake Claude Code run. tree: a subagent run with drafts. schema: a result that fails the schema. limit: a usage limit.
// hang: the CLI stops before its result and waits for a cancel. replies: the result of a reply run; absent, the CLI answers each thread.
export type ClaudeScenario = { stream: "tree" | "schema" | "limit"; hang?: boolean; replies?: unknown };

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
