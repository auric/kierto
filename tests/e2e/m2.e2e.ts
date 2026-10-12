// M2 browser acceptance (plan v3 WP11): the review brief, the run line, the run log, drafts, and raw output.
// Runs against serve.ts only: the fake Bitbucket, a temp git remote, and the fake Claude Code CLI.
import { type APIRequestContext, test as base, expect, type Page } from "@playwright/test";
import { APP_PORT, control, E2E_TOKEN, FAKE_URL } from "./control";

const APP = `http://127.0.0.1:${APP_PORT}`;
const TITLE = "Batch cache writes in the sync worker";
const NOTE = "ABC-1: the flush must stay atomic for readers. Check the lock scope first.";
// A run passes the git workspace, the fake CLI, and the validator.
const RUN_MS = 60_000;

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

const row = (page: Page) => page.locator("[data-row]", { hasText: TITLE }).first();
const runLine = (page: Page) => page.locator("#runline");
const runLog = (page: Page) => page.getByRole("dialog", { name: "Claude Code run log" });

async function connect(page: Page) {
  await page.goto("/");
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", {});
  await row(page).click();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(TITLE);
}

async function runs(request: APIRequestContext) {
  const prs = (await (await request.get(`${APP}/api/prs`)).json()) as { id: number; title: string }[];
  const id = prs.find((p) => p.title === TITLE)?.id;
  return (await (await request.get(`${APP}/api/prs/${id}/runs`)).json()) as { id: number; profile: string; note: string; status: string }[];
}

// Shift+R opens the brief with focus in the note. Ctrl+Enter saves the brief and starts the review.
async function startWithBrief(page: Page, note = NOTE) {
  await page.keyboard.press("Shift+R");
  const field = page.getByLabel("Your note");
  await expect(field).toBeFocused();
  await field.fill(note);
  await field.press("Control+Enter");
}

test("a brief with a note and a profile; drafts, summary, and the subagent tree; r runs the brief again", async ({ page, request }) => {
  await connect(page);
  await page.keyboard.press("Shift+R");
  await expect(page.getByLabel("Your note")).toBeFocused();
  await page.getByLabel("Your note").fill(NOTE);
  await page.getByRole("radio", { name: /^Security/ }).check();
  await expect(page.locator("#review-btn")).toHaveText(/Review · Security/);
  await page.getByLabel("Your note").press("Control+Enter");
  await expect(page.locator("#brief")).toHaveCount(0);

  await expect(runLine(page)).toContainText(/Claude reviewed [0-9a-f]{7}/, { timeout: RUN_MS });
  await expect(runLine(page)).toContainText("3 findings, 1 question");
  // One button per severity of the open drafts. Each one goes to the first draft of its severity.
  await expect(runLine(page).locator("[data-severity]")).toHaveText(["1 Blocker", "1 Minor", "1 Nit"]);
  await runLine(page).getByRole("button", { name: "1 Nit" }).click();
  await expect(page.getByRole("article", { name: /^Draft from Claude\. Nit\. README\.md:1\./ })).toBeFocused();
  await expect(page.getByText(`Your note: ${NOTE}`)).toBeVisible();
  // Exact, moved, and outside drafts. The finding on a file that the snapshot does not have is dropped.
  await expect(page.locator("[data-draft]")).toHaveCount(3);
  await expect(page.getByText("Moved from line 6: the quoted code is on line 5.")).toBeVisible();
  await expect(page.getByText("Outside the diff. Posts as a general comment with a link to README.md:1.")).toBeVisible();
  // A review that ends while the page shows it opens the summary.
  await expect(page.locator("#ai-sum")).toHaveAttribute("open", "");
  await expect(page.getByText("1 finding dropped: its code reference did not match the snapshot.")).toBeVisible();
  await expect(page.getByText("Must flush() stay atomic for readers?")).toBeVisible();

  // "from rl-reviewer" opens the log at that agent. Its calls nest under it by parent.
  await page.getByRole("button", { name: "from rl-reviewer" }).click();
  const log = runLog(page);
  const agent = log.getByRole("button", { name: /^rl-reviewer subagent, done, 3 tool calls/ });
  await expect(agent).toBeFocused();
  await expect(agent).toHaveAttribute("aria-expanded", "true");
  const kids = log.locator(`[id="${await agent.getAttribute("aria-controls")}"] > li`);
  await expect(kids).toHaveCount(3);
  await expect(kids.first()).toContainText("note-reviewer.txt");
  await agent.click();
  await expect(agent).toHaveAttribute("aria-expanded", "false");
  await expect(kids.first()).toBeHidden();
  await expect(log.locator("footer")).toContainText("Result: 3 findings, 1 question.");
  await page.keyboard.press("Escape");
  await expect(log).toBeHidden();
  await expect(page.getByRole("button", { name: "from rl-reviewer" })).toBeFocused();

  // 3 opens the log, 2 goes to the first draft, r runs the stored brief again.
  await page.keyboard.press("3");
  await expect(log).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("2");
  await expect(page.locator("[data-draft]").first()).toBeFocused();
  await page.keyboard.press("r");
  await expect.poll(async () => (await runs(request)).length, { timeout: RUN_MS }).toBe(2);
  expect((await runs(request))[0]).toMatchObject({ profile: "security", note: NOTE });
  await expect(runLine(page)).toContainText(/Claude reviewed/, { timeout: RUN_MS });
  await expect(page.locator("#nav-runs")).toHaveAccessibleName("Review runs: 1");

  // The Review runs row names the state, the findings, and the time of the newest run.
  await page.locator("#nav-runs").click();
  await expect(row(page).locator("[data-run-chip]")).toHaveText("Done");
  await expect(row(page)).toContainText("3 findings");
  await expect(row(page).locator("time")).toHaveText(/^(now|\d+m)$/);
});

test("Esc closes the brief; cancel stops a running review, and nothing from it stays", async ({ page, request }) => {
  await control("claude", { stream: "tree", hang: true });
  await connect(page);
  // Without a brief and a run, r opens the brief.
  await page.keyboard.press("r");
  await expect(page.getByLabel("Your note")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#brief")).toHaveCount(0);
  await expect(page.locator("#review-btn")).toBeFocused();

  await startWithBrief(page);
  await expect(runLine(page)).toContainText("Reviewing…", { timeout: RUN_MS });
  await expect(runLine(page)).toContainText(/\d+ tool calls?/, { timeout: RUN_MS });
  await page.keyboard.press("3");
  await expect(runLog(page).locator("footer")).toContainText("Running.");
  await page.keyboard.press("Escape");
  await runLine(page).getByRole("button", { name: "Cancel" }).click();
  await expect(runLine(page)).toContainText(/You cancelled the review after \d+ tool calls?\./, { timeout: RUN_MS });
  await page.keyboard.press("3");
  await expect(runLog(page).locator("footer")).toContainText("You cancelled the run. Nothing from it can be posted.");
  await expect(page.locator("[data-draft]")).toHaveCount(0);
  expect((await runs(request)).map((r) => r.status)).toEqual(["cancelled"]);
});

test("a usage limit is one line with the CLI message, and the inbox keeps working", async ({ page }) => {
  await control("claude", { stream: "limit" });
  await connect(page);
  await startWithBrief(page);
  await expect(runLine(page)).toContainText(/Claude Code: Usage limit reached\. .* Review Loop does not retry by itself\./, {
    timeout: RUN_MS,
  });
  await expect(runLine(page).getByRole("button", { name: "Show raw output" })).toHaveCount(0);
  await page.locator("#nav-runs").click();
  await expect(row(page).locator("[data-run-chip]")).toHaveText("Usage limit");
  await page
    .locator("nav[aria-label='Views']")
    .getByRole("button", { name: /^Reviewing/ })
    .click();
  await expect(page.locator("[data-row]")).toHaveCount(3);
});

test("a failed run shows its raw output, read-only, with Copy", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
  await control("claude", { stream: "schema" });
  await connect(page);
  await startWithBrief(page);
  await expect(runLine(page)).toContainText("Review failed. The result does not match the review schema.", { timeout: RUN_MS });
  await runLine(page).getByRole("button", { name: "Show raw output" }).click();
  const raw = page.locator("#raw-out");
  await expect(raw).toContainText("SCHEMA-CANARY");
  await expect(raw).toContainText("# structured_output");
  await expect(page.locator("#raw-copy")).toBeFocused();
  await page.locator("#raw-copy").click();
  await expect(page.getByText("Copied the raw output.")).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("SCHEMA-CANARY");
  // The log footer hides the raw output again.
  await runLog(page).getByRole("button", { name: "Hide raw output" }).click();
  await expect(raw).toHaveCount(0);
});

test("two pages share one run: the same brief joins it, and a cancel in one page ends it in both", async ({ page, context, request }) => {
  await control("claude", { stream: "tree", hang: true });
  await connect(page);
  await startWithBrief(page);
  await expect(runLine(page)).toContainText("Reviewing…", { timeout: RUN_MS });

  const other = await context.newPage();
  await other.goto("/");
  await row(other).click();
  await expect(runLine(other)).toContainText("Reviewing…");
  await expect(other.locator("#nav-runs")).toHaveAccessibleName("Review runs: 1, 1 running");
  // The stored brief has the same key, so the server answers with the running review (A14).
  await other.keyboard.press("r");
  await expect(other.getByText(/One review runs at a time/)).toHaveCount(0);
  expect((await runs(request)).length).toBe(1);

  await runLine(other).getByRole("button", { name: "Cancel" }).click();
  await expect(runLine(page)).toContainText("You cancelled the review", { timeout: RUN_MS });
  await expect(runLine(other)).toContainText("You cancelled the review");
  await expect(page.locator("#nav-runs")).toHaveAccessibleName("Review runs: 1");
});
