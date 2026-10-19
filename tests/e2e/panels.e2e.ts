// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Plan pr-view-v4 P2: the list splitter, the sidebar rail (decision D4), and full width (decision D5).
// Runs against serve.ts only: the fake Bitbucket, a temp git remote, and the fake Claude Code CLI.
import { test as base, expect, type Page } from "@playwright/test";
import { APP_PORT, control, E2E_TOKEN, FAKE_URL, openApp } from "./control";

const APP = `http://127.0.0.1:${APP_PORT}`;
// PR 1001 of PROJ1/sample-repo-2.
const A = "Batch cache writes in the sync worker";

const test = base.extend<{ seen: string[] }>({
  seen: [
    async ({ context }, use) => {
      const seen: string[] = [];
      context.on("request", (r) => seen.push(r.url()));
      await control("reset");
      await use(seen);
      expect(seen.filter((u) => !u.startsWith(`${APP}/`))).toEqual([]);
    },
    { auto: true },
  ],
});

const side = (page: Page) => page.locator("nav[aria-label='Views']");
const list = (page: Page) => page.locator("section[aria-labelledby='view-name']");
const detail = (page: Page) => page.locator("section[aria-label='Details']");
const split = (page: Page) => page.getByRole("separator", { name: /^List width/ });
const row = (page: Page, title: string) => page.locator("[data-row]", { hasText: title }).first();
const width = async (box: ReturnType<typeof side>) => Math.round((await box.boundingBox())?.width ?? -1);
const search = (page: Page) => new URL(page.url()).search;
const fullBtn = (page: Page) => page.locator("#full-btn");
const tip = (page: Page) => page.locator("[data-slot='tooltip-content']");

async function connect(page: Page, w: number) {
  await page.setViewportSize({ width: w, height: 800 });
  await openApp(page);
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", {});
  await expect(row(page, A)).toBeVisible();
}

test("the splitter resizes the list with the keys, resets on Enter and double-click, and keeps the width after a reload", async ({
  page,
}) => {
  await connect(page, 1440);
  const sep = split(page);
  await expect(sep).toHaveAttribute("aria-valuenow", "368");
  await expect(sep).toHaveAttribute("aria-valuemin", "280");
  await expect(sep).toHaveAttribute("aria-valuemax", "560");
  await expect(sep).toHaveAttribute("aria-controls", "rows");
  expect(await width(list(page))).toBe(368);

  await sep.focus();
  await page.keyboard.press("ArrowRight");
  await expect(sep).toHaveAttribute("aria-valuenow", "384");
  await expect(page.getByRole("status").filter({ hasText: "List width 384 pixels." })).toHaveCount(1);
  await page.keyboard.press("Shift+ArrowRight");
  await expect(sep).toHaveAttribute("aria-valuenow", "448");
  expect(await width(list(page))).toBe(448);
  await page.keyboard.press("ArrowLeft");
  await expect(sep).toHaveAttribute("aria-valuenow", "432");
  // The splitter keeps its keys: ← does not move the focus to the list.
  await expect(sep).toBeFocused();
  await page.keyboard.press("End");
  await expect(sep).toHaveAttribute("aria-valuenow", "560");
  await page.keyboard.press("Home");
  await expect(sep).toHaveAttribute("aria-valuenow", "280");
  expect(await width(list(page))).toBe(280);
  await page.keyboard.press("Enter");
  await expect(sep).toHaveAttribute("aria-valuenow", "368");
  await expect(sep).toBeFocused();

  // A drag keeps the width at the end. The splitter sits on the right edge of the list.
  const box = await sep.boundingBox();
  const listBox = await list(page).boundingBox();
  if (!box || !listBox) throw new Error("no splitter box");
  expect(Math.abs(box.x + box.width / 2 - (listBox.x + listBox.width))).toBeLessThanOrEqual(1);
  await page.mouse.move(box.x + box.width / 2, 300);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, 300, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 + 100, 300, { steps: 4 });
  await page.mouse.up();
  await expect(sep).toHaveAttribute("aria-valuenow", "468");
  expect(await width(list(page))).toBe(468);

  await page.reload();
  await expect(row(page, A)).toBeVisible();
  await expect(split(page)).toHaveAttribute("aria-valuenow", "468");
  expect(await width(list(page))).toBe(468);

  await split(page).dblclick();
  await expect(split(page)).toHaveAttribute("aria-valuenow", "368");
  expect(await width(list(page))).toBe(368);
  await page.reload();
  await expect(row(page, A)).toBeVisible();
  await expect(split(page)).toHaveAttribute("aria-valuenow", "368");
  // Widths are viewer preferences, never part of the URL.
  expect(search(page)).toBe("");
});

test("a saved wide list leaves the detail 560 px in a smaller window and comes back in a wide one", async ({ page }) => {
  await connect(page, 1440);
  const sep = split(page);
  await sep.focus();
  await page.keyboard.press("End");
  await expect(sep).toHaveAttribute("aria-valuenow", "560");
  expect(await width(list(page))).toBe(560);

  // 1100 px gives the rail: 1100 - 60 - 560 leaves 480 px to the list.
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(sep).toHaveAttribute("aria-valuenow", "480");
  await expect(sep).toHaveAttribute("aria-valuemax", "480");
  expect(await width(list(page))).toBe(480);
  expect(await width(detail(page))).toBe(560);

  // A small window keeps the list at 280 px. The detail gets the rest.
  await page.setViewportSize({ width: 800, height: 800 });
  await expect(sep).toHaveAttribute("aria-valuenow", "280");
  expect(await width(detail(page))).toBe(800 - 60 - 280);

  // The guard changes only what renders. The saved width stays, so a wide window shows it again.
  await page.setViewportSize({ width: 1440, height: 800 });
  await expect(sep).toHaveAttribute("aria-valuenow", "560");
  await expect(sep).toHaveAttribute("aria-valuemax", "560");
  expect(await width(list(page))).toBe(560);

  // The keys and the drag stop at the cap. The resize renders the cap before the key.
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(sep).toHaveAttribute("aria-valuemax", "480");
  await sep.focus();
  await page.keyboard.press("ArrowRight");
  await expect(sep).toHaveAttribute("aria-valuenow", "480");
  await expect(page.getByRole("status").filter({ hasText: "List width 480 pixels." })).toHaveCount(1);
  const box = await sep.boundingBox();
  if (!box) throw new Error("no splitter box");
  await page.mouse.move(box.x + box.width / 2, 300);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, 300, { steps: 4 });
  expect(await width(detail(page))).toBe(560);
  await page.mouse.up();
  await expect(sep).toHaveAttribute("aria-valuenow", "480");
  expect(await width(detail(page))).toBe(560);
});

test("below 1440 px the sidebar is a rail; the choice to expand or collapse stays after a reload", async ({ page }) => {
  await connect(page, 1280);
  // Decision D4: a 1280 px window gives the detail 900 px. The rail gives the list 320 px.
  expect(await width(side(page))).toBe(60);
  expect(await width(list(page))).toBe(320);
  expect(await width(detail(page))).toBe(900);
  await expect(side(page).locator("#nav-reviewing")).toHaveAccessibleName(/^Reviewing: \d+$/);
  const toggle = side(page).locator("#nav-rail");
  await expect(toggle).toHaveAccessibleName("Expand sidebar");
  await toggle.hover();
  await expect(page.locator("[data-slot='tooltip-content']")).toHaveText("Expand sidebar");

  await toggle.click();
  expect(await width(side(page))).toBe(228);
  await expect(toggle).toHaveAccessibleName("Collapse sidebar");
  await expect(toggle).toHaveText("Collapse sidebar");
  await expect(side(page).getByRole("heading", { name: "Repositories" })).toBeVisible();
  // The default list width follows the sidebar.
  expect(await width(list(page))).toBe(368);
  await page.reload();
  await expect(row(page, A)).toBeVisible();
  expect(await width(side(page))).toBe(228);

  // A wide window keeps the choice. Collapse then holds at every width.
  await page.setViewportSize({ width: 1920, height: 800 });
  await toggle.click();
  expect(await width(side(page))).toBe(60);
  await page.reload();
  await expect(row(page, A)).toBeVisible();
  expect(await width(side(page))).toBe(60);
  await expect(toggle).toHaveAccessibleName("Expand sidebar");

  // The one pane layout has no rail and no toggle.
  await page.setViewportSize({ width: 400, height: 800 });
  await openApp(page, "/needs");
  await page.getByRole("button", { name: "Open views" }).click();
  await expect(side(page)).toBeVisible();
  await expect(side(page).getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(toggle).toBeHidden();
  await expect(split(page)).toBeHidden();
});

test("z hides the sidebar and the list; Esc, Back, and ← go back to three panes; Esc closes the brief first", async ({ page }) => {
  await connect(page, 1440);
  await row(page, A).click();
  await expect(detail(page).locator("h1")).toHaveText(A);
  await expect.poll(() => search(page)).toBe("");

  // z from the list row turns full width on, with its own history entry.
  const depth = await page.evaluate(() => history.length);
  await row(page, A).focus();
  await page.keyboard.press("z");
  await expect.poll(() => search(page)).toBe("?full=1");
  expect(await page.evaluate(() => history.length)).toBe(depth + 1);
  await expect(side(page)).toBeHidden();
  await expect(list(page)).toBeHidden();
  await expect(split(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Skip to the list" })).toHaveCount(0);
  expect(await width(detail(page))).toBe(1440);
  await expect(detail(page)).toBeFocused();

  // Esc order: the brief, then the tooltip of the Review button that gets the focus back, then full width.
  await page.keyboard.press("Shift+R");
  await expect(page.getByLabel("Your note")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#brief")).toHaveCount(0);
  await expect(page.locator("#review-btn")).toBeFocused();
  const tip = page.locator("[data-slot='tooltip-content']");
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
  expect(search(page)).toBe("?full=1");
  await page.keyboard.press("Escape");
  await expect.poll(() => search(page)).toBe("");
  await expect(side(page)).toBeVisible();
  await expect(list(page)).toBeVisible();
  expect(await width(detail(page))).toBe(1440 - 228 - 368);

  // z twice: on and off. Back leaves full width (decision D5). Forward brings it back.
  await page.keyboard.press("z");
  await expect.poll(() => search(page)).toBe("?full=1");
  await page.keyboard.press("z");
  await expect.poll(() => search(page)).toBe("");
  await page.keyboard.press("z");
  await expect.poll(() => search(page)).toBe("?full=1");
  await page.goBack();
  await expect.poll(() => search(page)).toBe("");
  await expect(list(page)).toBeVisible();
  await expect(detail(page).locator("h1")).toHaveText(A);
  await page.goForward();
  await expect.poll(() => search(page)).toBe("?full=1");
  await expect(list(page)).toBeHidden();

  // A reload keeps full width: it is in the URL.
  await page.reload();
  await expect(detail(page).locator("h1")).toHaveText(A);
  await expect(list(page)).toBeHidden();

  // ← goes back to the list, so the list shows again.
  await detail(page).focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => search(page)).toBe("");
  await expect(page.locator("[data-row][aria-current='true']")).toBeFocused();
});

test("the Full width button in the action bar is pressed in full width, toggles it like z, and Back leaves it", async ({ page }) => {
  await connect(page, 1440);
  await row(page, A).click();
  await expect(detail(page).locator("h1")).toHaveText(A);
  const btn = fullBtn(page);
  await expect(btn).toHaveAccessibleName("Full width");
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await expect(btn).toHaveAttribute("aria-keyshortcuts", "z");
  await btn.hover();
  await expect(tip(page)).toHaveText("Full width. Key: z");
  // It sits between Review and More.
  const [review, full, more] = [
    await page.locator("#review-btn").boundingBox(),
    await btn.boundingBox(),
    await page.locator("#more-btn").boundingBox(),
  ];
  expect((review?.x ?? 0) < (full?.x ?? 0) && (full?.x ?? 0) < (more?.x ?? 0)).toBe(true);

  // A click pushes an entry, like z. The button keeps the focus and shows the pressed state.
  const depth = await page.evaluate(() => history.length);
  await btn.click();
  await expect.poll(() => search(page)).toBe("?full=1");
  expect(await page.evaluate(() => history.length)).toBe(depth + 1);
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await expect(btn).toBeFocused();
  await expect(list(page)).toBeHidden();
  expect(await width(detail(page))).toBe(1440);
  // The click closes the tooltip at once, with no exit animation. The next hover shows the new label.
  await expect(tip(page)).toHaveCount(0);
  await detail(page).locator("h1").hover();
  await btn.hover();
  await expect(tip(page)).toHaveText("Back to three panes. Keys: z or Esc");

  // A second click leaves full width. z turns it on again, and the button follows.
  await btn.click();
  await expect.poll(() => search(page)).toBe("");
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await expect(list(page)).toBeVisible();
  await page.keyboard.press("z");
  await expect.poll(() => search(page)).toBe("?full=1");
  await expect(btn).toHaveAttribute("aria-pressed", "true");

  // Back leaves full width (decision D5). Forward brings it back.
  await page.goBack();
  await expect.poll(() => search(page)).toBe("");
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await expect(list(page)).toBeVisible();
  await page.goForward();
  await expect.poll(() => search(page)).toBe("?full=1");
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await btn.click();
  await expect.poll(() => search(page)).toBe("");
  await page.goBack();
  await expect.poll(() => search(page)).toBe("?full=1");
  await expect(btn).toHaveAttribute("aria-pressed", "true");
});

test("the narrow layout ignores z, shows one pane, and has no Full width button", async ({ page }) => {
  await connect(page, 400);
  await row(page, A).click();
  await expect(detail(page).locator("h1")).toHaveText(A);
  await page.keyboard.press("z");
  await expect(detail(page)).toBeVisible();
  expect(search(page)).toBe("");
  await expect(split(page)).toBeHidden();
  await expect(fullBtn(page)).toBeHidden();
});

test("openApp reloads once when the React chunk fails to load", async ({ page }) => {
  let aborted = 0;
  await page.route(/\/assets\/react-[^/]+\.js$/, (route) => {
    if (aborted++) return route.continue();
    return route.abort("connectionfailed");
  });
  await openApp(page);
  await expect(page.getByLabel("Bitbucket URL")).toBeVisible();
  expect(aborted).toBe(2);
});
