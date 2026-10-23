// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Resolved threads (integration-check.md U56, synthetic): the badge names who resolved the thread and when, in the Threads list and
// in the diff. A resolved card folds to one line and opens on a click or Enter. A deep link opens a resolved thread.
import { expect, type Page, test } from "@playwright/test";
import { control, E2E_TOKEN, FAKE_URL, openApp } from "./control";

const TITLE = "Batch cache writes in the sync worker";
const A_PATH = "/needs/PROJ1/sample-repo-2/1001";
const INLINE = 1000401;
const GENERAL = 1000403;

test.beforeEach(async () => {
  await control("reset");
});

async function connect(page: Page) {
  await openApp(page);
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", { resolved: true });
  // The open detail refetches after the sync. A row open jumps to the cause in the data it has.
  await expect(page.getByRole("button", { name: "Show 2 resolved" })).toBeVisible();
  await page.locator("[data-row]", { hasText: TITLE }).first().click();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(TITLE);
}

test("the resolved badge in the list, the folded card in the diff, and a deep link to a resolved thread", async ({ page }) => {
  await connect(page);

  // The new resolved threads open the Resolved group. Each head names who resolved the thread, open or closed.
  await expect(page.getByRole("heading", { name: "Resolved 2" })).toBeVisible();
  const head = page.locator(`#th-${INLINE}`);
  await expect(head).toHaveAttribute("aria-expanded", "true");
  await expect(head.locator("[data-resolved]")).toHaveText(/^Resolved by Maria · (now|\d+[mhd] ago)$/);
  await expect(page.locator(`#th-${GENERAL} [data-resolved]`)).toHaveText(/^Resolved by you · (now|\d+[mhd] ago)$/);
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await expect(head.locator("[data-resolved]")).toContainText("Resolved by Maria");

  // The diff: the card on new line 3 is one line with the badge, the first author, and the first words.
  await page.keyboard.press("g");
  await page.keyboard.press("f");
  const get = page.locator("#s-files").getByRole("button", { name: "Get the code", exact: true });
  await get.click();
  await expect(page.locator("#df-0")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#dl-0-n3")).toContainText("const lock = cache.lock();");
  const card = page.locator("#dl-0-n3 + .rl-dcard .rl-dc").filter({ hasText: "Resolved by Maria" });
  const toggle = card.locator("button[aria-expanded]");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toContainText("Alex: Rename the lock so that the name says what it guards.");
  await expect(card.getByRole("button", { name: "Go to thread" })).toHaveCount(0);

  // A click opens it: the newest message and Go to thread. Enter folds it again, and the focus stays on the toggle.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(card).toContainText("Maria: Renamed in the next commit.");
  await expect(card.getByRole("button", { name: "Go to thread" })).toBeVisible();
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await card.getByRole("button", { name: "Go to thread" }).click();
  await expect(page.locator(`#t-${INLINE}`)).toBeFocused();

  // A deep link in a new tab opens the resolved thread and focuses it.
  const tab = await page.context().newPage();
  await tab.goto(`${A_PATH}?thread=${GENERAL}`);
  await expect(tab.locator(`#th-${GENERAL}`)).toHaveAttribute("aria-expanded", "true");
  await expect(tab.locator(`#t-${GENERAL}`)).toBeFocused();
  await expect(tab.locator(`#th-${GENERAL} [data-resolved]`)).toContainText("Resolved by you");
  await tab.close();
});
