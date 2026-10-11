// Reply drafts (docs/plans/replies.md WP18): the Draft replies button, the draft card in each thread, its triage and post,
// the stale mark, cancel, and a reply confirm that stays open when its thread changes group.
// Runs against serve.ts only: the fake Bitbucket, a temp git remote, and the fake Claude Code CLI. The CLI echoes one reply per
// thread of its "Threads:" line, and every third thread gets action none (tests/support/fake-claude.ts echoReplies).
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { APP_PORT, control, E2E_TOKEN, FAKE_URL, posts } from "./control";

const APP = `http://127.0.0.1:${APP_PORT}`;
const TITLE = "Batch cache writes in the sync worker";
// A run passes the git workspace, the fake CLI, and the validator.
const RUN_MS = 60_000;
// PR 1001: my general comment 1000003 with my reply 1000001 (activities-nested-reply.json).
const ROOT = 1000003;
// The echo body for the message that a draft answers. Markdown shows the backticks as code.
const echo = (msg: number) => `Thanks. I checked message ${msg} against flush() and will change it.`;
const echoRaw = (msg: number) => `Thanks. I checked message ${msg} against \`flush()\` and will change it.`;

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
const thread = (page: Page, id: number) => page.locator(`#t-${id}`);
const card = (page: Page, id: number) => thread(page, id).locator("[data-reply-draft]");
const runline = (page: Page) => page.locator("#runline");
const repliesButton = (page: Page) => page.getByRole("button", { name: /^Draft replies · / });
const confirmBox = (page: Page) => page.getByRole("dialog", { name: /^Post .* to PROJ1\/sample-repo-2 #1001\?$/ });
const postButton = (box: Locator) => box.getByRole("button", { name: "Post", exact: true });

async function connect(page: Page) {
  await page.goto("/");
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", {});
  await row(page).click();
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

test("Draft replies: three your-turn threads get inline drafts, one needs no reply; Accept and p post one reply under its parent", async ({
  page,
}) => {
  await connect(page);
  await control("state", { turns: 3 });
  const btn = repliesButton(page);
  await expect(btn).toHaveAccessibleName("Draft replies · General, 3 threads");
  await btn.click();
  await expect(runline(page)).toContainText(/Claude drafted replies on [0-9a-f]{7}/, { timeout: RUN_MS });
  await expect(runline(page)).toContainText("2 reply drafts, 1 thread needs no reply");
  // Key 2 with no review drafts goes to the first reply draft.
  await page.keyboard.press("2");
  await expect(page.locator(":focus")).toHaveAttribute("id", /^rd-/);
  await expect(page.locator(":focus")).toContainText("Reply draft to Alex Smith");

  for (const [t, msg] of [
    [1000101, 1000201],
    [1000102, 1000202],
  ] as const) {
    const c = card(page, t);
    await expect(c).toContainText(`Reply draft to Alex Smith`);
    await expect(c).toContainText(echo(msg));
    await expect(c).toContainText("Shown in code. The comment asks for a change.");
    await expect(c.getByRole("button", { name: "Copy Markdown" })).toBeVisible();
    await expect(c.getByRole("button", { name: "Accept" })).toBeVisible();
  }
  // Action none: the reason, and the reply box of the thread for your own reply.
  await expect(card(page, 1000103)).toContainText("No reply needed: The thread needs no answer from you.");
  await expect(card(page, 1000103).getByRole("button", { name: "Accept" })).toHaveCount(0);
  await expect(thread(page, 1000103).getByRole("button", { name: "Write a reply" })).toBeVisible();
  // The waiting thread was not asked, and a reply run makes no review draft.
  await openThread(page, ROOT);
  await expect(card(page, ROOT)).toHaveCount(0);
  await expect(drafts(page)).toHaveCount(0);

  await card(page, 1000101).getByRole("button", { name: "Accept" }).click();
  await expect(card(page, 1000101)).toContainText("Accepted");
  await expect(card(page, 1000101)).toBeFocused();
  await expect(page.getByText("Ready to post: 1 reply")).toBeVisible();
  expect(await posts()).toEqual([]);

  await page.keyboard.press("p");
  const box = confirmBox(page);
  await expect(box).toHaveAccessibleName("Post 1 reply to PROJ1/sample-repo-2 #1001?");
  const items = box.getByRole("list", { name: "Comments to post" }).getByRole("listitem");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("Reply to Alex Smith in the general comment");
  await expect(items.first()).toContainText(echo(1000201));
  await postButton(box).click();
  await expect(thread(page, 1000101).locator("[data-post]")).toContainText("Posted.");
  await expect(card(page, 1000101)).toHaveCount(0);
  expect(await posts()).toMatchObject([{ text: echoRaw(1000201), parent: { id: 1000201 } }]);
});

test("review drafts stay after a reply run (R14), and a per-thread draft replaces only that thread's draft", async ({ page }) => {
  await connect(page);
  await control("state", { turns: 3 });
  await page.keyboard.press("Shift+R");
  await page.getByLabel("Your note").fill("ABC-1: check the lock scope.");
  await page.getByLabel("Your note").press("Control+Enter");
  await expect(runline(page)).toContainText(/Claude reviewed [0-9a-f]{7}/, { timeout: RUN_MS });
  await expect(drafts(page)).toHaveCount(3);

  await repliesButton(page).click();
  await expect(runline(page)).toContainText(/Claude drafted replies on [0-9a-f]{7}/, { timeout: RUN_MS });
  // The newest review run still drives the drafts, the summary, and the brief.
  await expect(drafts(page)).toHaveCount(3);
  await expect(page.locator("#ai-sum-head")).toContainText("Claude's summary");
  await expect(page.locator("#review-btn")).toHaveText(/Review · General/);
  await expect(card(page, 1000103)).toContainText("No reply needed");
  // Key 2 goes to the review drafts, then on to the reply drafts, then back.
  const focused = page.locator(":focus");
  await page.keyboard.press("2");
  await expect(focused).toHaveAttribute("id", /^d-/);
  await page.keyboard.press("2");
  await expect(focused).toHaveAttribute("id", /^rd-/);
  await expect(focused).toContainText("Reply draft to Alex Smith");
  await page.keyboard.press("2");
  await expect(focused).toHaveAttribute("id", /^d-/);
  const kept = await card(page, 1000101).getAttribute("id");

  await thread(page, 1000103).getByRole("button", { name: "Draft reply" }).click();
  await expect(card(page, 1000103)).toContainText(echo(1000203), { timeout: RUN_MS });
  await expect(card(page, 1000103)).not.toContainText("No reply needed");
  await expect(card(page, 1000101)).toHaveAttribute("id", kept ?? "");
  await expect(card(page, 1000102)).toContainText(echo(1000202));
  await expect(drafts(page)).toHaveCount(3);
});

test("a stale draft says new messages arrived; Draft again answers the newest message, and an edit posts as written", async ({ page }) => {
  await connect(page);
  await control("state", { reply: "new" });
  await expect(thread(page, ROOT)).toHaveAttribute("aria-label", /^Your turn\./);
  await expect(repliesButton(page)).toHaveAccessibleName("Draft replies · General, 1 thread");
  await repliesButton(page).click();
  await expect(card(page, ROOT)).toContainText(echo(1000010), { timeout: RUN_MS });
  await expect(card(page, ROOT)).not.toContainText("New messages since this draft.");

  await control("state", { reply: "two" });
  await expect(page.locator("#c-1000011")).toBeVisible();
  await expect(card(page, ROOT)).toContainText("New messages since this draft.");
  await card(page, ROOT).getByRole("button", { name: "Draft again" }).click();
  await expect(card(page, ROOT)).toContainText(echo(1000011), { timeout: RUN_MS });
  await expect(card(page, ROOT)).not.toContainText("New messages since this draft.");

  const text = "Done. The flush runs first now.";
  await card(page, ROOT).getByRole("button", { name: "Edit" }).click();
  const box = card(page, ROOT).getByRole("textbox", { name: "Edit the reply" });
  await expect(box).toBeFocused();
  await box.fill(text);
  await box.press("Control+Enter");
  await expect(card(page, ROOT)).toContainText("edited by you");
  await expect(card(page, ROOT)).toContainText("Accepted");
  await page.keyboard.press("p");
  await postButton(confirmBox(page)).click();
  await expect(thread(page, ROOT).locator("[data-post]")).toContainText("Posted.");
  expect(await posts()).toMatchObject([{ text, parent: { id: 1000011 } }]);
});

test("cancel stops a reply run: the pending card goes, and no draft appears", async ({ page }) => {
  await connect(page);
  await control("state", { turns: 1 });
  await control("claude", { stream: "tree", hang: true });
  await thread(page, 1000101).getByRole("button", { name: "Draft reply" }).click();
  await expect(card(page, 1000101)).toContainText("Claude is drafting a reply…");
  await expect(runline(page)).toContainText("Drafting replies…", { timeout: RUN_MS });
  await runline(page).getByRole("button", { name: "Cancel" }).click();
  await expect(runline(page)).toContainText(/You cancelled the reply drafts after \d+ tool calls?\./, { timeout: RUN_MS });
  await expect(card(page, 1000101)).toHaveCount(0);
  await expect(thread(page, 1000101).getByRole("button", { name: "Draft reply" })).toBeVisible();
  expect(await posts()).toEqual([]);
});

test("a reply confirm stays open while its thread moves from Waiting to Your turn", async ({ page }) => {
  const text = "The flush order is fixed now.";
  // The heading of the group that holds the thread: the nearest h3 before it.
  const group = () =>
    thread(page, ROOT).evaluate((el) => {
      let e = el.previousElementSibling;
      while (e && e.tagName !== "H3") e = e.previousElementSibling;
      return e?.textContent ?? "";
    });
  await connect(page);
  await expect(thread(page, ROOT)).toHaveAttribute("aria-label", /^Waiting/);
  expect(await group()).toMatch(/^Waiting on others/);
  await openThread(page, ROOT);
  await thread(page, ROOT).getByRole("button", { name: "Write a reply" }).click();
  const reply = thread(page, ROOT).getByRole("textbox", { name: /^Reply to / });
  await reply.fill(text);
  await reply.press("Control+Enter");
  const box = thread(page, ROOT).getByRole("dialog");
  await expect(postButton(box)).toBeFocused();
  const node = await thread(page, ROOT).elementHandle();

  // Another user answers, so the thread moves to the Your turn group.
  await control("state", { reply: "new" });
  await expect(thread(page, ROOT)).toHaveAttribute("aria-label", /^Your turn\./);
  expect(await group()).toMatch(/^Your turn/);
  // The same element, with the confirm still open and the focus still on Post.
  expect(await node?.evaluate((el) => el.isConnected)).toBe(true);
  await expect(box).toBeVisible();
  await expect(postButton(box)).toBeFocused();

  await box.getByRole("button", { name: "Cancel" }).click();
  await expect(box).toBeHidden();
  await expect(reply).toHaveValue(text);
  expect(await posts()).toEqual([]);
});
