// Forge data in the browser (plan v3 WP4, WP13b): the excerpt, the task mark, Files, Commits, and the comment link.
// Runs against serve.ts only: the fake Bitbucket replays the Gate v3 fixtures of PR 77.
import { test as base, expect, type Page } from "@playwright/test";
import { APP_PORT, control, E2E_TOKEN, FAKE_URL, openApp } from "./control";

const APP = `http://127.0.0.1:${APP_PORT}`;
const TITLE = "Drop the legacy export endpoint";
const PR_LINK = `${FAKE_URL}/projects/PROJ1/repos/sample-repo-3/pull-requests/77`;

const test = base.extend<{ seen: { urls: string[] } }>({
  seen: [
    async ({ context }, use) => {
      const seen = { urls: [] as string[] };
      context.on("request", (r) => seen.urls.push(r.url()));
      await control("reset");
      await use(seen);
      // A link is only an href. The page sends requests to the local app only.
      expect(seen.urls.filter((u) => !u.startsWith(`${APP}/`))).toEqual([]);
    },
    { auto: true },
  ],
});

async function connect(page: Page) {
  await openApp(page);
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", { forge: true });
  // PR 77 has nothing unread, so it shows under Reviewing, not under Needs you.
  await page.locator("nav[aria-label='Views']").getByRole("button", { name: "Reviewing" }).first().click();
  await page.locator("[data-row]", { hasText: TITLE }).first().click();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(TITLE);
}

test("an inline thread shows its excerpt and its link; the task, Files, and Commits show", async ({ page }) => {
  await connect(page);

  // Gate v3 U4: the CONTEXT anchor `line 7` is old line 7, new line 9. The excerpt splits after the commented line.
  const t = page.locator("#t-1000005");
  await t.locator("#th-1000005").click();
  await expect(t.getByRole("figure", { name: "Code at sample1.md line 9" })).toContainText("sample line 36");
  await expect(t.getByRole("link", { name: "Open this thread in Bitbucket" })).toHaveAttribute(
    "href",
    `${PR_LINK}/overview?commentId=1000005`,
  );
  // U16: the reply and the reply to it carry a copy of the anchor, but stay in this thread.
  await expect(t.locator("#c-1000006")).toBeVisible();
  await expect(t.locator("#c-1000007")).toBeVisible();
  await expect(page.locator("#t-1000006, #t-1000007")).toHaveCount(0);
  // A closed thread has no link.
  await expect(page.locator("#t-1000004").getByRole("link")).toHaveCount(0);

  // U14: the resolved BLOCKER task.
  await expect(page.locator("#t-1000008 [data-task='done']")).toHaveText("Resolved task");

  await page.keyboard.press("g");
  await page.keyboard.press("f");
  await expect(page.locator("#s-files")).toHaveAttribute("open", "");
  // Plan r2 UI-DIFF: the forge list shows until a click gets the code. Plan pr-view-v4 P6: each row is the button that gets it.
  const row = page.locator("#s-files").getByRole("list", { name: "Changed files" }).locator("button[aria-expanded]");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("sample1.md");
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#s-files").getByRole("button", { name: "Get the code now" })).toBeVisible();
  // The fake git remote has no sample1.md in this diff. The focus then goes to the first file of the git list.
  await row.click();
  await expect(page.locator("#df-0")).toBeFocused();
  await expect(page.locator("#df-0")).toContainText("src/cache/flush.ts");
  await expect(page.locator("p[role='status'].sr-only")).toHaveText("Got the code. 1 changed file. sample1.md is not in the diff.");
  await page.keyboard.press("g");
  await page.keyboard.press("c");
  await expect(page.locator("#s-commits")).toHaveAttribute("open", "");
  await expect(page.locator("#s-commits")).toContainText("Sample commit 14.");
  await expect(page.locator("#s-commits")).toContainText("ba939ff");
});
