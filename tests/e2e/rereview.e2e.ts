// Plan r2 UI-RR in the browser: a push after a review, then a review of only the new commits. Carried drafts keep their
// place, closed drafts read fixed or outdated, and the post goes out once on the new head.
// Runs against serve.ts only: the fake Bitbucket, a temp git remote, and the fake Claude Code CLI.
import { test as base, expect, type Page } from "@playwright/test";
import { APP_PORT, control, E2E_TOKEN, FAKE_URL, MARK, posts } from "./control";

const APP = `http://127.0.0.1:${APP_PORT}`;
const TITLE = "Batch cache writes in the sync worker";
// A run passes the git workspace, the fake CLI, and the validator.
const RUN_MS = 60_000;
// tests/support/review-fixture.ts REVIEW_RESULT: the drafts on flush.ts lines 3 and 5, then the README draft outside the diff.
const LOCK = "The lock now covers one entry at a time. Another writer can run between two entries. Take the lock once, before the loop.";

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

const runLine = (page: Page) => page.locator("#runline");
const drafts = (page: Page) => page.locator("[data-draft]");
const rereviewButton = (page: Page) => page.getByRole("button", { name: /^Review changes since [0-9a-f]{7}$/ });

async function connect(page: Page) {
  await page.goto("/");
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", {});
  await page.locator("[data-row]", { hasText: TITLE }).first().click();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(TITLE);
}

// Shift+R opens the brief. Ctrl+Enter starts the review. The fake CLI gives 3 drafts and 1 question. Returns the reviewed head.
async function reviewed(page: Page): Promise<string> {
  await page.keyboard.press("Shift+R");
  await page.getByLabel("Your note").fill("ABC-1: check the lock scope.");
  await page.getByLabel("Your note").press("Control+Enter");
  await expect(runLine(page)).toContainText(/Claude reviewed [0-9a-f]{7}/, { timeout: RUN_MS });
  await expect(drafts(page)).toHaveCount(3);
  return (await runLine(page).locator("code").first().textContent()) ?? "";
}

// The run line of a re-review names the head of the base run, then the new head.
const range = (page: Page) => runLine(page).getByRole("status").locator("code").allTextContents();

test("a push after a review: c reviews the new commits, carries the open draft, closes the others, and the post goes to the new head", async ({
  page,
}) => {
  await connect(page);
  const head = await reviewed(page);
  // No new commits: no button, and c says why.
  await expect(rereviewButton(page)).toHaveCount(0);
  await page.keyboard.press("c");
  await expect(page.getByText("The source branch has no new commits since the last review.")).toBeVisible();

  await control("state", { push: true });
  await expect(runLine(page)).toContainText("New commits since");
  await expect(rereviewButton(page)).toHaveAccessibleName(`Review changes since ${head}`);
  await rereviewButton(page).click();
  await expect(runLine(page)).toContainText(`Reviewing changes since ${head}…`);
  // The arrow is hidden from screen readers. They read "to" instead.
  await expect(runLine(page)).toContainText(/Claude reviewed changes [0-9a-f]{7}→ to [0-9a-f]{7}/, { timeout: RUN_MS });
  const [from, to = "?"] = await range(page);
  expect(from).toBe(head);
  expect(to).not.toBe(head);
  // The fake CLI echo: no new finding, and the earlier findings in order open, fixed, outdated. The question carries too.
  await expect(runLine(page)).toContainText("0 new, 1 carried, 2 fixed or outdated, 2 questions");
  await expect(runLine(page)).not.toContainText("New commits since");
  await expect(rereviewButton(page)).toHaveCount(0);

  await expect(drafts(page)).toHaveCount(3);
  await expect(drafts(page).nth(0)).toContainText("Still open after the new commits.");
  await expect(drafts(page).nth(0)).toContainText(LOCK);
  await expect(drafts(page).nth(1)).toContainText("Fixed in the new commits: lock.release() does not run when write() throws.");
  await expect(drafts(page).nth(1).getByRole("button", { name: "Restore" })).toBeVisible();
  await expect(drafts(page).nth(2)).toContainText("Outdated: The README does not name the flush order.");

  await drafts(page).nth(0).getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Ready to post: 1 inline comment")).toBeVisible();
  await page.keyboard.press("p");
  const box = page.getByRole("dialog", { name: "Post 1 inline comment to PROJ1/sample-repo-2 #1001?" });
  await expect(box).toContainText(LOCK);
  await box.getByRole("button", { name: "Post", exact: true }).click();
  await expect(box).toBeHidden();
  await expect(page.locator("[data-post]", { hasText: "Posted." })).toHaveCount(1);

  const sent = await posts();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.text).toBe(MARK + LOCK);
  expect(sent[0]?.anchor).toMatchObject({ path: "src/cache/flush.ts", line: 3 });
  expect(String(sent[0]?.anchor?.toHash)).toMatch(new RegExp(`^${to}[0-9a-f]{33}$`));
});

test("a carried draft whose code is gone closes as outdated with no Restore, and d says why", async ({ page }) => {
  await connect(page);
  await reviewed(page);
  const ids = await drafts(page).evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-draft"))));
  const [lock, release, readme] = ids;
  const verdict = (id: number | undefined, status: string, path: string | null = null, line: number | null = null) => ({
    id,
    status,
    reason: "Scenario.",
    path,
    line,
  });
  await control("claude", {
    stream: "tree",
    rereview: {
      summary: "Only the docs changed.",
      risks: [],
      questions: [],
      coverage: { read: ["docs/flush.md"], skipped: [], unavailable: [], notChecked: [] },
      findings: [],
      // An open verdict on a file that the snapshot does not have: the server finds no anchor and closes it as outdated.
      earlier: [verdict(lock, "open"), verdict(release, "open", "src/cache/gone.ts", 4), verdict(readme, "fixed")],
    },
  });
  await control("state", { push: true });
  await expect(runLine(page)).toContainText("New commits since");
  await page.keyboard.press("c");
  await expect(runLine(page)).toContainText("0 new, 1 carried, 2 fixed or outdated, 1 question", { timeout: RUN_MS });

  await expect(drafts(page)).toHaveCount(3);
  const gone = drafts(page).nth(1);
  // The row names the line that the base run showed.
  await expect(gone).toContainText("flush.ts:5Outdated: lock.release() does not run when write() throws.");
  await expect(gone.getByRole("button", { name: "Restore" })).toHaveCount(0);
  await expect(drafts(page).nth(2)).toContainText("Fixed in the new commits: The README does not name the flush order.");
  await expect(drafts(page).nth(2).getByRole("button", { name: "Restore" })).toBeVisible();

  await gone.focus();
  await page.keyboard.press("d");
  await expect(page.getByText("The code of this finding is gone. It cannot come back.")).toBeVisible();
  await expect(gone).toContainText("Outdated:");
  expect(await posts()).toEqual([]);
});
