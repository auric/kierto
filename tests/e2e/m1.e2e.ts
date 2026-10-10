// M1 browser acceptance (plan G8, BRIEF section 6). Runs against the fake Bitbucket of serve.ts only.
import { type APIRequestContext, test as base, expect, type Page } from "@playwright/test";
import { APP_PORT, control, E2E_TOKEN, FAKE_URL } from "./control";

const APP = `http://127.0.0.1:${APP_PORT}`;
const TITLE = {
  a: "Batch cache writes in the sync worker",
  b: "Show build status on the release page",
  c: "Drop the legacy export endpoint",
};

type Note = { title: string; body?: string; tag?: string };
type Win = { __notes: (Note & { click(): void })[] };

const test = base.extend<{ permission: "granted" | "denied"; seen: { urls: string[]; logs: string[] } }>({
  permission: ["granted", { option: true }],
  seen: [
    async ({ context, permission }, use) => {
      // Headless Chromium reports "denied". A recorder replaces the Notification API.
      if (permission === "granted") await context.grantPermissions(["notifications"]);
      await context.addInitScript((p) => {
        const w = window as unknown as Win;
        w.__notes = [];
        class Recorder {
          static permission = p;
          static requestPermission = async () => p;
          onclick: (() => void) | null = null;
          constructor(title: string, opts: NotificationOptions = {}) {
            w.__notes.push({ title, body: opts.body, tag: opts.tag, click: () => this.onclick?.() });
          }
          close() {}
        }
        Object.defineProperty(window, "Notification", { value: Recorder, configurable: true, writable: true });
      }, permission);
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

const row = (page: Page, title: string) => page.locator("[data-row]", { hasText: title });
const notes = (page: Page) => page.evaluate(() => (window as unknown as Win).__notes.map(({ title, body, tag }) => ({ title, body, tag })));
const nav = (page: Page, view: string) => page.locator("nav[aria-label='Views']").getByRole("button", { name: view, exact: false }).first();
const detailTitle = (page: Page) => page.locator("section[aria-label='Details'] h1");

async function prRow(request: APIRequestContext, title: string) {
  const rows = (await (await request.get(`${APP}/api/prs`)).json()) as {
    id: number;
    title: string;
    unread: number;
    state: string;
    followed: boolean;
  }[];
  const hit = rows.find((p) => p.title === title);
  if (!hit) throw new Error(`no row ${title}`);
  return hit;
}

async function unreadIds(request: APIRequestContext, title: string) {
  const { id } = await prRow(request, title);
  const detail = (await (await request.get(`${APP}/api/prs/${id}`)).json()) as { comments: { id: number; unread: boolean }[] };
  return detail.comments.filter((c) => c.unread).map((c) => c.id);
}

// US9 in the browser: the URL and the token go through the settings screen. Then the first check imports silently.
async function connect(page: Page, notify = true) {
  await page.goto("/");
  await expect(page.getByText("Connect Review Loop to your Bitbucket Server.")).toBeVisible();
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", {});
  await expect(row(page, TITLE.a)).toBeVisible();
  await expect(page).toHaveTitle("Review Loop");
  // The token is never in the page or in localStorage.
  expect(await page.content()).not.toContain(E2E_TOKEN);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(E2E_TOKEN);
  if (notify) {
    await page.getByRole("button", { name: "Settings" }).click();
    const toggle = page.getByLabel("Show a desktop notification for new activity");
    await toggle.click();
    await expect(toggle).toBeChecked();
    await page.getByRole("button", { name: "Cancel" }).click();
  }
}

// Shows a PR without unread messages in the detail pane, so the tested PR stays unread.
async function park(page: Page, title = TITLE.c) {
  await nav(page, "Reviewing").click();
  await row(page, title).click();
  await expect(detailTitle(page)).toHaveText(title);
}

test("A1: a reply is one unread event in the right thread and stays unread after a restart", async ({ page, request }) => {
  await connect(page);
  await park(page);
  await control("state", { reply: "new" });
  await expect(row(page, TITLE.a)).toContainText("1 new");
  await expect(page).toHaveTitle("(1) Review Loop");
  await expect.poll(() => notes(page)).toEqual([expect.objectContaining({ tag: "PROJ1/sample-repo-2 #1001" })]);

  await control("restart");
  expect(await unreadIds(request, TITLE.a)).toEqual([1000010]);
  await page.reload();
  // Needs you opens the PR first. The highlight keeps the state at open.
  const reply = page.locator("#c-1000010");
  await expect(detailTitle(page)).toHaveText(TITLE.a);
  await expect(reply).toHaveAttribute("data-new", "true");
  await expect(page.locator("li", { has: page.locator("#c-1000003") }).locator("#c-1000010")).toHaveCount(1);
  await expect.poll(() => unreadIds(request, TITLE.a)).toEqual([]);
});

test("A2: a message below the viewport stays unread; the scroll position stays when events arrive", async ({ page, request }) => {
  await connect(page);
  await park(page);
  await control("state", { tall: 6 });
  await expect(row(page, TITLE.b)).toContainText("7 new");
  await row(page, TITLE.b).click();
  await expect(page.locator("#c-2000000")).toBeVisible();
  // A new message arrives while the first ones are read.
  await control("state", { tall: 7 });
  await expect(page.locator("#c-2000007")).toHaveAttribute("data-new", "true");
  await expect.poll(() => unreadIds(request, TITLE.b)).not.toContain(2000000);
  // Longer than the 1 s ack batch plus one retry window.
  await page.waitForTimeout(2500);
  const left = await unreadIds(request, TITLE.b);
  expect(left).toContain(2000006);
  expect(left).toContain(2000007);

  const pane = page.locator("[data-scroll]");
  await pane.evaluate((el) => el.scrollTo({ top: 400 }));
  const before = await pane.evaluate((el) => el.scrollTop);
  const listBefore = await page.locator("#rows").evaluate((el) => el.scrollTop);
  await control("state", { tall: 8 });
  await expect(page.locator("#c-2000008")).toBeAttached();
  expect(await pane.evaluate((el) => el.scrollTop)).toBe(before);
  expect(await page.locator("#rows").evaluate((el) => el.scrollTop)).toBe(listBefore);
});

test("A2: a visible message edited before its ack is read at the new version", async ({ page, request }) => {
  await connect(page);
  await park(page);
  await control("state", { reply: "new" });
  await expect(row(page, TITLE.a)).toContainText("1 new");
  // Holds the first ack, so the edit lands while the message is still unread on screen.
  let release = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  let first = true;
  const sent = new Promise<void>((resolve) =>
    page.route("**/api/read", async (route) => {
      if (!first) return route.continue();
      first = false;
      resolve();
      await held;
      await route.continue();
    }),
  );
  await row(page, TITLE.a).click();
  await expect(page.locator("#c-1000010")).toBeVisible();
  await sent;
  await control("state", { reply: "edit" });
  await expect(page.locator("#c-1000010")).toContainText("Edited: the flush order is fixed now.");
  release();
  await expect.poll(() => unreadIds(request, TITLE.a)).toEqual([]);
});

test("A3, A4, A5: duplicates, edit, delete after the 404, multi-page data, and a visible gap", async ({ page, request }) => {
  await connect(page);
  await park(page);
  await control("state", { reply: "dup" });
  await expect(row(page, TITLE.a)).toContainText("1 new");
  await expect(row(page, TITLE.a)).toHaveCount(1);
  await expect.poll(() => notes(page)).toHaveLength(1);
  await row(page, TITLE.a).click();
  // Activities come one per page. Every message of every page is there once.
  for (const id of [1000003, 1000001, 1000010]) await expect(page.locator(`#c-${id}`)).toHaveCount(1);
  await expect.poll(() => unreadIds(request, TITLE.a)).toEqual([]);

  // A4: an edit is unread again, with the new text, and gives no notification.
  await park(page);
  await control("state", { reply: "edit" });
  await expect(row(page, TITLE.a)).toContainText("1 new");
  await row(page, TITLE.a).click();
  await expect(page.locator("#c-1000010")).toContainText("Edited: the flush order is fixed now.");
  await expect(page.locator("#c-1000010")).toHaveAttribute("data-new", "true");
  expect(await notes(page)).toHaveLength(1);

  // Absent from the activities, but Bitbucket still has it: a gap, not a delete (A5).
  await control("state", { reply: "absent" });
  const panel = page.locator("#panel-activity");
  await expect(panel.getByText("Last check incomplete", { exact: true })).toBeVisible();
  await expect(panel.getByText("a comment is missing from the activities")).toBeVisible();
  await expect(row(page, TITLE.a)).toContainText("Incomplete");
  await expect(page.locator("#c-1000010")).toContainText("Edited: the flush order is fixed now.");

  // The 404 confirms the delete.
  await control("state", { reply: "deleted" });
  await expect(page.locator("#c-1000010")).toContainText("Deleted on Bitbucket");
  await expect(page.locator("#c-1000010")).not.toContainText("Edited");
  await expect(panel.getByText("Last check incomplete", { exact: true })).toBeHidden();
});

test("A6: Bitbucket goes down mid-page: offline state, nothing deleted, then recovery", async ({ page }) => {
  await connect(page);
  await control("state", { down: true });
  await expect(page.getByText(/^Offline\. Last checked \d\d:\d\d\./).first()).toBeVisible();
  await nav(page, "Reviewing").click();
  for (const t of Object.values(TITLE)) await expect(row(page, t)).toBeVisible();
  await row(page, TITLE.a).click();
  await expect(page.locator("#c-1000003")).toHaveCount(1);
  await expect(page.getByText("Deleted on Bitbucket")).toHaveCount(0);

  await control("state", { down: false });
  await expect(page.getByText(/^Offline\./)).toHaveCount(0);
  await expect(page.getByText(/^Checked \d\d:\d\d$/).first()).toBeAttached();
  for (const t of Object.values(TITLE)) await expect(row(page, t)).toBeVisible();
});

test("A14: two pages get one notification; read in one page updates the other; a click opens the PR", async ({ page, context }) => {
  await connect(page);
  const other = await context.newPage();
  const claimed = other.waitForResponse((r) => r.url().endsWith("/api/notifications/claim"));
  await other.goto("/");
  await claimed;
  for (const p of [page, other]) await park(p);

  await control("state", { reply: "new" });
  for (const p of [page, other]) await expect(row(p, TITLE.a)).toContainText("1 new");
  const count = async () => (await notes(page)).length + (await notes(other)).length;
  await expect.poll(count).toBe(1);
  await page.waitForTimeout(1500);
  expect(await count()).toBe(1);

  const [clicker, watcher] = (await notes(page)).length ? [page, other] : [other, page];
  await clicker.evaluate(() => (window as unknown as Win).__notes[0]?.click());
  await expect(detailTitle(clicker)).toHaveText(TITLE.a);
  await expect(nav(clicker, "Needs you")).toHaveAttribute("aria-current", "page");
  await expect(row(watcher, TITLE.a)).not.toContainText("1 new");
});

test("A15: a merge leaves Reviewing, stays in Needs you while unread, and stays followed", async ({ page, request }) => {
  await connect(page);
  await park(page, TITLE.b);
  await control("state", { merge: "reply" });
  await expect(row(page, TITLE.c)).toContainText("1 new");
  await control("state", { merge: "merged" });
  await expect(row(page, TITLE.c)).toHaveCount(0);
  expect(await prRow(request, TITLE.c)).toMatchObject({ state: "MERGED", unread: 1, followed: true });

  await nav(page, "Needs you").click();
  await expect(row(page, TITLE.c)).toContainText("Merged");
  await expect(row(page, TITLE.c)).toContainText("1 new");
  // Needs you shows it first, so it gets read and then leaves Needs you. Following keeps it.
  await expect(row(page, TITLE.c)).toHaveCount(0);
  await nav(page, "Following").click();
  await expect(row(page, TITLE.c)).toContainText("Merged");
});

test.describe("denied notifications", () => {
  test.use({ permission: "denied" });
  test("a denied permission does not block the inbox", async ({ page }) => {
    await connect(page, false);
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByText("This browser blocks notifications for Review Loop.")).toBeVisible();
    const toggle = page.getByLabel("Show a desktop notification for new activity");
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await page.getByRole("button", { name: "Cancel" }).click();
    await park(page);
    await control("state", { reply: "new" });
    await expect(row(page, TITLE.a)).toContainText("1 new");
    await page.waitForTimeout(1500);
    expect(await notes(page)).toEqual([]);
  });
});

test("keys j, k, Enter, Esc, /, n, and ? work", async ({ page }) => {
  await connect(page, false);
  await nav(page, "Reviewing").click();
  const rows = page.locator("[data-row]");
  await expect(rows).toHaveCount(3);
  const ids = await rows.evaluateAll((els) => els.map((e) => e.id));
  const current = page.locator("[data-row][aria-current='true']");

  await rows.nth(0).click();
  await page.keyboard.press("j");
  await expect(current).toHaveId(String(ids[1]));
  await page.keyboard.press("k");
  await expect(current).toHaveId(String(ids[0]));

  await page.keyboard.press("Enter");
  await expect(page.locator("section[aria-label='Details']")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(current).toBeFocused();

  await page.keyboard.press("/");
  const filter = page.getByLabel("Filter the list");
  await expect(filter).toBeFocused();
  await page.keyboard.type("export");
  await expect(rows).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(filter).not.toBeFocused();
  await filter.fill("");
  await expect(rows).toHaveCount(3);

  // The selection is PR 77 now, so PR 210 opens with all 4 new messages.
  await control("state", { tall: 3 });
  await row(page, TITLE.b).click();
  await expect(page.locator("[data-new]")).toHaveCount(4);
  await page.keyboard.press("n");
  await expect(page.locator("#c-2000000")).toBeFocused();
  await page.keyboard.press("n");
  await expect(page.locator("#c-2000001")).toBeFocused();

  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
