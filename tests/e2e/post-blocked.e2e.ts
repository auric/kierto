// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Thread outcome (docs/plans/thread-outcome.md WP-U2): the confirm groups the drafts that cannot post by reason, refreshes while it is
// open, and offers the thread link and the action of each reason. The post bar and the Ready to post view count them.
import { expect, type Page, test } from "@playwright/test";
import { control, E2E_TOKEN, FAKE_URL, openApp, writes } from "./control";

const TITLE = "Batch cache writes in the sync worker";
const RUN_MS = 60_000;
// reply "new": Alex answers in the general thread 1000003 with 1000010. reply "two" adds 1000011.
const ROOT = 1000003;
const THREAD = /^Thread of .+ in the general comment$/;
const echo = (msg: number) => `Thanks. I checked message ${msg} against flush() and will change it.`;

test.beforeEach(async () => {
  await control("reset");
});

const thread = (page: Page, id: number) => page.locator(`#t-${id}`);
const card = (page: Page, id: number) => thread(page, id).locator("[data-reply-draft]");
const confirmBox = (page: Page) => page.getByRole("dialog", { name: /^Post .*to PROJ1\/sample-repo-2 #1001\?$/ });

async function connect(page: Page) {
  await openApp(page);
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", {});
  await page.locator("[data-row]", { hasText: TITLE }).first().click();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(TITLE);
}

test("an out-of-date draft: the open confirm refreshes into its group, the bar and Ready to post count it, and the thread link and Draft again work", async ({
  page,
}) => {
  await connect(page);
  await control("state", { reply: "new" });
  await page.locator("#replies-btn").click();
  await expect(card(page, ROOT)).toContainText(echo(1000010), { timeout: RUN_MS });
  await card(page, ROOT).getByRole("button", { name: "Accept" }).click();
  await expect(card(page, ROOT)).toContainText("Accepted");
  await expect(page.getByText("Ready to post: 1 reply", { exact: true })).toBeVisible();

  // The confirm shows the reply. A new message arrives while it is open: the reply moves into the Out of date group.
  await page.keyboard.press("p");
  const box = confirmBox(page);
  await expect(box).toHaveAccessibleName("Post 1 reply to PROJ1/sample-repo-2 #1001?");
  await expect(box.getByRole("list", { name: "Comments to post" }).getByRole("listitem")).toHaveCount(1);
  await control("state", { reply: "two" });
  await expect(box).toHaveAccessibleName("Post to PROJ1/sample-repo-2 #1001?");
  await expect(box.getByRole("list", { name: "Comments to post" })).toHaveCount(0);
  const group = box.locator("[data-blocked-group='out-of-date']");
  await expect(group.getByRole("heading")).toHaveText("Out of date (1)");
  await expect(group).toContainText("New messages since the draft. Draft again or edit.");
  const item = group.getByRole("list", { name: "Out of date" }).getByRole("listitem");
  await expect(item).toHaveCount(1);
  await expect(item.getByRole("button", { name: THREAD })).toBeVisible();
  await expect(box.getByRole("button", { name: "Post", exact: true })).toBeDisabled();
  await expect(box.getByRole("alert")).toHaveText("The list changed while it was open. Read it again before you post.");
  await expect(box.getByRole("button", { name: "Cancel" })).toBeFocused();

  // The actions are reachable by keyboard: Shift+Tab goes back from Cancel over the disabled Post to Draft again, then to the thread.
  await page.keyboard.press("Shift+Tab");
  await expect(item.getByRole("button", { name: "Draft again" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(item.getByRole("button", { name: THREAD })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();

  // The bar counts the out-of-date draft. The Ready to post view lists the PR with only a blocked draft.
  await expect(page.getByText("1 draft out of date", { exact: true })).toBeVisible();
  await expect(page.locator("#nav-post")).toHaveAccessibleName("Ready to post: 1");
  await page.locator("#nav-post").click();
  const row = page.locator("[data-row]", { hasText: TITLE }).first();
  await expect(row).toContainText("1 cannot post");
  await expect(row).not.toContainText("Ready:");

  // The thread link closes the confirm and shows the thread.
  await page.locator("#post-btn").click();
  await confirmBox(page).getByRole("button", { name: THREAD }).click();
  await expect(confirmBox(page)).toBeHidden();
  await expect(thread(page, ROOT)).toBeInViewport();
  expect(await page.evaluate((id) => !!document.activeElement?.closest(`#t-${id}`), ROOT)).toBe(true);

  // Draft again answers the newest message. The new draft waits for Accept, so nothing can post or is blocked.
  await page.keyboard.press("p");
  await confirmBox(page).getByRole("button", { name: "Draft again" }).click();
  await expect(confirmBox(page)).toBeHidden();
  await expect(card(page, ROOT)).toContainText(echo(1000011), { timeout: RUN_MS });
  await expect(page.locator("[data-post-part]")).toHaveCount(0);
  expect(await writes()).toEqual([]);
});
