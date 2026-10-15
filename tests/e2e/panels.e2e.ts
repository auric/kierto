// Plan pr-view-v4 P2: the list splitter, the sidebar rail (decision D4), and full width (decision D5).
// Runs against serve.ts only: the fake Bitbucket, a temp git remote, and the fake Claude Code CLI.
import { test as base, expect, type Page } from "@playwright/test";
import { APP_PORT, control, E2E_TOKEN, FAKE_URL } from "./control";

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

async function connect(page: Page, w: number) {
  await page.setViewportSize({ width: w, height: 800 });
  await page.goto("/");
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
  await page.goto("/needs");
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

test("the narrow layout ignores z and shows one pane", async ({ page }) => {
  await connect(page, 400);
  await row(page, A).click();
  await expect(detail(page).locator("h1")).toHaveText(A);
  await page.keyboard.press("z");
  await expect(detail(page)).toBeVisible();
  expect(search(page)).toBe("");
  await expect(split(page)).toBeHidden();
});
