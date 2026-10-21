// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Out-of-date draft alerts (docs/plans/thread-outcome.md section 11): the inbox badge, the outcome marker, and one notification per
// sync. The fake Bitbucket cannot turn a stored anchor orphaned, so Code changed has unit tests only (tests/web/outcome.test.ts).
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { control, E2E_TOKEN, FAKE_URL, openApp, posts } from "./control";

const TITLE = "Batch cache writes in the sync worker";
const KEY = "PROJ1/sample-repo-2 #1001";
const RUN_MS = 60_000;
// reply "new": Alex answers in the general thread 1000003 with 1000010.
const ROOT = 1000003;
const echo = (msg: number) => `Thanks. I checked message ${msg} against flush() and will change it.`;

type Note = { title: string; body?: string; tag?: string };
type Win = { __notes: Note[] };

// Headless Chromium denies notifications. A recorder replaces the Notification API.
const test = base.extend<{ notes: () => Promise<Note[]> }>({
  notes: async ({ context, page }, use) => {
    await context.grantPermissions(["notifications"]);
    await context.addInitScript(() => {
      const w = window as unknown as Win;
      w.__notes = [];
      class Recorder {
        static permission = "granted";
        static requestPermission = async () => "granted";
        onclick: (() => void) | null = null;
        constructor(title: string, opts: NotificationOptions = {}) {
          w.__notes.push({ title, body: opts.body, tag: opts.tag });
        }
        close() {}
      }
      Object.defineProperty(window, "Notification", { value: Recorder, configurable: true, writable: true });
    });
    await control("reset");
    await use(() => page.evaluate(() => [...(window as unknown as Win).__notes]));
  },
});

const row = (page: Page) => page.locator("[data-row]", { hasText: TITLE }).first();
const staleBadge = (page: Page) => row(page).locator("[data-stale-drafts]");
const thread = (page: Page, id: number) => page.locator(`#t-${id}`);
const card = (page: Page, id: number) => thread(page, id).locator("[data-reply-draft]");
const markers = (page: Page, id: number) => thread(page, id).locator("[data-outcome] [data-marker]");
const staleNotes = async (notes: () => Promise<Note[]>) => (await notes()).filter((n) => n.body?.includes("out of date"));

async function connect(page: Page) {
  await openApp(page);
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", {});
  await page.getByRole("button", { name: "Settings" }).click();
  const toggle = page.getByLabel("Show a desktop notification for new activity");
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.getByRole("button", { name: "Cancel" }).click();
  await row(page).click();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(TITLE);
}

// A sync can open or close the thread between the read and the click, so the click repeats until the thread stays open.
async function openThread(page: Page, id: number) {
  const head = page.locator(`#th-${id}`);
  await expect(async () => {
    if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
  }).toPass();
}

async function hint(page: Page, trigger: Locator) {
  await trigger.hover();
  return page.locator("[data-slot='tooltip-content']");
}

test("an accepted draft that goes out of date: the row badge, the marker, and one joined notification; a resolve after the draft: the badge and the marker", async ({
  page,
  notes,
}) => {
  await connect(page);
  await control("state", { reply: "new" });
  await page.locator("#replies-btn").click();
  await expect(card(page, ROOT)).toContainText(echo(1000010), { timeout: RUN_MS });
  await card(page, ROOT).getByRole("button", { name: "Accept" }).click();
  await expect(card(page, ROOT)).toContainText("Accepted");
  await expect(markers(page, ROOT)).toHaveCount(0);
  await expect(staleBadge(page)).toHaveCount(0);

  // Alex answers again. The same sync gives the comment event and the draft_stale event, so one notification names both.
  await posts({ answer: { parent: 1000010, text: "Also keep the flush order for the retries." } });
  await control("state", {});
  await expect(staleBadge(page)).toHaveText("1 reply draft out of date");
  await expect(staleBadge(page).locator("svg")).toHaveAttribute("aria-hidden", "true");
  await expect(await hint(page, staleBadge(page))).toHaveText("Open the pull request to update them.");
  await expect
    .poll(() => staleNotes(notes))
    .toEqual([{ title: TITLE, body: `${KEY}: 1 new comment, 1 reply draft out of date`, tag: KEY }]);
  await openThread(page, ROOT);
  await expect(markers(page, ROOT)).toHaveText(["Out of date"]);
  await expect(card(page, ROOT)).toContainText("New messages since this draft.");
  await expect(card(page, ROOT).locator("[data-code-changed]")).toHaveCount(0);

  // Reply to the newest as is answers the newest message. The badge goes with the next PR list.
  await card(page, ROOT).getByRole("button", { name: "Reply to the newest as is" }).click();
  await expect(card(page, ROOT)).not.toContainText("New messages since this draft.");
  await expect(markers(page, ROOT)).toHaveCount(0);
  await expect(staleBadge(page)).toHaveCount(0);

  // The thread is resolved on Bitbucket. The fake names the token owner as the resolver, so the badge and the marker show, but my
  // own resolve gives no notification.
  await posts({ resolve: ROOT });
  await control("state", {});
  await expect(staleBadge(page)).toHaveText("1 reply draft out of date");
  await page.getByRole("button", { name: /^Show \d+ resolved$/ }).click();
  await openThread(page, ROOT);
  await expect(markers(page, ROOT)).toHaveText(["Resolved since the draft"]);
  // A sync without changes gives no notification either.
  await control("state", {});
  expect(await staleNotes(notes)).toHaveLength(1);
});
