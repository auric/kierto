// Detail header (Group 1a): the sticky action bar, the branch links with their copy button, the profile menus of the run buttons,
// and the Ask button. Runs against serve.ts only: the fake Bitbucket, a temp git remote, and the fake Claude Code CLI.
import { test as base, expect, type Page } from "@playwright/test";
import { APP_PORT, control, E2E_TOKEN, FAKE_URL, type Scenario } from "./control";

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
  await page.goto("/");
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

  // The copy button shows on hover and on focus. Keyboard focus reaches it.
  const copy = src.getByRole("button", { name: `Copy ${B_BRANCH}` });
  await expect(copy).toHaveCSS("opacity", "0");
  await copy.focus();
  await expect(copy).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(B_BRANCH);

  // A PR from the same repository: the source branch opens there.
  await row(page, A).click();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(A);
  await expect(page.locator('[data-branch="topic/sample-3"]').getByRole("link")).toHaveAttribute(
    "href",
    `${FAKE_URL}/projects/PROJ1/repos/sample-repo-2/browse?at=refs%2Fheads%2Ftopic%2Fsample-3`,
  );
});

test("profile menus: Draft replies runs once with another profile, the run line names it, and the brief keeps its profile", async ({
  page,
}) => {
  await connect(page, A);
  await control("state", { turns: 3 });
  await expect(page.locator("#replies-btn")).toHaveAccessibleName("Draft replies · General, 3 threads");
  await page.locator("#replies-btn-menu").click();
  const menu = page.getByRole("menu");
  await expect(menu).toContainText("Profile for these replies");
  await expect(menu.getByRole("menuitem", { name: /^General.*Default$/ })).toBeVisible();
  await menu.getByRole("menuitem", { name: /^Security/ }).click();
  await expect(page.locator("#runline")).toContainText(/Claude drafted replies on [0-9a-f]{7}/, { timeout: RUN_MS });
  await expect(page.locator("#runline")).toContainText("Security profile");
  await expect(page.locator("#review-btn")).toHaveText(/Review · General/);

  // Keyboard: the menu button opens the menu. Letters stay in the menu. Esc closes it and gives the focus back.
  await page.locator("#review-btn-menu").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("j");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.locator("#review-btn-menu")).toBeFocused();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(A);

  // Open brief in the Review menu: the brief opens with the focus in the note.
  await page.locator("#review-btn-menu").click();
  await page.getByRole("menuitem", { name: /^Open brief/ }).click();
  await expect(page.locator("#brief-note")).toBeFocused();
});
