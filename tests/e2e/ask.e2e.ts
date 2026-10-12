// Plan r2 UI-ASK in the browser: q opens the Ask section, Ctrl+Enter asks, and the answer shows as safe Markdown.
// The answer is text only: no draft, no post, and no write request to the forge.
// Runs against serve.ts only: the fake Bitbucket, a temp git remote, and the fake Claude Code CLI.
import { test as base, expect, type Page } from "@playwright/test";
import { APP_PORT, control, E2E_TOKEN, FAKE_URL, posts, writes } from "./control";

const APP = `http://127.0.0.1:${APP_PORT}`;
const TITLE = "Batch cache writes in the sync worker";
// A run passes the git workspace, the fake CLI, and the result check.
const RUN_MS = 60_000;
const QUESTION = "Which callers of flush() are not updated?";
const COVERAGE = { read: ["src/cache/flush.ts"], skipped: [], unavailable: [], notChecked: [] };
// Raw HTML and a remote image must not render. The fixture check fails on any request outside the app.
const ANSWER =
  "## Callers\n\nBoth callers of `flush()` take the lock in **src/cache/worker.ts**.\n\n<b>raw</b> HTML stays out.\n\n![diagram](https://x.test/d.png)";

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
      // Every test: an ask sends nothing to the forge.
      expect(await writes()).toEqual([]);
      expect(await posts()).toEqual([]);
    },
    { auto: true },
  ],
});

const runLine = (page: Page) => page.locator("#runline");
// The row of the newest run of one kind. data-run-state: running, done, failed, limit, or cancelled.
const runRow = (page: Page, kind = "review") => page.locator(`#runline [data-run-kind='${kind}']`);
const box = (page: Page) => page.getByLabel("Your question");
const answers = (page: Page) => page.locator("[data-ask]");
const runLog = (page: Page) => page.getByRole("dialog", { name: "Claude Code run log" });

async function connect(page: Page) {
  await page.goto("/");
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", {});
  await page.locator("[data-row]", { hasText: TITLE }).first().click();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(TITLE);
  // The Ask section shows once the pull request data loads.
  await expect(page.locator("#s-ask-sum")).toBeVisible();
}

test("q opens Ask, Ctrl+Enter asks, the answer is safe Markdown, and Log opens the log of that run", async ({ page }) => {
  await control("claude", { stream: "tree", answer: { answer: ANSWER, coverage: COVERAGE } });
  await connect(page);
  await page.keyboard.press("q");
  await expect(page.locator("#s-ask")).toHaveAttribute("open", "");
  await expect(box(page)).toBeFocused();
  await expect(page.locator("#s-ask-sum")).toHaveText("Ask Claude");

  await box(page).fill(QUESTION);
  await box(page).press("Control+Enter");
  await expect(box(page)).toHaveValue("");
  await expect(runRow(page, "ask")).toHaveAttribute("data-run-state", "done", { timeout: RUN_MS });
  await expect(runRow(page, "ask")).toContainText("Answered");
  await expect(page.locator("#s-ask-sum")).toHaveText("Ask Claude1");

  const a = answers(page).first();
  await expect(a).toContainText(QUESTION);
  await expect(a.getByRole("status")).toContainText(/Claude answered on [0-9a-f]{7}/);
  await expect(a.getByRole("heading", { name: "Callers" })).toBeVisible();
  await expect(a.locator("strong")).toHaveText("src/cache/worker.ts");
  await expect(a.locator("b")).toHaveCount(0);
  await expect(a.locator("img")).toHaveCount(0);
  await expect(a.getByRole("link", { name: "diagram" })).toHaveAttribute("href", "https://x.test/d.png");
  // An answer is no draft and no question for the author.
  await expect(page.locator("[data-draft]")).toHaveCount(0);

  await a.getByRole("button", { name: "View log" }).click();
  await expect(runLog(page)).toBeVisible();
  await expect(runLog(page).locator("footer")).toContainText("Answered.");
  await page.keyboard.press("Escape");
  await expect(runLog(page)).toHaveCount(0);
  await expect(a.getByRole("button", { name: "View log" })).toBeFocused();
});

test("a 409 keeps the typed question, also after a reload, and a running answer can be cancelled", async ({ page }) => {
  await control("claude", { stream: "tree", hang: true });
  await connect(page);
  await page.keyboard.press("Shift+R");
  await page.getByLabel("Your note").fill("Check the lock scope.");
  await page.getByLabel("Your note").press("Control+Enter");
  await expect(runLine(page)).toContainText("Reviewing…", { timeout: RUN_MS });

  await page.keyboard.press("q");
  await expect(page.locator("#s-ask")).toContainText("Claude is reviewing this pull request. One review runs at a time.");
  await box(page).fill(QUESTION);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("The question was not sent")).toBeVisible();
  await expect(box(page)).toHaveValue(QUESTION);
  await expect(answers(page)).toHaveCount(0);
  // The unsent question stays in this browser.
  await page.reload();
  await page.locator("[data-row]", { hasText: TITLE }).first().click();
  await expect(page.locator("#s-ask-sum")).toBeVisible();
  await page.keyboard.press("q");
  await expect(box(page)).toHaveValue(QUESTION);

  await runLine(page).getByRole("button", { name: "Cancel" }).click();
  await expect(runRow(page)).toContainText(/Cancelled after \d+ tool calls?/, { timeout: RUN_MS });
  await box(page).press("Control+Enter");
  await expect(runLine(page)).toContainText("Answering…", { timeout: RUN_MS });
  const a = answers(page).first();
  await expect(a.getByRole("status")).toContainText("Answering…");
  await expect(page.locator("#s-ask-sum")).toHaveText("Ask Claude1, 1 running");
  await a.getByRole("button", { name: "Cancel" }).click();
  await expect(a.getByRole("status")).toContainText("You cancelled the question.", { timeout: RUN_MS });
  await expect(runRow(page, "ask")).toContainText(/Cancelled after \d+ tool calls?/);
});

test("a failed answer shows the reason and its raw output", async ({ page }) => {
  await control("claude", { stream: "tree", answer: { answer: 42, coverage: COVERAGE } });
  await connect(page);
  await page.keyboard.press("q");
  await box(page).fill(QUESTION);
  await box(page).press("Control+Enter");
  const a = answers(page).first();
  await expect(a.getByRole("status")).toContainText("The question failed. The result does not match the ask schema.", { timeout: RUN_MS });
  await a.getByRole("button", { name: "Show raw output" }).click();
  await expect(page.locator("#raw-out")).toContainText("# structured_output");
  await expect(page.locator("#raw-copy")).toBeFocused();
});
