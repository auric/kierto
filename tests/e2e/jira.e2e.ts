// Plan r2 UI-JIRA browser acceptance: the Jira settings, the task chips of the review brief, and the imported task text.
// Runs against serve.ts only: the fake Bitbucket, the fake Jira on JIRA_URL, and the fake Claude Code CLI.
import { test as base, expect, type Page } from "@playwright/test";
import { APP_PORT, control, E2E_JIRA_TOKEN, E2E_TOKEN, FAKE_URL, JIRA_ISSUE, JIRA_URL } from "./control";

const APP = `http://127.0.0.1:${APP_PORT}`;
const TITLE = "Batch cache writes in the sync worker";
// serve.ts: the PR 1001 description names it with Scenario.task. The fake Jira gives 404 for it.
const MISSING = "ABC-404";
// fixtures/jira/issue.json and comments-p1.json.
const SUMMARY = "Flush the cache before the write lock";

const test = base.extend<{ seen: { urls: string[]; logs: string[] } }>({
  seen: [
    async ({ context }, use) => {
      const seen = { urls: [] as string[], logs: [] as string[] };
      context.on("request", (r) => seen.urls.push(r.url()));
      context.on("console", (m) => seen.logs.push(m.text()));
      context.on("weberror", (e) => seen.logs.push(e.error().message));
      // Chrome logs no console line for some blocked evals. The event reports every violation.
      await context.addInitScript(() =>
        document.addEventListener("securitypolicyviolation", (e) => console.error(`Content Security Policy: ${e.violatedDirective}`)),
      );
      await control("reset");
      await use(seen);
      // Only the local app gets requests. Jira gets them from the server only.
      expect(seen.urls.filter((u) => !u.startsWith(`${APP}/`))).toEqual([]);
      expect(seen.logs.filter((l) => l.includes(E2E_TOKEN) || l.includes(E2E_JIRA_TOKEN))).toEqual([]);
      expect(seen.logs.filter((l) => /Content Security Policy|Content-Security-Policy/i.test(l))).toEqual([]);
    },
    { auto: true },
  ],
});

const brief = (page: Page) => page.locator("#brief");
const fold = (page: Page, key: string) => page.locator(`details[data-task="${key}"]`);
const fetchBtn = (page: Page, key: string) => brief(page).getByRole("button", { name: `Fetch ${key} from Jira` });
const openSettings = (page: Page) => page.getByRole("button", { name: "Settings" }).click();
const closeSettings = (page: Page) => page.getByRole("button", { name: "Close the settings" }).click();

async function open(page: Page) {
  await page.goto("/");
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", { task: true });
  await page.locator("[data-row]", { hasText: TITLE }).first().click();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(TITLE);
}

async function openBrief(page: Page) {
  await page.keyboard.press("Shift+R");
  await expect(page.getByLabel("Your note")).toBeFocused();
  await expect(brief(page).getByText(JIRA_ISSUE, { exact: true })).toBeVisible();
  await expect(brief(page).getByText(MISSING, { exact: true })).toBeVisible();
}

test("without Jira settings, the brief offers Set up Jira and no Fetch", async ({ page }) => {
  await open(page);
  await openBrief(page);
  await expect(brief(page).getByRole("button", { name: /^Fetch / })).toHaveCount(0);
  await brief(page).getByRole("button", { name: "Set up Jira" }).click();
  await expect(page.getByLabel("Jira URL")).toBeFocused();
  await expect(page.getByLabel("Personal access token")).toHaveAttribute("placeholder", "Personal access token…");
});

test("connect Jira, fetch a task, show a fetch error, fetch again, remove, and disconnect", async ({ page, request }) => {
  await open(page);

  // Connect. The token goes to the server and never comes back.
  await openSettings(page);
  await page.getByLabel("Jira URL").fill(JIRA_URL);
  await page.getByLabel("Personal access token").fill(E2E_JIRA_TOKEN);
  await page.getByRole("button", { name: "Save Jira settings" }).click();
  await expect(page.getByText("Saved. Jira accepted the token.")).toBeVisible();
  const token = page.getByLabel("Personal access token");
  await expect(token).toHaveValue("");
  await expect(token).toHaveAttribute("placeholder", "Stored. Leave empty to keep it.");
  const dto = await (await request.get(`${APP}/api/settings`)).text();
  expect(dto).not.toContain(E2E_JIRA_TOKEN);
  expect(JSON.parse(dto).jira).toEqual({ baseUrl: JIRA_URL, caFile: null, tokenStored: true });
  await page.reload();
  await openSettings(page);
  await expect(page.getByLabel("Jira URL")).toHaveValue(JIRA_URL);
  await expect(page.getByLabel("Personal access token")).toHaveValue("");
  expect(await page.content()).not.toContain(E2E_JIRA_TOKEN);
  await closeSettings(page);

  // Fetch. The fold shows the summary and stays closed until the user opens it.
  await openBrief(page);
  await expect(brief(page).getByRole("button", { name: "Set up Jira" })).toHaveCount(0);
  await fetchBtn(page, JIRA_ISSUE).click();
  const task = fold(page, JIRA_ISSUE);
  await expect(task.locator("summary")).toContainText(SUMMARY);
  // The Fetch button stays in place with its new name, so focus stays on it.
  await expect(brief(page).getByRole("button", { name: `Fetch ${JIRA_ISSUE} again` })).toBeFocused();
  await expect(task.locator("summary")).toContainText("In Progress, 3 comments, fetched today");
  await expect(task).toHaveJSProperty("open", false);
  const description = task.getByText("The sync worker writes each cache entry on its own.", { exact: false });
  await expect(description).toBeHidden();
  await task.locator("summary").click();
  await expect(description).toBeVisible();
  // Plain text: the Jira wiki markup shows as typed, with its line breaks.
  await expect(description).toContainText("h3. Acceptance criteria");
  await expect(description).toHaveCSS("white-space", "pre-wrap");
  await expect(task.locator("h1, h2, h3, h4, ul, li, a, img")).toHaveCount(0);
  await expect(task.getByText("QA: test with an empty cache too.")).toBeVisible();
  await expect(task.getByText("Kenji Ito")).toBeVisible();

  // A fetch error shows the fixed server text and stores nothing.
  await fetchBtn(page, MISSING).click();
  const failed = `${MISSING}: Jira has no such issue, or the token may not see it.`;
  await expect(brief(page).locator("span", { hasText: failed })).toBeVisible();
  await expect(brief(page).getByRole("status")).toHaveText(failed);
  await expect(fold(page, MISSING)).toHaveCount(0);
  await expect(fetchBtn(page, MISSING)).toBeVisible();

  // Fetch again replaces the text. The open fold stays open.
  const again = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/task-context/${JIRA_ISSUE}`));
  await brief(page)
    .getByRole("button", { name: `Fetch ${JIRA_ISSUE} again` })
    .click();
  expect((await again).status()).toBe(200);
  await expect(task).toHaveJSProperty("open", true);
  await expect(description).toBeVisible();

  // Remove deletes the stored text. Focus goes back to the Fetch button of the chip.
  await brief(page)
    .getByRole("button", { name: `Remove the ${JIRA_ISSUE} text` })
    .click();
  await expect(fold(page, JIRA_ISSUE)).toHaveCount(0);
  await expect(fetchBtn(page, JIRA_ISSUE)).toBeFocused();

  // Disconnect deletes the token after a confirmation. The brief offers Set up Jira again.
  await openSettings(page);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("button", { name: "Disconnect Jira" }).click();
  await expect(page.getByText("Disconnected. The token is deleted.")).toBeVisible();
  await expect(page.getByLabel("Jira URL")).toHaveValue("");
  await expect(page.getByLabel("Jira URL")).toBeFocused();
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toHaveCount(0);
  expect(JSON.parse(await (await request.get(`${APP}/api/settings`)).text()).jira).toEqual({
    baseUrl: null,
    caFile: null,
    tokenStored: false,
  });
  await closeSettings(page);
  await openBrief(page);
  await expect(brief(page).getByRole("button", { name: "Set up Jira" })).toBeVisible();
  await expect(brief(page).getByRole("button", { name: /^Fetch / })).toHaveCount(0);
});
