// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// docs/plans/review-v2/spec.md sections 6.12 and 7.2 (WP-B5): the small task walkthrough in the browser. Build on the task chip of a
// PR, the questions with the recommended answers, the plan approval with the branch prefix and the first-use warning, the build with a
// stop at the line limit and "Keep one PR", "Open the PR" with its confirm, and Close. Runs against serve.ts only: the fake Bitbucket,
// the fake Jira, the fake CLI, and a local git remote. The approved test command is "bun test" in the task worktree.
import { test as base, expect, type Page } from "@playwright/test";
import { APP_PORT, control, E2E_JIRA_TOKEN, E2E_TOKEN, FAKE_URL, JIRA_ISSUE, JIRA_URL, makeClone, openApp, taskRemote } from "./control";

const APP = `http://127.0.0.1:${APP_PORT}`;
const PR_TITLE = "Batch cache writes in the sync worker";
// fixtures/jira/issue.json: the summary of ABC-42 is the task title.
const TITLE = "Flush the cache before the write lock";
const NO_COVERAGE = { read: [], skipped: [], unavailable: [], notChecked: [] };
// The line limit of the repository in this test. The plan estimate is under it, and the branch with its plan file is over it.
const LIMIT = 10;
// fixtures/bitbucket/dashboard-reviewer-page.json: the target branch of PR 1001. serve.ts gives the local remote this branch.
const TARGET = "topic/sample-4";

const SPEC = {
  title: "Name the app state in the README",
  size: "small",
  estimate: { parts: 1, lines: 5, files: 2, modules: ["docs"], db: false, api: false, unknowns: [] },
  map: [{ path: "README.md", line: 1, symbol: "", kind: "change", what: "The title line." }],
  change: "Add the word works to the title line of the README.",
  design: null,
  spec: null,
  parts: [
    {
      n: 1,
      kind: "part",
      title: "README title",
      goal: "The README title says that the app works.",
      lines: 5,
      acceptance: [{ id: "A1", text: "The README title contains works." }],
      tests: [{ test: "tests/readme.test.ts", proves: ["A1"] }],
      tasks: [
        {
          id: "T1",
          title: "Change the README title",
          files: ["README.md"],
          run: ["tests/readme.test.ts"],
          done: "The README test passes.",
        },
      ],
    },
  ],
  testing: { commands: [{ name: "test", kind: "test", argv: ["bun", "test"] }], services: [], notes: "" },
  flag: null,
  questions: [],
  coverage: NO_COVERAGE,
};
const README_TEST = `import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
test("the README title says that the app works", () => expect(readFileSync("README.md", "utf8")).toContain("works"));
`;
const README = "# Sample works\n";
const MINOR = {
  path: "README.md",
  side: "new",
  line: 1,
  lineEnd: null,
  anchorText: "# Sample works",
  severity: "minor",
  category: "Maintainability",
  body: "Say what works in the title.",
  evidence: "README.md:1 says only works.",
  evidenceStatus: "code",
  confidence: "high",
  agent: null,
  trigger: "A reader of the README cannot tell what works.",
};

const test = base.extend<{ seen: { urls: string[]; logs: string[] } }>({
  seen: [
    async ({ context }, use) => {
      const seen = { urls: [] as string[], logs: [] as string[] };
      context.on("request", (r) => seen.urls.push(r.url()));
      context.on("console", (m) => seen.logs.push(m.text()));
      context.on("weberror", (e) => seen.logs.push(e.error().message));
      await control("reset");
      await use(seen);
      // Only the local app gets requests. Bitbucket and Jira get them from the server only.
      expect(seen.urls.filter((u) => !u.startsWith(`${APP}/`))).toEqual([]);
      expect(seen.logs.filter((l) => l.includes(E2E_TOKEN) || l.includes(E2E_JIRA_TOKEN))).toEqual([]);
    },
    { auto: true },
  ],
});

// A call to the app API with the session token of the page, as the page itself sends it.
async function api(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const headers = {
        "X-RL-Session": document.querySelector<HTMLMetaElement>('meta[name="rl-session"]')?.content ?? "",
        "Content-Type": "application/json",
      };
      const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    { method, path, body },
  );
}

const status = (page: Page) => page.locator("#task-status");
const primary = (page: Page) => page.locator("[data-primary]");

test("a small task: chip, questions, plan with the warning, a stop at the line limit, Open the PR, and Close", async ({ page }) => {
  test.setTimeout(300_000);
  await control("claude", {
    stream: "task",
    spec: SPEC,
    review: { summary: "A small change.", risks: [], questions: [], coverage: NO_COVERAGE, findings: [MINOR] },
    seq: {
      "implement:tests": [{ writes: [{ path: "repo/tests/readme.test.ts", text: README_TEST }] }],
      "implement:implement": [{ writes: [{ path: "repo/README.md", text: README }] }],
      "implement:fix": [{ writes: [{ path: "repo/README.md", text: README }] }],
    },
  });
  await openApp(page);
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", { task: true });
  // Setup that the user does once: Jira, the clone with the git identity of the commits, and a low line limit for this test.
  expect((await api(page, "PUT", "/api/settings/jira", { baseUrl: JIRA_URL, token: E2E_JIRA_TOKEN })).status).toBe(200);
  const prs = (await api(page, "GET", "/api/prs")).json as { id: number; prId: number }[];
  const prA = prs.find((p) => p.prId === 1001)?.id as number;
  expect((await api(page, "PUT", `/api/prs/${prA}/clone`, { path: await makeClone(1001) })).status).toBe(200);
  const limit = await api(page, "PUT", "/api/repos/PROJ1/sample-repo-2/task-settings", {
    specDir: "specs/{key}/",
    // The local remote has a branch "feature", so a "feature/" branch cannot exist there (git refs are paths). Step 3 changes the
    // prefix to "task/" on the plan screen.
    branchPrefix: "feature/",
    lineBudget: LIMIT,
    maxOpen: 2,
    approvals: 1,
    commands: [],
    testGlobs: null,
    excludeGlobs: null,
    isolateHome: true,
  });
  expect(limit.status).toBe(200);
  await page.reload();

  // 1. Build on the task chip of the PR: one click, then the Task view.
  await page.locator("[data-row]", { hasText: PR_TITLE }).first().click();
  await page.getByRole("button", { name: `Build this task: ${JIRA_ISSUE}` }).click();
  await expect(page).toHaveURL(/\/tasks\/\d+$/);
  await expect(page.getByRole("heading", { level: 2, name: TITLE })).toBeVisible();
  await expect(page.locator('[aria-current="step"]')).toHaveText("Questions");

  // 2. The questions as a form: the recommended option is preselected and marked. Send answers.
  await expect(status(page)).toHaveText(/^\S+ has 2 questions before it writes the plan\.$/);
  await expect(primary(page)).toHaveCount(1);
  await expect(primary(page)).toHaveText("Answer 2 questions");
  const form = page.getByRole("form", { name: "Questions" });
  await expect(form.getByRole("radio", { name: /Keep it/ })).toBeChecked();
  await expect(form.getByText("Recommended", { exact: true })).toBeVisible();
  await expect(form.getByText("Why it matters: Echo: it changes the tests.")).toBeVisible();
  await primary(page).click();
  await expect(form.getByRole("radio", { name: /Keep it/ })).toBeFocused();
  await form.getByRole("button", { name: "Send answers" }).click();

  // 3. The plan: the size, the commands, and the warning of the first build in this repository.
  await expect(status(page)).toHaveText("The plan is ready: small, 1 PR, about 5 changed lines.", { timeout: 60_000 });
  await expect(page.locator('[aria-current="step"]')).toHaveText("Plan");
  await expect(primary(page)).toHaveText("Approve the plan");
  await expect(page.getByRole("radio", { name: /^Small: one PR/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /bun test/ })).toBeChecked();
  await expect(page.getByText("Before the first build in this repository")).toBeVisible();
  // The branch from the prefix of the repository. "Change the prefix" saves it with the task settings route, and Enter in its field
  // does not submit the plan.
  const planned = page.locator("#task-branch");
  await expect(planned).toHaveText("feature/ABC-42-flush-the-cache-before-the-write-lock");
  await page.getByRole("button", { name: "Change the prefix" }).click();
  const prefix = page.getByLabel("Branch prefix");
  await expect(prefix).toBeFocused();
  await prefix.fill("bad..");
  await page.getByRole("button", { name: "Save the prefix" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Invalid branch prefix." })).toBeVisible();
  await prefix.fill("task/");
  await expect(planned).toHaveText("task/ABC-42-flush-the-cache-before-the-write-lock");
  await prefix.press("Enter");
  await expect(page.getByRole("button", { name: "Change the prefix" })).toBeFocused();
  await expect(page.getByRole("alert").filter({ hasText: "tick “I understand” first" })).toHaveCount(0);
  await expect(primary(page)).toHaveCount(1);
  expect((await api(page, "GET", "/api/repos/PROJ1/sample-repo-2/task-settings")).json).toMatchObject({
    branchPrefix: "task/",
    lineBudget: LIMIT,
  });
  await primary(page).click();
  await expect(page.getByRole("alert").filter({ hasText: "tick “I understand” first" })).toBeVisible();
  await page.getByRole("checkbox", { name: "I understand" }).check();
  await primary(page).click();

  // 4. The build stops at the line limit. "Keep one PR" lets it go on.
  await expect(page.locator('[aria-current="step"]')).toHaveText("Build", { timeout: 60_000 });
  await expect(status(page)).toHaveText(new RegExp(`^Needs you: this PR would have \\d+ changed lines, over your ${LIMIT} limit\\.$`), {
    timeout: 120_000,
  });
  await expect(primary(page)).toHaveText("Keep one PR");
  await primary(page).click();

  // 5. The change is ready and checked. The small point of the own review is listed. Nothing went out before the click.
  await expect(status(page)).toHaveText(/^Your change is ready and checked by \S+\.$/, { timeout: 180_000 });
  await expect(primary(page)).toHaveText("Open the PR");
  await expect(primary(page)).toBeFocused();
  await expect(page.getByText("Say what works in the title.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Fix the small points too" })).toBeVisible();
  const before = await taskRemote();
  expect(Object.keys(before.heads).filter((b) => b.startsWith("task/"))).toEqual([]);
  expect(before.creates).toEqual([]);

  // The Log tab holds the checks with their output, and the Diff tab the change.
  await page.getByRole("tab", { name: "Log" }).click();
  await expect(page.getByRole("tabpanel").getByText("bun test").first()).toBeVisible();
  // The red checks of the tests step are no failure.
  await expect(page.getByRole("tabpanel").getByText("Red as expected").first()).toBeVisible();
  await page.getByRole("tab", { name: "Diff" }).click();
  await expect(page.getByRole("tabpanel").getByText("README.md", { exact: true })).toBeVisible();

  // 6. Open the PR: one confirm, one push to the task branch, and one PR create.
  await primary(page).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toHaveText(/^Push task\/ABC-42-\S+ and open a PR into topic\/sample-4\?$/);
  await dialog.getByRole("button", { name: "Push and open PR" }).click();
  await expect(dialog).toBeHidden();
  await expect(status(page)).toHaveText("Waiting for the review of your PR. Nothing to do.");
  await expect(primary(page)).toHaveText("Go to the PR");
  const after = await taskRemote();
  const branch = Object.keys(after.heads).find((b) => b.startsWith("task/ABC-42-")) as string;
  expect(branch).toBeTruthy();
  expect(after.heads[TARGET]).toBe(before.heads[TARGET]);
  expect(after.creates).toHaveLength(1);
  expect(after.creates[0]).toMatchObject({
    title: `${JIRA_ISSUE}: ${TITLE}`,
    fromRef: { id: `refs/heads/${branch}` },
    toRef: { id: `refs/heads/${TARGET}` },
  });

  // 7. Close the task. The branch and the PR stay.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Close the task" }).click();
  await expect(status(page)).toHaveText("Closed. The branches and PRs stay as they are.");
  await expect(primary(page)).toHaveCount(0);
  expect((await taskRemote()).heads[branch]).toBe(after.heads[branch]);

  // The Tasks view lists the task with its status.
  await page.getByRole("button", { name: /^Tasks: / }).click();
  await expect(page.locator("[data-row]", { hasText: TITLE })).toContainText("Closed");
});
