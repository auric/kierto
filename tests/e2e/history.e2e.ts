// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Thread history (docs/plans/thread-outcome.md section 10): More opens the section under the thread footer, its lines refresh with a
// live change, the AI line opens its run log, and Hide history and Esc give the focus back to More.
// Runs against serve.ts only: the fake Bitbucket, a temp git remote, and the fake Claude Code CLI.
import { expect, type Page, test } from "@playwright/test";
import { control, E2E_TOKEN, FAKE_URL, openApp } from "./control";

const TITLE = "Batch cache writes in the sync worker";
const RUN_MS = 60_000;
// turns 1: my general comment 1000101 and the reply 1000201 by Alex Smith.
const T = 1000101;
const NOTE = "Bitbucket keeps no record of reopens or earlier text. Kierto keeps only the time of your last change to a draft.";

const row = (page: Page) => page.locator("[data-row]", { hasText: TITLE }).first();
const thread = (page: Page) => page.locator(`#t-${T}`);
const card = (page: Page) => thread(page).locator("[data-reply-draft]");
const more = (page: Page) => thread(page).getByRole("button", { name: "More for this thread" });
const section = (page: Page) => thread(page).getByRole("region", { name: "Thread history" });
const lines = (page: Page) => section(page).getByRole("listitem");

async function connect(page: Page) {
  await openApp(page);
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", {});
  await row(page).click();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(TITLE);
}

// A sync can open or close the thread between the read and the click, so the click repeats until the thread stays open.
async function openThread(page: Page) {
  const head = page.locator(`#th-${T}`);
  await expect(async () => {
    if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
  }).toPass();
}

async function showHistory(page: Page) {
  await more(page).click();
  await page.getByRole("menuitem", { name: "Show history" }).click();
  await expect(section(page).getByRole("heading", { name: "Thread history" })).toBeFocused();
}

test.beforeEach(async () => {
  await control("reset");
});

test("More opens the thread history; the lines refresh live and link the run log; Hide history and Esc focus More", async ({ page }) => {
  await connect(page);
  await control("state", { turns: 1 });
  await page.locator("#replies-btn").click();
  await expect(page.locator("#runline [data-run-kind='reply']")).toHaveAttribute("data-run-state", "done", { timeout: RUN_MS });
  await openThread(page);
  await expect(card(page)).toContainText("Reply draft to Alex Smith");

  await showHistory(page);
  await expect(lines(page)).toHaveText([/^You started the thread/, /^Alex Smith replied/, /^Claude drafted a reply/]);
  await expect(section(page)).toContainText(NOTE);
  await expect(lines(page).nth(1).locator("time")).toHaveCount(1);

  // The AI line opens its run log. The log gives the focus back on close.
  const log = lines(page).nth(2).getByRole("button", { name: "Run log" });
  await log.click();
  await expect(page.getByRole("dialog", { name: "Reply drafts run log" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Reply drafts run log" })).toHaveCount(0);
  await expect(log).toBeFocused();

  // A live change refreshes the open section.
  await card(page).getByRole("button", { name: "Accept" }).click();
  await expect(card(page)).toContainText("Accepted");
  await expect(lines(page)).toHaveText([
    /^You started the thread/,
    /^Alex Smith replied/,
    /^Claude drafted a reply/,
    /^You accepted the draft/,
  ]);

  // Hide history gives the focus back to More.
  await section(page).getByRole("button", { name: "Hide history" }).click();
  await expect(section(page)).toHaveCount(0);
  await expect(more(page)).toBeFocused();

  // Esc inside the section closes only the section. The detail stays.
  await showHistory(page);
  await page.keyboard.press("Escape");
  await expect(section(page)).toHaveCount(0);
  await expect(more(page)).toBeFocused();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(TITLE);

  // While the section is open, the menu item says Hide history and closes it.
  await showHistory(page);
  await more(page).click();
  await page.getByRole("menuitem", { name: "Hide history" }).click();
  await expect(section(page)).toHaveCount(0);
  await expect(more(page)).toBeFocused();

  // Keys only: Enter opens More, Enter on Show history moves the focus to the heading.
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Show history" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(section(page).getByRole("heading", { name: "Thread history" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(more(page)).toBeFocused();
});

test("a posted draft: the message line names the Kierto draft, and the draft line says Posted", async ({ page }) => {
  await connect(page);
  await control("state", { turns: 1 });
  await page.locator("#replies-btn").click();
  await expect(page.locator("#runline [data-run-kind='reply']")).toHaveAttribute("data-run-state", "done", { timeout: RUN_MS });
  await openThread(page);
  await card(page).getByRole("button", { name: "Accept" }).click();
  await expect(card(page)).toContainText("Accepted");
  await page.keyboard.press("p");
  const box = page.getByRole("dialog", { name: /^Post .* to PROJ1\/sample-repo-2 #1001\?$/ });
  await box.getByRole("button", { name: "Post", exact: true }).click();
  await expect(thread(page).locator("[data-post]")).toContainText("Posted.");
  // The next sync brings the posted comment. My newest message can close the thread, so it opens again.
  await control("state", {});
  await expect(async () => {
    await openThread(page);
    await expect(thread(page).locator("article[data-id]")).toHaveCount(3, { timeout: 1000 });
  }).toPass();
  await showHistory(page);
  await expect(lines(page)).toHaveText([
    /^You started the thread/,
    /^Alex Smith replied/,
    /^Claude drafted a reply/,
    /^You accepted the draft/,
    /^You replied from a Kierto draft/,
  ]);
  await expect(lines(page).nth(2)).toContainText("Posted");
  await expect(lines(page).nth(4).getByRole("button", { name: "Run log" })).toHaveCount(1);
});
