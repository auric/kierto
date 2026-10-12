// M4 browser acceptance (BRIEF US9): the check interval and the review profiles in the settings.
// Runs against serve.ts only: the fake Bitbucket, a temp git remote, and the fake Claude Code CLI.
import { type APIRequestContext, test as base, expect, type Page } from "@playwright/test";
import { APP_PORT, control, E2E_TOKEN, FAKE_URL, runMcp, runSkills } from "./control";

const APP = `http://127.0.0.1:${APP_PORT}`;
const TITLE = "Batch cache writes in the sync worker";
// src/server/review/catalog.ts SHIPPED_PROFILES.
const SHIPPED = ["General", "Over-engineering", "Security", "Explain"];
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
const reviewButton = (page: Page) => page.locator("#review-btn");
const runLine = (page: Page) => page.locator("#runline");
// The row of the newest run of one kind. data-run-state: running, done, failed, limit, or cancelled.
const runRow = (page: Page, kind = "review") => page.locator(`#runline [data-run-kind='${kind}']`);
const runLog = (page: Page) => page.getByRole("dialog", { name: "Review run log" });
const field = (page: Page, label: string, n: number) => page.getByLabel(`${label} of profile ${n}`, { exact: true });
const names = (page: Page) =>
  page
    .getByRole("list", { name: "Review profiles" })
    .getByRole("textbox", { name: /^Name of profile \d+$/ })
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

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

const openSettings = (page: Page) => page.getByRole("button", { name: "Settings" }).click();
const closeSettings = (page: Page) => page.getByRole("button", { name: "Close the settings" }).click();

async function saveProfiles(page: Page) {
  await page.getByRole("button", { name: "Save profiles" }).click();
  await expect(page.getByText("Saved. New reviews use these profiles.")).toBeVisible();
}

// The names of the profile radios in the review brief. Esc closes the brief again.
async function briefNames(page: Page) {
  await page.keyboard.press("Shift+R");
  await expect(page.getByLabel("Your note")).toBeFocused();
  const radios = page.locator("#brief").getByRole("radio");
  const out = await radios.evaluateAll((els) => els.map((e) => e.closest("label")?.querySelector("span")?.textContent ?? ""));
  await page.keyboard.press("Escape");
  await expect(page.locator("#brief")).toHaveCount(0);
  return out;
}

async function settingsApi(request: APIRequestContext) {
  return (await (await request.get(`${APP}/api/settings`)).json()) as { checkSeconds: number; profiles: { id: string; name: string }[] };
}

test("the check interval persists after a reload", async ({ page, request }) => {
  await connect(page);
  await openSettings(page);
  const every = page.getByLabel("Check for new activity");
  await expect(every).toHaveValue("60");
  await expect(every.locator("option")).toHaveText([
    "Every 30 seconds",
    "Every minute",
    "Every 2 minutes",
    "Every 5 minutes",
    "Every 10 minutes",
    "Every 15 minutes",
  ]);
  await every.selectOption({ label: "Every 5 minutes" });
  await expect.poll(async () => (await settingsApi(request)).checkSeconds).toBe(300);
  await page.reload();
  await openSettings(page);
  await expect(page.getByLabel("Check for new activity")).toHaveValue("300");
});

test("a renamed profile shows in the Review button and in the run labels; a run keeps the name it started with", async ({ page }) => {
  await connect(page);
  await expect(reviewButton(page)).toHaveText(/Review · General/);
  await openSettings(page);
  const name = field(page, "Name", 1);
  await expect(name).toHaveValue("General");
  await name.fill("Correctness");
  await expect(page.getByText("Unsaved changes.")).toBeVisible();
  await saveProfiles(page);
  await closeSettings(page);
  await expect(reviewButton(page)).toHaveText(/Review · Correctness/);

  await page.keyboard.press("Shift+R");
  await expect(page.getByRole("radio", { name: /^Correctness/ })).toBeChecked();
  await page.getByLabel("Your note").press("Control+Enter");
  await expect(runRow(page)).toHaveAttribute("data-run-state", "done", { timeout: RUN_MS });
  await page.keyboard.press("3");
  await expect(runLog(page)).toContainText("Correctness profile");
  await page.keyboard.press("Escape");
  await expect(runLog(page)).toBeHidden();

  // The Review button follows a second rename at once. The finished run keeps its first name and its explain flag.
  await openSettings(page);
  await field(page, "Name", 1).fill("Logic");
  await field(page, "Explain only", 1).check();
  await saveProfiles(page);
  await closeSettings(page);
  await expect(reviewButton(page)).toHaveText(/Review · Logic/);
  await expect(runRow(page)).toContainText("Correctness profile");
  await page.keyboard.press("3");
  await expect(runLog(page)).toContainText("Correctness profile");
  await page.keyboard.press("Escape");
  await page.locator("#nav-runs").click();
  await expect(row(page)).toContainText("Correctness:");
});

test("an added profile appears in the brief, and a removed one disappears", async ({ page, request }) => {
  await connect(page);
  await openSettings(page);
  const save = page.getByRole("button", { name: "Save profiles" });
  await page.getByRole("button", { name: "Add profile" }).click();
  await expect(field(page, "Name", 5)).toBeFocused();
  // A new profile needs a name and a prompt before the save.
  await expect(page.getByText("Enter a name.")).toBeVisible();
  await expect(page.getByText("Enter a prompt.")).toBeVisible();
  await expect(save).toBeDisabled();
  await field(page, "Name", 5).fill("API review");
  await field(page, "Note", 5).fill("Public API and compatibility");
  await field(page, "Prompt", 5).fill("Check the public API for breaking changes.");
  await expect(page.getByText("Enter a prompt.")).toHaveCount(0);
  await page.getByRole("button", { name: "Remove Over-engineering" }).click();
  await expect(page.getByRole("button", { name: "Remove Security" })).toBeFocused();
  // Unsaved edits stay when the settings close.
  await closeSettings(page);
  await openSettings(page);
  await expect(page.getByText("Unsaved changes.")).toBeVisible();
  expect(await names(page)).toEqual(["General", "Security", "Explain", "API review"]);
  await saveProfiles(page);
  expect((await settingsApi(request)).profiles.map((p) => [p.id, p.name])).toEqual([
    ["general", "General"],
    ["security", "Security"],
    ["explain", "Explain"],
    ["api-review", "API review"],
  ]);
  await closeSettings(page);
  expect(await briefNames(page)).toEqual(["General", "Security", "Explain", "API review"]);
});

test("reset brings back the four shipped profiles", async ({ page, request }) => {
  await connect(page);
  await openSettings(page);
  await field(page, "Name", 1).fill("Mine");
  await page.getByRole("button", { name: "Remove Explain" }).click();
  await saveProfiles(page);
  expect(await names(page)).toEqual(["Mine", "Over-engineering", "Security"]);

  const reset = page.getByRole("button", { name: "Reset to shipped profiles" });
  await reset.click();
  const question = page.getByRole("group", { name: /^Replace all profiles with the shipped profiles\?/ });
  await expect(question.getByRole("button", { name: "Cancel" })).toBeFocused();
  // Esc closes only the question. The settings stay open.
  await page.keyboard.press("Escape");
  await expect(question).toHaveCount(0);
  await expect(reset).toBeFocused();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();

  await reset.click();
  await question.getByRole("button", { name: "Reset profiles" }).click();
  await expect(question).toHaveCount(0);
  await expect.poll(() => names(page)).toEqual(SHIPPED);
  expect((await settingsApi(request)).profiles.map((p) => p.name)).toEqual(SHIPPED);
  await closeSettings(page);
  await expect(reviewButton(page)).toHaveText(/Review · General/);
  expect(await briefNames(page)).toEqual(SHIPPED);
});

// serve.ts gives the app a synthetic Claude Code config folder with the user skill test-check and the plugin skill e2e-plugin:style.
test("a skill picked in a profile is saved and copied into the run folder", async ({ page, request }) => {
  await connect(page);
  await openSettings(page);
  const picker = page.locator("#profile-0-skills");
  await picker.locator("summary").click();
  const skills = page.getByRole("group", { name: "Skills of profile 1" });
  await expect(skills.getByText("Finds changed code without a test.")).toBeVisible();
  await expect(skills.getByText("Plugin 1.2.0 · Checks the naming style.")).toBeVisible();
  await skills.getByRole("checkbox", { name: /^test-check test-check/ }).check();
  await skills.getByRole("checkbox", { name: /^style e2e-plugin:style/ }).check();
  await expect(picker.locator("summary")).toContainText("test-check, style");
  await saveProfiles(page);
  const saved = (await settingsApi(request)).profiles[0] as { skills?: string[] };
  expect(saved.skills).toEqual(["test-check", "e2e-plugin:style"]);
  await closeSettings(page);

  await control("claude", { stream: "tree", hang: true });
  await page.keyboard.press("Shift+R");
  await page.getByLabel("Your note").press("Control+Enter");
  await expect(runLine(page)).toContainText("Reviewing…", { timeout: RUN_MS });
  await expect.poll(runSkills, { timeout: RUN_MS }).toEqual(["e2e-plugin+style/SKILL.md", "test-check/SKILL.md", "test-check/notes.md"]);
  await runLine(page).getByRole("button", { name: "Cancel" }).click();
  await expect(runRow(page)).toHaveAttribute("data-run-state", "cancelled", { timeout: RUN_MS });
});

// serve.ts gives the app a Claude config with the user MCP server fake-docs and the plugin server e2e-plugin:docs. Both run tests/support/fake-mcp.ts.
test("an MCP server picked in a profile gets only its ticked tools in the run", async ({ page, request }) => {
  await connect(page);
  await openSettings(page);
  const picker = page.locator("#profile-0-mcp");
  await picker.locator("summary").click();
  const group = page.getByRole("group", { name: "MCP servers of profile 1" });
  await expect(group.getByRole("checkbox", { name: /^e2e-plugin:docs Local command, plugin e2e-plugin$/ })).toBeVisible();
  await group.getByRole("checkbox", { name: /^fake-docs Local command/ }).check();
  const tools = page.getByRole("group", { name: "Tools of fake-docs" });
  // Only the tools with readOnlyHint true start ticked.
  await expect(tools.getByRole("checkbox", { name: /^search / })).toBeChecked();
  await expect(tools.getByRole("checkbox", { name: /^lookup / })).toBeChecked();
  const del = tools.getByRole("checkbox", { name: /^delete_item / });
  await expect(del).not.toBeChecked();
  await expect(tools.getByText("May change data. Review Loop cannot check this.")).toHaveCount(1);
  await expect(tools.getByText("bad.name")).toHaveCount(0);
  await tools.getByRole("checkbox", { name: /^lookup / }).uncheck();
  await expect(picker.locator("summary")).toContainText("fake-docs (1)");
  await expect(page.getByText("E2E-MCP-SECRET")).toHaveCount(0);
  await saveProfiles(page);
  const saved = (await settingsApi(request)).profiles[0] as { mcp?: unknown };
  expect(saved.mcp).toEqual([{ server: "fake-docs", tools: ["search"] }]);
  await closeSettings(page);

  await control("claude", { stream: "tree", hang: true });
  await page.keyboard.press("Shift+R");
  await page.getByLabel("Your note").press("Control+Enter");
  await expect(runLine(page)).toContainText("Reviewing…", { timeout: RUN_MS });
  await expect.poll(async () => (await runMcp())?.servers?.includes("fake-docs") ?? false, { timeout: RUN_MS }).toBe(true);
  const run = await runMcp();
  expect(run?.allowed?.split(",")).toContain("mcp__fake-docs__search");
  expect(run?.allowed).not.toContain("mcp__fake-docs__lookup");
  expect(run?.denied?.split(",").sort()).toEqual(["mcp__fake-docs__delete_item", "mcp__fake-docs__lookup"]);
  await runLine(page).getByRole("button", { name: "Cancel" }).click();
  await expect(runRow(page)).toHaveAttribute("data-run-state", "cancelled", { timeout: RUN_MS });
});
