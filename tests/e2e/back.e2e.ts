// Plan pr-view-v4 P1: the URL holds the view, the PR, the thread, the file, and the settings section. Back and Forward walk them.
// Runs against serve.ts only: the fake Bitbucket, a temp git remote, and the fake Claude Code CLI.
import { test as base, expect, type Page } from "@playwright/test";
import { APP_PORT, control, E2E_TOKEN, FAKE_URL } from "./control";

const APP = `http://127.0.0.1:${APP_PORT}`;
// PR 1001 of PROJ1/sample-repo-2. Its general thread is 1000003. The fake git remote gives one changed file.
const A = "Batch cache writes in the sync worker";
const A_PATH = "/needs/PROJ1/sample-repo-2/1001";
// PR 77 of PROJ1/sample-repo-3: the token owner is a reviewer, so it is in Reviewing and not in My PRs.
const C = "Drop the legacy export endpoint";

const test = base.extend<{ seen: { urls: string[]; reads: string[] } }>({
  seen: [
    async ({ context }, use) => {
      const seen = { urls: [] as string[], reads: [] as string[] };
      context.on("request", (r) => {
        seen.urls.push(r.url());
        const path = new URL(r.url()).pathname;
        if (r.method() === "POST" && (path === "/api/read" || path.endsWith("/seen"))) seen.reads.push(path);
      });
      await control("reset");
      await use(seen);
      expect(seen.urls.filter((u) => !u.startsWith(`${APP}/`))).toEqual([]);
    },
    { auto: true },
  ],
});

const row = (page: Page, title: string) => page.locator("[data-row]", { hasText: title }).first();
const h1 = (page: Page) => page.locator("section[aria-label='Details'] h1");
const pane = (page: Page) => page.locator("[data-scroll]");
const path = (page: Page) => {
  const u = new URL(page.url());
  return u.pathname + u.search;
};
const depth = (page: Page) => page.evaluate(() => history.length);

// A low window, so the detail of PR 1001 scrolls.
async function connect(page: Page) {
  await page.setViewportSize({ width: 1280, height: 440 });
  await page.goto("/");
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", {});
  await expect(row(page, A)).toBeVisible();
}

test("a click opens a PR and a file with their own entries; Back closes the file at the same scroll, then shows the PR before", async ({
  page,
}) => {
  await connect(page);
  // A view change pushes an entry. Its first row is the default selection.
  await page.getByRole("button", { name: /^Reviewing/ }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/reviewing/PROJ1/sample-repo-2/1001");
  await row(page, C).click();
  await expect(h1(page)).toHaveText(C);
  await expect.poll(() => new URL(page.url()).pathname).toBe("/reviewing/PROJ1/sample-repo-3/77");

  await row(page, A).click();
  await expect(h1(page)).toHaveText(A);
  await expect.poll(() => new URL(page.url()).pathname).toBe("/reviewing/PROJ1/sample-repo-2/1001");
  // j in the list replaces the entry: no new Back step.
  const before = await depth(page);
  await row(page, A).focus();
  await page.keyboard.press("j");
  await page.keyboard.press("k");
  await expect(h1(page)).toHaveText(A);
  expect(await depth(page)).toBe(before);

  // The file click pushes an entry with the file. Back closes it and restores the scroll position.
  const get = page.locator("#s-files").getByRole("button", { name: "Get the code", exact: true });
  await page.locator("#s-files-sum").click();
  await get.click();
  const file = page.locator("#df-0");
  await expect(file).toBeFocused();
  const top = await pane(page).evaluate((el) => {
    el.scrollTop = Math.min(120, el.scrollHeight - el.clientHeight);
    return el.scrollTop;
  });
  expect(top).toBeGreaterThan(20);
  await page.waitForTimeout(300);
  await file.click();
  await expect(file).toHaveAttribute("aria-expanded", "true");
  await expect(page).toHaveURL(/\?(.*&)?file=src\/cache\/flush\.ts/);
  await pane(page).evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });

  await page.goBack();
  await expect(file).toHaveAttribute("aria-expanded", "false");
  await expect(h1(page)).toHaveText(A);
  expect(path(page)).not.toContain("file=");
  await expect.poll(() => pane(page).evaluate((el) => el.scrollTop)).toBeLessThanOrEqual(top + 2);
  expect(await pane(page).evaluate((el) => el.scrollTop)).toBeGreaterThanOrEqual(top - 2);

  await page.goBack();
  await expect(h1(page)).toHaveText(C);
  expect(new URL(page.url()).pathname).toBe("/reviewing/PROJ1/sample-repo-3/77");

  // Forward comes back to the PR and then to the open file.
  await page.goForward();
  await expect(h1(page)).toHaveText(A);
  await page.goForward();
  await expect(file).toHaveAttribute("aria-expanded", "true");
});

test("Settings sections and Edit profile… push entries; Back walks the sections, then returns to the PR", async ({ page }) => {
  await connect(page);
  await row(page, A).click();
  await expect(h1(page)).toHaveText(A);
  const prUrl = path(page);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(`${APP}/settings`);
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  await nav.getByRole("link", { name: "Task IDs" }).click();
  await expect(page).toHaveURL(`${APP}/settings/task-ids`);
  await expect(page.getByRole("heading", { name: "Task IDs" })).toBeFocused();
  await nav.getByRole("link", { name: "Checks" }).click();
  await expect(page).toHaveURL(`${APP}/settings/checks`);

  await page.goBack();
  await expect(page).toHaveURL(`${APP}/settings/task-ids`);
  await expect(page.getByRole("heading", { name: "Task IDs" })).toBeFocused();
  await expect(nav.locator("[aria-current='true']")).toHaveText("Task IDs");
  await page.goBack();
  await expect(page).toHaveURL(`${APP}/settings`);
  await page.goBack();
  await expect(h1(page)).toHaveText(A);
  expect(path(page)).toBe(prUrl);

  // Edit profile… opens the profile URL. Back returns to the PR.
  await page.locator("#review-btn-menu").click();
  await page.getByRole("menuitem", { name: /^Edit profile…/ }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/profiles\/[^/]+$/);
  await page.goBack();
  await expect(h1(page)).toHaveText(A);

  // Close replaces the settings entry, so Back goes to the entry before Settings.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(`${APP}/settings`);
  await page.keyboard.press("Escape");
  await expect(h1(page)).toHaveText(A);
  expect(path(page)).toBe(prUrl);
});

test("narrow: the detail has its own entry; Esc and Back to the list go back; a link in a new tab has a list to go back to", async ({
  page,
}) => {
  await connect(page);
  await page.setViewportSize({ width: 400, height: 860 });
  const list = page.locator(".rl-list");
  const detail = page.locator(".rl-detail");
  await expect(list).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/needs");

  await row(page, A).click();
  await expect(detail).toBeVisible();
  await expect(list).toBeHidden();
  await expect.poll(() => new URL(page.url()).pathname).toBe(A_PATH);
  await page.keyboard.press("Escape");
  await expect(list).toBeVisible();
  await expect(detail).toBeHidden();
  expect(new URL(page.url()).pathname).toBe("/needs");
  await expect(row(page, A)).toBeFocused();

  await row(page, A).click();
  await expect(detail).toBeVisible();
  await page.getByRole("button", { name: "Back to the list" }).click();
  await expect(list).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/needs");
  await page.goForward();
  await expect(detail).toBeVisible();
  await expect(h1(page)).toHaveText(A);

  // A deep link has no earlier entry of the app. Esc then shows the list and replaces the entry.
  await page.goto(A_PATH);
  await expect(detail).toBeVisible();
  await expect(h1(page)).toHaveText(A);
  await page.keyboard.press("Escape");
  await expect(list).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/needs");
});

test("a reload or a deep link shows the same place; an unknown view and a gone PR fall back without a blank page", async ({
  page,
  seen,
}) => {
  await connect(page);
  await row(page, A).click();
  await expect(h1(page)).toHaveText(A);
  await page.locator("#th-1000003").click();
  await expect(page).toHaveURL(/thread=1000003/);
  const top = await pane(page).evaluate((el) => {
    el.scrollTop = Math.min(80, el.scrollHeight - el.clientHeight);
    return el.scrollTop;
  });
  expect(top).toBeGreaterThan(20);
  await page.waitForTimeout(300);
  await page.reload();
  await expect(h1(page)).toHaveText(A);
  await expect(page.locator("#th-1000003")).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => pane(page).evaluate((el) => Math.round(el.scrollTop))).toBe(Math.round(top));

  // A deep link in a new tab: the thread opens and takes the focus.
  const tab = await page.context().newPage();
  await tab.goto(`${A_PATH}?thread=1000003`);
  await expect(h1(tab)).toHaveText(A);
  await expect(tab.locator("#t-1000003")).toBeFocused();
  await tab.close();

  // A PR outside the view stays shown, and the list keeps it.
  await page.goto("/mine/PROJ1/sample-repo-3/77");
  await expect(h1(page)).toHaveText(C);
  await expect(row(page, C)).toHaveAttribute("aria-current", "true");
  await expect(page.locator("[data-row]")).toHaveCount(1);

  // An unknown view gives Needs you.
  await page.goto("/inbox/x");
  await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/needs/);
  await expect(page.locator("[data-row]").first()).toBeVisible();

  // A gone PR: the detail says so, and no other PR opens or turns read.
  const reads = seen.reads.length;
  await page.goto("/needs/PROJ1/sample-repo-2/999");
  await expect(page.getByRole("heading", { name: "Cannot find this pull request" })).toBeVisible();
  await expect(page.locator("section[aria-label='Details']")).toContainText("PROJ1/sample-repo-2 #999");
  await page.waitForTimeout(1500);
  expect(seen.reads.slice(reads)).toEqual([]);
  expect(new URL(page.url()).pathname).toBe("/needs/PROJ1/sample-repo-2/999");
  // A click on a row leaves the stale link.
  await row(page, A).click();
  await expect(h1(page)).toHaveText(A);
});
