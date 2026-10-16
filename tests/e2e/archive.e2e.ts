// Archive view: an archived or unfollowed PR stays reachable after its toast closes, opens there, and Restore brings it back.
// Runs against serve.ts only: the fake Bitbucket and its fixture data.
import { type APIRequestContext, test as base, expect, type Page } from "@playwright/test";
import { APP_PORT, control, E2E_TOKEN, FAKE_URL, openApp } from "./control";

const APP = `http://127.0.0.1:${APP_PORT}`;
// PR 1001: a review request on the dashboard.
const A = "Batch cache writes in the sync worker";
// PR 210: on the dashboard.
const B = "Show build status on the release page";
// PR 77: merge "merged" takes it off the dashboard as MERGED. It stays followed.
const C = "Drop the legacy export endpoint";
// Base UI closes a toast after 5 s.
const TOAST_GONE_MS = 15_000;

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

const row = (page: Page, title: string) => page.locator("[data-row]", { hasText: title });
const nav = (page: Page, view: string) => page.locator(`#nav-${view}`);
const detail = (page: Page) => page.locator("section[aria-label='Details']");
const notice = (page: Page) => detail(page).locator("[data-archive-notice]");
const toast = (page: Page, text: string) => page.locator("[data-slot='toast']", { hasText: text });

type Row = { id: number; title: string; followed: boolean; archivedAt: number | null };
const listed = async (request: APIRequestContext, path: "prs" | "archive", title: string) =>
  ((await (await request.get(`${APP}/api/${path}`)).json()) as Row[]).find((p) => p.title === title);

async function connect(page: Page) {
  await openApp(page);
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", {});
  await expect(row(page, A)).toBeVisible();
}

test("an archived PR waits in Archive after its toast closes, opens there, and Unarchive puts it back in its views", async ({
  page,
  request,
}) => {
  await connect(page);
  await nav(page, "archive").click();
  await expect(page.locator("#view-name")).toHaveText("Archive");
  await expect(detail(page).getByText("Nothing is archived")).toBeVisible();
  await expect(page.locator("#rows")).toContainText("Nothing is archived.");

  await nav(page, "needs").click();
  await row(page, A).click();
  await expect(detail(page).locator("h1")).toHaveText(A);
  await detail(page).getByRole("button", { name: "Archive", exact: true }).click();
  await expect(toast(page, "It moved to Archive. Restore it there at any time.")).toBeVisible();
  // The user misses the Undo.
  await expect(page.locator("[data-slot='toast']")).toHaveCount(0, { timeout: TOAST_GONE_MS });
  await expect(row(page, A)).toHaveCount(0);
  expect(await listed(request, "prs", A)).toBeUndefined();
  await nav(page, "following").click();
  await expect(row(page, B)).toBeVisible();
  await expect(row(page, A)).toHaveCount(0);

  await nav(page, "archive").click();
  await expect(row(page, A)).toContainText("Archived just now.");
  await expect(row(page, A)).toContainText("Not checked while archived.");
  expect(await listed(request, "archive", A)).toMatchObject({ followed: true, archivedAt: expect.any(Number) });
  await row(page, A).click();
  await expect(detail(page).locator("h1")).toHaveText(A);
  await expect(notice(page)).toContainText("Archived just now");
  await expect(notice(page)).toContainText("Review Loop does not check it while it is archived.");
  // The detail renders as in any view. The notice holds the one action.
  await expect(detail(page).locator("[data-thread]").first()).toBeVisible();
  await expect(detail(page).getByRole("button", { name: "Archive", exact: true })).toHaveCount(0);
  await expect(detail(page).getByRole("button", { name: "Follow", exact: true })).toHaveCount(0);

  await notice(page).getByRole("button", { name: "Unarchive" }).click();
  await expect(toast(page, "It is back in Following.")).toContainText("Unarchived");
  await expect(row(page, A)).toHaveCount(0);
  await expect(detail(page).getByText("Nothing is archived")).toBeVisible();
  expect(await listed(request, "archive", A)).toBeUndefined();
  await nav(page, "needs").click();
  await expect(row(page, A)).toBeVisible();
  expect(await listed(request, "prs", A)).toMatchObject({ followed: true, archivedAt: null });
});

test("unfollow offers Undo; an unfollowed PR off the dashboard waits in Archive, where j, k, and Enter work and Restore follows it again", async ({
  page,
  request,
}) => {
  await connect(page);
  await row(page, A).click();
  const star = detail(page).getByRole("button", { name: "Follow", exact: true });
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await star.click();
  // A stays on the dashboard, so it stays in Reviewing.
  const unfollowed = toast(page, "It stays in Reviewing while it is on your dashboard. Then it moves to Archive.");
  await expect(unfollowed).toContainText("Stopped following");
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await unfollowed.getByRole("button", { name: "Undo" }).click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  expect(await listed(request, "prs", A)).toMatchObject({ followed: true });

  await control("state", { merge: "merged" });
  await nav(page, "following").click();
  // The same check marks C merged and takes it off the dashboard.
  await expect(row(page, C)).toContainText("Merged.");
  await row(page, C).click();
  await expect(detail(page).locator("h1")).toHaveText(C);
  await detail(page).getByRole("button", { name: "Follow", exact: true }).click();
  await expect(toast(page, "It moved to Archive. Restore it there at any time.")).toContainText("Stopped following");
  await expect(row(page, C)).toHaveCount(0);
  await row(page, B).click();
  await detail(page).getByRole("button", { name: "Archive", exact: true }).click();
  await expect(row(page, B)).toHaveCount(0);

  await nav(page, "archive").click();
  await expect(row(page, C)).toContainText("Merged.");
  await expect(row(page, C)).toContainText("Not followed.");
  await expect(row(page, B)).toContainText("Archived just now.");
  const ids = await page.locator("#rows [data-row]").evaluateAll((els) => els.map((e) => e.id));
  expect(ids).toHaveLength(2);
  const at = (i: number) => page.locator(`#${ids[i]}`);
  await page.keyboard.press("j");
  await expect(at(1)).toBeFocused();
  await expect(at(1)).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("k");
  await expect(at(0)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(notice(page)).toBeVisible();
  await expect.poll(() => detail(page).evaluate((e) => e.contains(document.activeElement))).toBe(true);

  // The row button of C restores it. C is not followed, so the action is Restore.
  await page
    .locator("li", { has: row(page, C) })
    .getByRole("button", { name: /^Restore / })
    .click();
  await expect(toast(page, "It is back in Following.")).toContainText("Restored");
  await expect(row(page, C)).toHaveCount(0);
  await expect(row(page, B)).toBeVisible();
  await expect.poll(async () => (await listed(request, "prs", C))?.followed).toBe(true);
  await nav(page, "following").click();
  await expect(row(page, C)).toContainText("Merged.");
});
