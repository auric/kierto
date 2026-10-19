// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Resolve threads (integration-check.md U62 to U66, synthetic): Draft replies proposes resolve with proof, the user unticks one, the post
// sends the reply first and then the resolve, and the badge shows after the sync. Manual Reopen and Resolve go out at once; a thread
// that another person started asks first. Runs against serve.ts only: the fake Bitbucket handles PUT .../comments/{id} with a version check.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { control, E2E_TOKEN, FAKE_URL, MARK, openApp, posts, writes } from "./control";

const TITLE = "Batch cache writes in the sync worker";
const RUN_MS = 60_000;
const A = "/rest/api/1.0/projects/PROJ1/repos/sample-repo-2/pull-requests/1001";
// turns 2: my general comments 1000101 and 1000102, each with a question by Alex (1000201, 1000202). Both are my turn.
const ONLY = 1000101;
const BOTH = 1000102;
// resolved: Alex started the inline thread 1000401, and Maria resolved it.
const THEIRS = 1000401;
const REPLY = "Fixed: the flush runs first now.";

const REPLIES = {
  summary: "Two threads are settled.",
  replies: [
    {
      thread: ONLY,
      action: "none",
      body: "",
      reason: "The new commit answers it.",
      evidenceStatus: "code",
      judgement: null,
      resolve: true,
      resolveEvidence: "src/cache/flush.ts:3 takes the lock once.",
    },
    {
      thread: BOTH,
      action: "reply",
      body: REPLY,
      reason: "The comment asks for the order.",
      evidenceStatus: "code",
      judgement: "valid",
      resolve: true,
      resolveEvidence: "src/cache/flush.ts:5 runs the flush first.",
    },
  ],
  coverage: { read: ["src/cache/flush.ts"], skipped: [], unavailable: [], notChecked: [] },
};

test.beforeEach(async () => {
  await control("reset");
});

const thread = (page: Page, id: number) => page.locator(`#t-${id}`);
const card = (page: Page, id: number) => thread(page, id).locator("[data-reply-draft]");
const tick = (c: Locator) => c.getByRole("checkbox", { name: "Resolve after posting" });
const badge = (page: Page, id: number) => page.locator(`#th-${id} [data-resolved]`);

async function connect(page: Page) {
  await openApp(page);
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", { turns: 2, resolved: true });
  await page.locator("[data-row]", { hasText: TITLE }).first().click();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(TITLE);
}

// A sync can open the thread between the read and the click, so the click repeats until the thread stays open.
async function openThread(page: Page, id: number) {
  const head = page.locator(`#th-${id}`);
  await expect(async () => {
    if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
  }).toPass();
}

// A thread that I resolve folds into the closed Resolved group. The button opens the group.
async function showResolved(page: Page, n: number) {
  await page.getByRole("button", { name: `Show ${n} resolved` }).click();
}

async function more(page: Page, id: number, item: string) {
  await thread(page, id).getByRole("button", { name: "More for this thread" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

test("Draft replies proposes resolve; untick keeps a thread open; the post replies first, then resolves; the badge shows after the sync", async ({
  page,
}) => {
  await connect(page);
  await control("claude", { stream: "tree", replies: REPLIES });
  await page.locator("#replies-btn").click();
  await expect(page.locator("#runline [data-run-kind='reply']")).toHaveAttribute("data-run-state", "done", { timeout: RUN_MS });
  await expect(page.locator("#runline")).toContainText("1 reply draft, 2 threads to resolve");

  // A resolve without a reply: the proof and the tick on my own thread.
  const only = card(page, ONLY);
  await expect(only).toContainText("Resolve proposal");
  await expect(only).toContainText("No reply. The thread resolves after the post.");
  await expect(only).toContainText("proposes it: src/cache/flush.ts:3 takes the lock once.");
  await expect(tick(only)).toBeChecked();
  const both = card(page, BOTH);
  await expect(both).toContainText(REPLY);
  await expect(tick(both)).toBeChecked();

  // Untick: the reply posts, and the thread stays open.
  await tick(both).click();
  await expect(tick(both)).not.toBeChecked();
  await both.getByRole("button", { name: "Accept" }).click();
  await expect(both).toContainText("Accepted");
  await only.getByRole("button", { name: "Accept" }).click();
  await expect(only).toContainText("Accepted");
  await expect(page.getByText("Ready to post: 1 reply and 1 thread resolve")).toBeVisible();
  expect(await writes()).toEqual([]);

  await page.keyboard.press("p");
  const box = page.getByRole("dialog", { name: "Post 1 reply and 1 thread resolve to PROJ1/sample-repo-2 #1001?" });
  const items = box.getByRole("list", { name: "Comments to post" }).getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Resolve the thread in the general comment");
  await expect(items.nth(0)).toContainText("Resolves the thread. No reply is posted.");
  await expect(items.nth(1)).toContainText("Reply to Alex Smith in the general comment");
  await expect(items.nth(1).locator("[data-resolve]")).toHaveCount(0);
  await box.getByRole("button", { name: "Post", exact: true }).click();

  // The reply goes first, then the PUT. The resolved thread joins the Resolved group at once, with its badge.
  await expect(thread(page, BOTH).locator("[data-post]")).toContainText("Posted.");
  await showResolved(page, 3);
  await expect(badge(page, ONLY)).toContainText("Resolved by you");
  expect(await writes()).toEqual([`POST ${A}/comments`, `PUT ${A}/comments/${ONLY}`]);
  expect(await posts()).toMatchObject([{ text: MARK + REPLY, parent: { id: 1000202 } }]);
  await expect(badge(page, BOTH)).toHaveCount(0);

  // A full sync reads the thread back from the fake Bitbucket.
  await control("state", {});
  await expect(badge(page, ONLY)).toContainText("Resolved by you");
  await expect(card(page, ONLY)).toHaveCount(0);
});

test("manual Reopen and Resolve: my thread goes at once, another person's thread asks first", async ({ page }) => {
  await connect(page);

  // My own thread: Resolve goes out with no question. Reopen brings it back.
  await openThread(page, ONLY);
  await more(page, ONLY, "Resolve thread");
  await expect(page.getByRole("status").filter({ hasText: "Thread resolved." })).toHaveCount(1);
  await showResolved(page, 3);
  await expect(badge(page, ONLY)).toContainText("Resolved by you");
  await openThread(page, ONLY);
  await more(page, ONLY, "Reopen thread");
  await expect(badge(page, ONLY)).toHaveCount(0);
  expect(await writes()).toEqual([`PUT ${A}/comments/${ONLY}`, `PUT ${A}/comments/${ONLY}`]);

  // Alex started thread 1000401, and Maria resolved it. Reopen asks first; Cancel sends nothing.
  await openThread(page, THEIRS);
  await expect(badge(page, THEIRS)).toContainText("Resolved by Maria");
  await more(page, THEIRS, "Reopen thread");
  const ask = thread(page, THEIRS).getByText("Alex Smith started this thread. Reopen it on Bitbucket?");
  await expect(ask).toBeVisible();
  await expect(thread(page, THEIRS).getByRole("button", { name: "Reopen", exact: true })).toBeFocused();
  await thread(page, THEIRS).getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toHaveCount(0);
  expect(await writes()).toHaveLength(2);
  await more(page, THEIRS, "Reopen thread");
  await thread(page, THEIRS).getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(badge(page, THEIRS)).toHaveCount(0);
  expect(await writes()).toEqual([`PUT ${A}/comments/${ONLY}`, `PUT ${A}/comments/${ONLY}`, `PUT ${A}/comments/${THEIRS}`]);
  await control("state", {});
  await expect(badge(page, THEIRS)).toHaveCount(0);
});
