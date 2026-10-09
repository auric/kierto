// Shared by serve.ts (Bun) and the Playwright files (Node). Keep it free of Bun APIs.
export const APP_PORT = 7399;
export const FAKE_URL = "http://127.0.0.1:7398";
// The fake Bitbucket accepts only this token. serve.ts sets it on the fake.
export const E2E_TOKEN = "e2e-token-7f3a9c1d5b2e8f40";

export type Scenario = {
  // PR 1001: the reply 1000010 by another user under my comment 1000003.
  reply: "none" | "new" | "dup" | "edit" | "absent" | "deleted";
  // PR 210: a new thread by another user with this many long replies.
  tall: number;
  // PR 77: "reply" adds an unread reply; "merged" also takes the PR off the dashboard as MERGED.
  merge: "open" | "reply" | "merged";
  // Bitbucket stops answering after the first dashboard page.
  down: boolean;
};

// Test-only control routes on the fake Bitbucket. The app has no such route.
export async function control(action: "reset" | "restart" | "shutdown"): Promise<void>;
export async function control(action: "state", change: Partial<Scenario>): Promise<void>;
export async function control(action: string, change?: Partial<Scenario>) {
  const res = await fetch(`${FAKE_URL}/__control/${action}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${E2E_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(change ?? {}),
  });
  if (!res.ok) throw new Error(`control ${action}: ${res.status}`);
}
