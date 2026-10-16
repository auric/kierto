// Detail header (Group 1a, plan pr-view-v4 2.1 and 2.2): the sticky action bar, the key, author, branch, and task links, the plain
// run buttons, the More menu, and the Ask button. Runs against serve.ts only: the fake Bitbucket, a temp git remote, and the fake
// Claude Code CLI.
import { test as base, expect, type Page } from "@playwright/test";
import { APP_PORT, control, E2E_TOKEN, FAKE_URL, JIRA_ISSUE, openApp, type Scenario } from "./control";

const APP = `http://127.0.0.1:${APP_PORT}`;
// A run passes the git workspace, the fake CLI, and the validator.
const RUN_MS = 60_000;
// PR 1001 of PROJ1/sample-repo-2, from topic/sample-3 in the same repository.
const A = "Batch cache writes in the sync worker";
// PR 210, from a branch in the personal fork of its author (serve.ts).
const B = "Show build status on the release page";
const B_BRANCH = "feature/release_pipeline_observability_dashboard_rollout";

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

const row = (page: Page, title: string) => page.locator("[data-row]", { hasText: title }).first();
const bar = (page: Page) => page.locator("[data-actionbar]");
const pane = (page: Page) => page.locator("[data-scroll]");

// state: PR 210 shows in Needs you only with new messages (tall).
async function connect(page: Page, title: string, state: Partial<Scenario> = {}) {
  await openApp(page);
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", state);
  await row(page, title).click();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(title);
}

test("the action bar sticks with the key and the title, scroll targets stop below it, and Ask opens the Ask box", async ({ page }) => {
  await connect(page, B, { tall: 8 });
  await expect(page.locator("#t-2000000")).toBeVisible();
  // The PR opens at its first new message, so the bar is stuck at once.
  await expect(bar(page)).toHaveAttribute("data-stuck");
  await pane(page).evaluate((e) => e.scrollTo(0, 0));
  await expect(bar(page)).not.toHaveAttribute("data-stuck");
  // The title gets the full width: the run buttons have their own row.
  const title = await page.locator("section[aria-label='Details'] h1").boundingBox();
  const askAtTop = await page.locator("#ask-btn").boundingBox();
  expect((askAtTop?.y ?? 0) >= (title?.y ?? 0) + (title?.height ?? 0)).toBe(true);

  await pane(page).evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await expect(bar(page)).toHaveAttribute("data-stuck");
  await expect(bar(page)).toContainText("PLATFORM_RELEASE_ENGINEERING_TOOLS/release-pipeline-observability-dashboard #210");
  await expect(bar(page)).toContainText(B);
  const [b, p] = [await bar(page).boundingBox(), await pane(page).boundingBox()];
  if (!b || !p) throw new Error("no box");
  expect(Math.abs(b.y - p.y)).toBeLessThan(1);
  await expect(page.locator("#review-btn")).toBeInViewport();
  await expect(page.locator("#replies-btn")).toBeInViewport();
  expect(Number.parseFloat(await pane(page).evaluate((e) => e.style.scrollPaddingTop))).toBeCloseTo(b.height, 0);

  // n goes up to the first new message. It stops below the bar, not under it.
  await page.keyboard.press("n");
  const focused = await page.locator(":focus").boundingBox();
  expect(focused && focused.y >= b.y + b.height - 1).toBe(true);

  // Reduced motion: the title in the bar shows without a transition.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await pane(page).evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await expect(bar(page)).toHaveAttribute("data-stuck");
  expect(
    await bar(page)
      .locator("p")
      .evaluate((e) => getComputedStyle(e).transitionDuration),
  ).toBe("0s");

  // Ask in the bar does what q does: the Ask section opens with the focus in its box.
  await expect(page.locator("#ask-btn")).toHaveAccessibleName("Ask Claude");
  await page.locator("#ask-btn").click();
  await expect(page.locator("#ask-q")).toBeFocused();

  await pane(page).evaluate((e) => e.scrollTo(0, 0));
  await expect(bar(page)).not.toHaveAttribute("data-stuck");
});

test("branch links: the source branch of a fork PR opens in the fork, the copy button copies the name", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
  await connect(page, B, { tall: 1 });
  const src = page.locator(`[data-branch="${B_BRANCH}"]`);
  const link = src.getByRole("link", { name: B_BRANCH });
  await expect(link).toHaveAttribute(
    "href",
    `${FAKE_URL}/users/mlopez/repos/release-pipeline-observability-dashboard/browse?at=refs%2Fheads%2Ffeature%2Frelease_pipeline_observability_dashboard_rollout`,
  );
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  // The target repository has the recorded link of another host, so its branch shows without a link.
  await expect(page.locator('[data-branch="topic/sample-4"]').getByRole("link")).toHaveCount(0);

  // The copy button of the source branch is always visible (H3). Keyboard focus reaches it. The target branch has none.
  const copy = src.getByRole("button", { name: `Copy ${B_BRANCH}` });
  await expect(copy).toBeVisible();
  await expect(copy).toHaveCSS("opacity", "1");
  await expect(page.locator('[data-branch="topic/sample-4"]').getByRole("button")).toHaveCount(0);
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(B_BRANCH);
  await expect(page.getByRole("status").filter({ hasText: `Copied ${B_BRANCH}.` })).toHaveCount(1);

  // A PR from the same repository: the source branch opens there.
  await row(page, A).click();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(A);
  await expect(page.locator('[data-branch="topic/sample-3"]').getByRole("link")).toHaveAttribute(
    "href",
    `${FAKE_URL}/projects/PROJ1/repos/sample-repo-2/browse?at=refs%2Fheads%2Ftopic%2Fsample-3`,
  );
});

const detail = (page: Page) => page.locator("section[aria-label='Details']");
const B_KEY = "PLATFORM_RELEASE_ENGINEERING_TOOLS/release-pipeline-observability-dashboard #210";
const B_WEB = `${FAKE_URL}/projects/PLATFORM_RELEASE_ENGINEERING_TOOLS/repos/release-pipeline-observability-dashboard/pull-requests/210`;
// PR 1004 of the token owner (scenario author).
const D = "Release the write lock after each entry";

test("the key opens the PR on the server, the author name opens the user page, and More opens or copies the PR link", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
  await connect(page, B, { tall: 1 });
  // The whole key is one link to the PR. The separate link icon is gone.
  const key = detail(page).getByRole("link", { name: B_KEY, exact: true });
  await expect(key).toHaveAttribute("href", B_WEB);
  await expect(key).toHaveAttribute("target", "_blank");
  await expect(key).toHaveAttribute("rel", "noopener noreferrer");
  await expect(detail(page).getByRole("link", { name: /^Open in / })).toHaveCount(0);

  // serve.ts gives Maria a user link on the fake server (N2).
  const author = page.locator("[data-author]");
  await expect(author.getByRole("link", { name: "Maria Lopez" })).toHaveAttribute("href", `${FAKE_URL}/users/mlopez`);
  await expect(author).toContainText("Opened by Maria Lopez");
  // The byline names the author, so the Description heading does not repeat it.
  await expect(page.locator("#h-desc")).toHaveText("Description");

  // More: open the PR on the server, or copy its link. A reviewer PR has no session consult items.
  await page.locator("#more-btn").click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Open on Bitbucket" })).toHaveAttribute("href", B_WEB);
  await expect(menu.getByRole("menuitem", { name: /^Copy for your session/ })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "Copy the pull request link" }).click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(B_WEB);
  await expect(page.getByRole("status").filter({ hasText: "Copied the pull request link." })).toHaveCount(1);
  // Keyboard: Enter opens the menu, Esc closes it and gives the focus back. Letters stay in the menu.
  await page.locator("#more-btn").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("j");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.locator("#more-btn")).toBeFocused();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(B);

  // Alex's recorded user link has another host, so his name stays text.
  await row(page, A).click();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(A);
  await expect(author).toContainText("Alex");
  await expect(author.getByRole("link")).toHaveCount(0);
});

// The brief of a PR without a task ID offers "Set up task IDs". It opens the same section as a chip without a link pattern.
test("Set up task IDs in the brief opens Settings, Task IDs, and Back returns to the PR", async ({ page }) => {
  await connect(page, A);
  const pr = new URL(page.url()).pathname;
  await page.keyboard.press("r");
  const brief = page.locator("#brief");
  await expect(brief).toContainText("No task ID found.");
  await brief.getByRole("button", { name: "Set up task IDs" }).click();
  await expect(page).toHaveURL(`${APP}/settings/task-ids`);
  await expect(page.getByRole("heading", { name: "Task IDs" })).toBeFocused();
  await page.goBack();
  await expect.poll(() => new URL(page.url()).pathname).toBe(pr);
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(A);
});

test("task chips: a chip without a link pattern opens Settings, Task IDs; with a pattern it opens the task", async ({ page }) => {
  await connect(page, A, { task: true });
  const chip = detail(page).locator(`header [data-task-chip="${JIRA_ISSUE}"]`);
  // The dashed border and the name carry the missing link, not only the color (H2).
  await expect(chip).toHaveAccessibleName(`${JIRA_ISSUE}. No task link yet. Opens Settings, Task IDs.`);
  await expect(chip).toHaveCSS("border-style", "dashed");
  await chip.click();
  await expect(page).toHaveURL(`${APP}/settings/task-ids`);
  await expect(page.getByRole("heading", { name: "Task IDs" })).toBeFocused();

  await page.getByLabel("Task link (optional)").fill("https://tracker.example.test/browse/{key}");
  await expect(page.locator("#taskids-status")).toHaveText("Saved. The inbox finds the task IDs again in the background.");
  await page.getByRole("button", { name: "Close the settings" }).click();
  await row(page, A).click();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(A);
  const link = detail(page).locator("header").getByRole("link", { name: JIRA_ISSUE, exact: true });
  await expect(link).toHaveAttribute("href", `https://tracker.example.test/browse/${JIRA_ISSUE}`);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveCSS("border-style", "solid");
});

test("Review and Draft replies are plain buttons; a zero count explains itself; an own PR has the session consult in More", async ({
  page,
}) => {
  await connect(page, A);
  // No split button and no profile name in a label (plan pr-view-v4 2.2).
  await expect(page.locator("#review-btn")).toHaveText("Review");
  await expect(page.locator("#review-btn-menu, #replies-btn-menu")).toHaveCount(0);
  await expect(page.locator("#ask-btn")).toHaveText("Ask");

  // Your message is the newest in the one open thread, so a click explains why no run starts.
  const replies = page.locator("#replies-btn");
  await expect(replies).toHaveAccessibleName("Draft replies");
  await replies.click();
  const pop = page.locator("[data-slot='popover-content']");
  await expect(pop).toContainText("No thread waits for your reply.");
  await expect(pop).toContainText("Your message is the newest in the open thread. It waits for the other person.");
  // Esc closes the popover only. The PR stays open.
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(replies).toBeFocused();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(A);
  await expect(page.locator("#runline [data-run-kind='reply']")).toHaveCount(0);

  // A your-turn thread gives the count, and a click starts the run with the brief profile.
  await control("state", { turns: 2 });
  await expect(replies).toHaveAccessibleName("Draft replies, 2 threads");
  await expect(replies).toHaveText(/^Draft replies\s*2$/, { useInnerText: true });
  await replies.click();
  await expect(page.locator("#runline [data-run-kind='reply']")).toHaveAttribute("data-run-state", "done", { timeout: RUN_MS });
  await expect(page.locator("#runline [data-run-kind='reply']")).toContainText("General profile");

  // A pane of 520 px or less shows "Replies". Every button keeps a text label, and the stuck title hides.
  await page.setViewportSize({ width: 400, height: 800 });
  await expect(replies).toHaveText(/^Replies\s*2$/, { useInnerText: true });
  await expect(page.locator("#ask-btn")).toHaveText("Ask");
  await page.setViewportSize({ width: 1440, height: 900 });

  // An own PR: More holds the session consult (docs/plans/session-consult.md). tests/e2e/consult.e2e.ts covers its dialogs.
  await control("state", { author: true });
  await row(page, D).click();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(D);
  await expect(page.locator("[data-author]")).toContainText("Opened by You");
  await page.locator("#more-btn").click();
  for (const name of [/^Copy for your session…/, /^Paste the answer…/]) {
    const item = page.getByRole("menu").getByRole("menuitem", { name });
    await expect(item).not.toContainText("Planned");
    await expect(item).not.toHaveAttribute("aria-disabled", "true");
  }
  await page.keyboard.press("Escape");
});
