// M3 browser acceptance (plan v3 WP14a): triage, the post confirm, the outbox states, and replies.
// Runs against serve.ts only: the fake Bitbucket, a temp git remote, and the fake Claude Code CLI.
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { APP_PORT, control, E2E_TOKEN, FAKE_URL, MARK, posts } from "./control";

const APP = `http://127.0.0.1:${APP_PORT}`;
const TITLE = "Batch cache writes in the sync worker";
// A run passes the git workspace, the fake CLI, and the validator.
const RUN_MS = 60_000;
// tests/support/review-fixture.ts REVIEW_RESULT: the exact and the moved finding on src/cache/flush.ts.
const LOCK = "The lock now covers one entry at a time. Another writer can run between two entries. Take the lock once, before the loop.";
const RELEASE = "`lock.release()` does not run when `write()` throws. Release the lock in a `finally` block.";
// PR 1001: my general comment 1000003 with my reply 1000001 (activities-nested-reply.json).
const ROOT = 1000003;

const test = base.extend<{ seen: { urls: string[]; logs: string[] } }>({
  seen: [
    async ({ context }, use) => {
      const seen = { urls: [] as string[], logs: [] as string[] };
      context.on("request", (r) => seen.urls.push(r.url()));
      context.on("console", (m) => seen.logs.push(m.text()));
      context.on("weberror", (e) => seen.logs.push(e.error().message));
      await control("reset");
      await use(seen);
      // Every test: only the local app gets requests, and the console holds no token and no CSP violation.
      expect(seen.urls.filter((u) => !u.startsWith(`${APP}/`))).toEqual([]);
      expect(seen.logs.filter((l) => l.includes(E2E_TOKEN))).toEqual([]);
      expect(seen.logs.filter((l) => /Content Security Policy|Content-Security-Policy/i.test(l))).toEqual([]);
    },
    { auto: true },
  ],
});

const row = (page: Page) => page.locator("[data-row]", { hasText: TITLE }).first();
const drafts = (page: Page) => page.locator("[data-draft]");
const confirmBox = (page: Page) => page.getByRole("dialog", { name: /^Post .* to PROJ1\/sample-repo-2 #1001\?$/ });
const postButton = (box: Locator) => box.getByRole("button", { name: "Post", exact: true });
const thread = (page: Page) => page.locator(`#t-${ROOT}`);
const replyBox = (page: Page) => thread(page).getByRole("textbox", { name: /^Reply to / });

async function connect(page: Page) {
  await page.goto("/");
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", {});
  await open(page);
}

async function open(page: Page) {
  await row(page).click();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(TITLE);
}

// Shift+R opens the brief. Ctrl+Enter starts the review. The fake CLI gives 3 drafts and 1 question.
async function reviewed(page: Page) {
  await page.keyboard.press("Shift+R");
  await page.getByLabel("Your note").fill("ABC-1: check the lock scope.");
  await page.getByLabel("Your note").press("Control+Enter");
  await expect(page.locator("#runline")).toContainText(/Claude reviewed [0-9a-f]{7}/, { timeout: RUN_MS });
  await expect(drafts(page)).toHaveCount(3);
}

// A sync can open the thread between the read and the click, so the click repeats until the thread stays open.
async function openThread(page: Page) {
  const head = page.locator(`#th-${ROOT}`);
  await expect(async () => {
    if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
  }).toPass();
}

async function startReply(page: Page, text: string) {
  await openThread(page);
  await thread(page).getByRole("button", { name: "Write a reply" }).click();
  await expect(replyBox(page)).toBeFocused();
  await replyBox(page).fill(text);
}

test("A8: two of the drafts are accepted, and exactly those two texts post after the confirm", async ({ page }) => {
  await connect(page);
  await reviewed(page);
  // Accept moves the focus to the next untriaged draft, so the keys a and d triage the rest.
  await drafts(page).nth(0).getByRole("button", { name: "Accept" }).click();
  await expect(drafts(page).nth(1)).toBeFocused();
  await page.keyboard.press("a");
  await expect(drafts(page).nth(2)).toBeFocused();
  await page.keyboard.press("d");
  await expect(drafts(page).nth(2)).toContainText("Discarded: The README does not name the flush order.");
  await page.locator("#ai-sum-head").click();
  await page.locator("#ai-sum").getByRole("button", { name: "Discard" }).click();
  await expect(page.locator("#ai-sum")).toContainText("Discarded: Must flush() stay atomic for readers?");
  await expect(page.getByText("Ready to post: 2 inline comments")).toBeVisible();
  await expect(page.locator("#nav-post")).toHaveAccessibleName("Ready to post: 1");

  // Esc closes the confirm, and nothing posts.
  await page.keyboard.press("p");
  const box = confirmBox(page);
  await expect(box).toHaveAccessibleName("Post 2 inline comments to PROJ1/sample-repo-2 #1001?");
  await expect(postButton(box)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
  await expect(page.locator("#post-btn")).toBeFocused();
  expect(await posts()).toEqual([]);

  // The confirm shows the destination and the exact text of each comment.
  await page.keyboard.press("p");
  const items = box.getByRole("list", { name: "Comments to post" }).getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("flush.ts:3");
  await expect(items.nth(0)).toContainText("Inline comment");
  await expect(items.nth(0)).toContainText(LOCK);
  await expect(items.nth(1)).toContainText("flush.ts:5");
  await postButton(box).click();
  await expect(box).toBeHidden();
  await expect(page.locator("[data-post]", { hasText: "Posted." })).toHaveCount(2);
  // Plan v3 WP13b: a posted row links to its comment on the PR link of the server.
  const link = (id: number) => `${FAKE_URL}/projects/PROJ1/repos/sample-repo-2/pull-requests/1001/overview?commentId=${id}`;
  await expect(page.locator(`[data-post] a[href="${link(4_000_001)}"], [data-post] a[href="${link(4_000_002)}"]`)).toHaveCount(2);
  await expect(drafts(page)).toHaveCount(1);
  await expect(page.locator("#nav-post")).toHaveAccessibleName("Ready to post: 0");

  const sent = await posts();
  expect(sent.map((b) => b.text)).toEqual([MARK + LOCK, MARK + RELEASE]);
  expect(sent.map((b) => [b.anchor?.path, b.anchor?.line, b.parent])).toEqual([
    ["src/cache/flush.ts", 3, undefined],
    ["src/cache/flush.ts", 5, undefined],
  ]);

  // The next check brings the comments back as threads, so the outbox rows go away.
  await control("state", {});
  await expect(page.locator("[data-post]")).toHaveCount(0);
  const posted = page.locator("[data-thread]", { hasText: "flush.ts:" });
  await expect(posted).toHaveCount(2);
  await posted.first().locator("button[aria-expanded]").first().click();
  await expect(posted.first()).toContainText("Posted from a Claude Code review");
  await expect(posted.first().getByRole("link", { name: "Open this thread in Bitbucket" })).toHaveAttribute(
    "href",
    /\/overview\?commentId=400000[12]$/,
  );
});

test("A9: the connection drops after Bitbucket accepts; the outcome is unknown, and Post again finds it with no second post", async ({
  page,
}) => {
  await connect(page);
  await reviewed(page);
  await drafts(page).nth(0).getByRole("button", { name: "Accept" }).click();
  // p before the accept arrives finds nothing to post.
  await expect(page.getByText("Ready to post: 1 inline comment")).toBeVisible();
  // The POST is stored, then the connection drops. The check cannot read the comments yet.
  await posts({ drop: true, hide: true });
  await page.keyboard.press("p");
  await postButton(confirmBox(page)).click();
  const out = page.locator("[data-post]");
  await expect(out).toContainText("Outcome unknown.");
  await expect(out).toContainText(/Could not read (all|the) comments on Bitbucket/);
  await expect(out.getByRole("button", { name: "Drop" })).toBeVisible();
  expect(await posts({ hide: false })).toHaveLength(1);

  await out.getByRole("button", { name: "Post again" }).click();
  await expect(out).toContainText("Posted.");
  await expect(page.getByText("The comment is on Bitbucket already. Nothing was posted again.")).toBeVisible();
  expect(await posts()).toHaveLength(1);
});

test("a failed inline post shows the reason and moves to the general comment", async ({ page }) => {
  await connect(page);
  await reviewed(page);
  await drafts(page).nth(0).getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Ready to post: 1 inline comment")).toBeVisible();
  await posts({ fail: 400 });
  await page.keyboard.press("p");
  await postButton(confirmBox(page)).click();
  const out = page.locator("[data-post]");
  await expect(out).toContainText("Failed.");
  await expect(out).toContainText("HTTP 400");
  await expect(out.getByRole("button", { name: "Retry" })).toBeVisible();
  await out.getByRole("button", { name: "Move to general comment" }).click();
  await expect(out).toHaveCount(0);
  await expect(page.getByText("Ready to post: 1 general comment")).toBeVisible();

  await page.keyboard.press("p");
  const box = confirmBox(page);
  await expect(box).toContainText("General comment");
  await expect(box).toContainText(`src/cache/flush.ts:3: ${LOCK}`);
  await postButton(box).click();
  await expect(out).toContainText("Posted.");
  const sent = await posts();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.text).toBe(`${MARK}src/cache/flush.ts:3: ${LOCK}`);
  expect(sent[0]?.anchor).toBeUndefined();
});

test("two pages confirm the same items, and only one post goes out (A14)", async ({ page, context }) => {
  await connect(page);
  await reviewed(page);
  await drafts(page).nth(0).getByRole("button", { name: "Accept" }).click();
  const other = await context.newPage();
  await other.goto("/");
  await open(other);
  await expect(other.getByText("Ready to post: 1 inline comment")).toBeVisible();
  for (const p of [page, other]) {
    await p.keyboard.press("p");
    await expect(postButton(confirmBox(p))).toBeFocused();
  }
  await postButton(confirmBox(page)).click();
  await expect(page.locator("[data-post]")).toContainText("Posted.");
  await postButton(confirmBox(other)).click();
  await expect(other.getByText("These comments were posted from another page already. Nothing was posted again.")).toBeVisible();
  await expect(other.locator("[data-post]")).toContainText("Posted.");
  expect(await posts()).toHaveLength(1);
});

test("a reply round trip: preview, confirm with the destination, post, and the reply comes back read", async ({ page }) => {
  const text = "Thanks. **Fixed** in the next commit.";
  await connect(page);
  await startReply(page, text);
  await thread(page).getByRole("button", { name: "Preview" }).click();
  await expect(thread(page).locator("strong", { hasText: "Fixed" })).toBeVisible();
  await thread(page).getByRole("button", { name: "Preview" }).click();
  await replyBox(page).press("Control+Enter");
  const box = thread(page).getByRole("dialog", { name: "Post this reply to your message?" });
  await expect(box).toContainText("Reply to your message in the general comment");
  await expect(box.locator("strong", { hasText: "Fixed" })).toBeVisible();
  await postButton(box).click();
  const out = thread(page).locator("[data-post]");
  await expect(out).toContainText("Posted.");
  await expect(thread(page).getByRole("button", { name: "Write a reply" })).toBeVisible();
  expect(await posts()).toMatchObject([{ text, parent: { id: 1000001 } }]);

  await control("state", {});
  await expect(out).toHaveCount(0);
  const mine = thread(page).locator("article.rl-msg", { hasText: "in the next commit" });
  await expect(mine).toBeVisible();
  await expect(mine).not.toHaveAttribute("data-new");
});

test("new messages after the confirm opened give 409: the page says so, and the second confirm posts once", async ({ page }) => {
  const text = "Looks good to me now.";
  await connect(page);
  await control("state", { reply: "new" });
  await expect(thread(page)).toHaveAttribute("aria-label", /^Your turn\./);
  await startReply(page, text);
  await replyBox(page).press("Control+Enter");
  const box = thread(page).getByRole("dialog");
  await expect(postButton(box)).toBeFocused();
  // Another reply arrives while the confirm is open. The thread stays in the same group.
  await control("state", { reply: "two" });
  await expect(page.locator("#c-1000011")).toBeVisible();
  await postButton(box).click();
  await expect(thread(page).getByRole("alert")).toHaveText("New messages arrived in this thread. Read them, then post your reply again.");
  await expect(replyBox(page)).toHaveValue(text);
  expect(await posts()).toEqual([]);

  await replyBox(page).press("Control+Enter");
  await postButton(thread(page).getByRole("dialog")).click();
  await expect(thread(page).locator("[data-post]")).toContainText("Posted.");
  expect(await posts()).toMatchObject([{ text, parent: { id: 1000011 } }]);
});

test("an unsent reply survives a reload; Discard clears it", async ({ page }) => {
  const text = "A draft that survives a reload.";
  await connect(page);
  await startReply(page, text);
  await page.reload();
  await open(page);
  await openThread(page);
  await expect(replyBox(page)).toHaveValue(text);
  // Discard offers Undo, which gives the text back to the reply box.
  await thread(page).getByRole("button", { name: "Discard" }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(replyBox(page)).toHaveValue(text);
  await thread(page).getByRole("button", { name: "Discard" }).click();
  await page.reload();
  await open(page);
  await openThread(page);
  await expect(thread(page).getByRole("button", { name: "Write a reply" })).toBeVisible();
  expect(await posts()).toEqual([]);
});
