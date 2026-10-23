// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Explain this PR in the browser (docs/plans/review-v2/spec.md sections 3.1 and 3.5, AC-X1, AC-X3, AC-X5, AC-X6, AC-X7, AC-UX1,
// AC-UX3, AC-UX10): w opens the Explain page with a history entry, the page starts no run, one primary button starts it, diff links
// and risk links open the Files diff, a broken link is text, diagrams render as images, the questions wait in Drafts, a moved head
// shows the stale line with Explain again, and Back returns to the PR at its scroll position.
// Runs against serve.ts only: the fake Bitbucket, a temp git remote, and the fake Claude Code CLI.
import { test as base, expect, type Page } from "@playwright/test";
import { APP_PORT, control, E2E_TOKEN, FAKE_URL, openApp, posts, runStdin, writes } from "./control";

const APP = `http://127.0.0.1:${APP_PORT}`;
const TITLE = "Batch cache writes in the sync worker";
const RUN_MS = 60_000;
const FLOW = 'flowchart TD\n  A["flush(cache)"] --> B["cache.lock()"]\n  B --> C["write(entry)"]';
const BROKEN = 'flowchart TD\n  A["open --> B';
// The links name lines of the flush.ts diff of the source commit (tests/support/review-fixture.ts). gone.ts is not in the change, so
// the server turns that link into its text.
const EXPLAIN = {
  summary: "flush() now takes the cache lock once for each entry.",
  walkthrough: [
    "## The lock moves into the loop",
    "",
    "Each entry takes [the new lock](diff:src/cache/flush.ts#N3-N5). Before, the loop held [the old lock](diff:src/cache/flush.ts#O2).",
    "The change does not touch [the gone file](diff:src/cache/gone.ts#N4).",
    "",
    `\`\`\`mermaid\n${FLOW}\n\`\`\``,
    "",
    `\`\`\`mermaid\n${BROKEN}\n\`\`\``,
  ].join("\n"),
  order: [{ path: "src/cache/flush.ts", why: "The only changed file." }],
  files: [{ path: "src/cache/flush.ts", role: "core", summary: "Takes the lock for each entry." }],
  risks: [
    {
      text: "A reader can see a partial batch.",
      path: "src/cache/flush.ts",
      side: "new",
      line: 3,
      lineEnd: 5,
      anchorText: "const lock = cache.lock();",
    },
    { text: "No test covers the flush order.", path: null, side: "new", line: null, lineEnd: null, anchorText: "" },
  ],
  glossary: [{ term: "Batch", meaning: "All dirty entries of one flush." }],
  questions: [{ text: "Must readers see each batch as a whole?", why: "The description does not say." }],
  coverage: { read: ["src/cache/flush.ts"], skipped: [], unavailable: [], notChecked: [] },
};

const test = base.extend<{ seen: { urls: string[]; csp: string[]; errors: string[] } }>({
  seen: [
    async ({ context }, use) => {
      const seen = { urls: [] as string[], csp: [] as string[], errors: [] as string[] };
      context.on("request", (r) => seen.urls.push(r.url()));
      context.on("console", (m) => {
        if (/Content Security Policy|Content-Security-Policy/i.test(m.text())) seen.csp.push(m.text());
      });
      context.on("weberror", (e) => seen.errors.push(e.error().message));
      await control("reset");
      await use(seen);
      // spec.md section 3.5: no CSP change. Any console CSP message goes into the report.
      for (const m of seen.csp) test.info().annotations.push({ type: "csp", description: m });
      if (seen.csp.length) console.log(`CSP console messages (${seen.csp.length}):\n${[...new Set(seen.csp)].join("\n")}`);
      expect(seen.errors).toEqual([]);
      expect(seen.urls.filter((u) => !u.startsWith(`${APP}/`) && !u.startsWith("data:"))).toEqual([]);
      // Explain sends nothing to the forge.
      expect(await writes()).toEqual([]);
      expect(await posts()).toEqual([]);
    },
    { auto: true },
  ],
});

test.use({ colorScheme: "light" });

const page$ = (page: Page) => page.locator("[data-explain]");
const status = (page: Page) => page$(page).locator("[data-explain-state] [role='status']");
const primary = (page: Page) => page$(page).locator("[data-primary]");
const walk = (page: Page) => page$(page).locator("#ex-walk-h + div");
const prH1 = (page: Page) => page.locator("section[aria-label='Details'] h1:not(#explain-h)");
const pane = (page: Page) => page.locator("section[aria-label='Details'] [data-scroll]");
const path = (page: Page) => new URL(page.url()).pathname;
const mermaidChunk = (urls: string[]) => urls.filter((u) => /\/assets\/(mermaid|Diagram)[.-]/.test(u));
const depth = (page: Page) => page.evaluate(() => history.length);

async function connect(page: Page) {
  await openApp(page);
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", {});
  await page.locator("[data-row]", { hasText: TITLE }).first().click();
  await expect(prH1(page)).toHaveText(TITLE);
}

// w opens the page. One primary button starts the run. The walkthrough shows when the run ends.
async function explain(page: Page) {
  await page.keyboard.press("w");
  await expect(primary(page)).toHaveText("Explain this PR");
  await primary(page).click();
  await expect(page$(page).locator("[data-explain-summary]")).toHaveText(EXPLAIN.summary, { timeout: RUN_MS });
}

test("w opens the Explain page; its links open the diff, diagrams show as images, questions wait in Drafts, and Back returns to the PR", async ({
  page,
  seen,
}) => {
  await control("claude", { stream: "tree", explain: EXPLAIN });
  await connect(page);
  const prPath = path(page);
  // The PR keeps its scroll position under the Explain page.
  const top = await pane(page).evaluate((el) => {
    el.scrollTop = Math.min(160, el.scrollHeight - el.clientHeight);
    return el.scrollTop;
  });
  await page.waitForTimeout(300);
  expect(mermaidChunk(seen.urls)).toEqual([]);

  // AC-X1: w pushes a history entry with the /explain path. AC-X7: opening the page starts no run.
  const before = await depth(page);
  await page.keyboard.press("w");
  await expect.poll(() => path(page)).toBe(`${prPath}/explain`);
  expect(await depth(page)).toBe(before + 1);
  await expect(page.locator("#explain-h")).toHaveText(`Walkthrough: ${TITLE}`);
  await expect(prH1(page)).toBeHidden();
  await expect(status(page)).toHaveText("Claude reads the change and writes a walkthrough. About 3 to 6 min.");
  // AC-UX1 and AC-UX10: one primary button, and it takes the focus.
  await expect(primary(page)).toHaveCount(1);
  await expect(primary(page)).toBeFocused();
  expect(await runStdin()).toBeNull();

  await page.keyboard.press("Enter");
  await expect(page$(page).locator("[data-explain-summary]")).toHaveText(EXPLAIN.summary, { timeout: RUN_MS });
  await expect(primary(page)).toHaveCount(0);
  await expect(page$(page)).toContainText(/Walkthrough by Claude with the Explain profile\. Head [0-9a-f]{7}, /);
  for (const h of ["Read in this order", "Walkthrough", "Risks", "Files", "Words used"])
    await expect(page$(page).getByRole("heading", { level: 2, name: h, exact: true })).toBeVisible();
  await expect(page$(page).locator("[data-explain-file='core']")).toContainText("Core");
  await expect(page$(page).locator("dl")).toContainText("BatchAll dirty entries of one flush.");

  // AC-X5: the valid diagram is an image with a data: URL and no inline svg. The broken one shows its code and the error line.
  // AC-X6: the mermaid chunk loads with the diagram.
  const figures = walk(page).locator("figure[data-diagram]");
  await expect(figures).toHaveCount(2);
  await expect(figures.nth(0)).toHaveAttribute("data-diagram", "image", { timeout: RUN_MS });
  await expect(figures.nth(0).getByRole("img", { name: "Diagram: flowchart TD" })).toHaveAttribute(
    "src",
    /^data:image\/svg\+xml;charset=utf-8,%3Csvg/,
  );
  await expect(walk(page).locator("figure svg:not(.lucide)")).toHaveCount(0);
  await expect(figures.nth(1)).toHaveAttribute("data-diagram", "code");
  await expect(figures.nth(1).locator("pre")).toHaveText(BROKEN);
  await expect(figures.nth(1)).toContainText("The diagram did not render: ");
  expect(mermaidChunk(seen.urls).length).toBeGreaterThan(0);

  // AC-X3: a link to a changed line is a button. The server turned the link to an unchanged file into its text and counted it.
  const links = walk(page).locator("button[data-diff-link]");
  await expect(links).toHaveText(["the new lock", "the old lock"]);
  await expect(walk(page)).toContainText("The change does not touch the gone file.");
  await expect(walk(page).locator("a")).toHaveCount(0);
  const gaps = page$(page).locator("details summary");
  await expect(gaps).toHaveText("Not checked: 1");
  await gaps.click();
  await expect(page$(page).locator("details")).toContainText("1 link did not match the change.");
  await page.screenshot({ path: test.info().outputPath("explain-page.png"), fullPage: true });

  // A diff link opens the Files diff at its line and pushes an entry. Back returns to the page.
  await links.nth(0).click();
  await expect.poll(() => new URL(page.url()).search).toBe("?file=src/cache/flush.ts&line=3");
  expect(path(page)).toBe(prPath);
  await expect(page.locator("#dl-0-n3")).toBeFocused();
  await expect(page.locator("#dl-0-n3")).toContainText("const lock = cache.lock();");
  await page.goBack();
  await expect.poll(() => path(page)).toBe(`${prPath}/explain`);
  await expect(page$(page).locator("[data-explain-summary]")).toBeVisible();
  // A link to a removed line opens the old side.
  await links.nth(1).click();
  await expect.poll(() => new URL(page.url()).search).toBe("?file=src/cache/flush.ts&line=2&side=old");
  await expect(page.locator("#dl-0-o2")).toBeFocused();
  await page.goBack();
  // A risk with a place links its code. A risk without one is text.
  const risks = page$(page).locator("[data-explain-risk]");
  await expect(risks).toHaveCount(2);
  await expect(risks.nth(1).locator("button")).toHaveCount(0);
  const riskLink = risks.nth(0).getByRole("button", { name: "Open src/cache/flush.ts, lines 3 to 5, in the Files diff" });
  await expect(riskLink).toHaveText("flush.ts, lines 3 to 5");
  expect((await riskLink.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(24);
  await riskLink.click();
  await expect.poll(() => new URL(page.url()).search).toBe("?file=src/cache/flush.ts&line=3");
  await expect(page.locator("#dl-0-n3")).toBeFocused();
  await page.goBack();

  // The questions of the run wait in Drafts, marked From Explain.
  await expect(page$(page)).toContainText("Claude asked 1 question for the author. They wait in Drafts, marked From Explain.");
  await page$(page).getByRole("button", { name: "Go to the drafts" }).click();
  await expect.poll(() => path(page)).toBe(prPath);
  const q = page.locator("#s-drafts [data-draft-question]");
  await expect(q).toHaveCount(1);
  await expect(q).toHaveAttribute("aria-label", "Question from Claude, from Explain");
  await expect(q.locator("[data-from-explain]")).toHaveText("From Explain");
  await expect(q).toBeFocused();
  // The run record has the Explain row, which opens the page again.
  await expect(page.locator("#runline [data-run-kind='explain']")).toContainText("Explained the change, 1 question");

  // Back walks to the page. Esc on it returns to the PR at its scroll position, with the focus on Explain this PR.
  await page.goBack();
  await expect.poll(() => path(page)).toBe(`${prPath}/explain`);
  await expect(page$(page).locator("[data-explain-summary]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => path(page)).toBe(prPath);
  await expect(prH1(page)).toHaveText(TITLE);
  await expect(page.locator("#explain-btn")).toBeFocused();
  await expect.poll(() => pane(page).evaluate((el) => el.scrollTop)).toBeGreaterThanOrEqual(top - 2);
  expect(await pane(page).evaluate((el) => el.scrollTop)).toBeLessThanOrEqual(top + 2);
});

test("a moved head shows the stale line and Explain again; a running run keeps the earlier walkthrough and can be cancelled", async ({
  page,
}) => {
  await control("claude", { stream: "tree", explain: EXPLAIN });
  await connect(page);
  await explain(page);
  const firstHead = (await page$(page).locator("header p").textContent())?.match(/Head ([0-9a-f]{7})/)?.[1];
  expect(firstHead).toMatch(/^[0-9a-f]{7}$/);

  // AC-X7: the source branch moves on. The page says so, keeps the walkthrough, and starts no run.
  await control("state", { push: true });
  await expect(status(page)).toHaveText("The PR changed after this walkthrough.");
  await expect(primary(page)).toHaveText("Explain again");
  await expect(page$(page).locator("[data-explain-summary]")).toBeVisible();

  // A running run names the actor, shows the time, and keeps the earlier walkthrough. Cancel stops it.
  await control("claude", { stream: "tree", explain: EXPLAIN, hang: true });
  await primary(page).click();
  await expect(status(page)).toHaveText("Claude is reading the change.");
  await expect(page$(page).locator("[data-explain-state]")).toContainText("Under 1 min so far.");
  await expect(page$(page).locator("[data-explain-state]")).toContainText(
    `The walkthrough below is from an earlier run. Head ${firstHead}.`,
  );
  await expect(page$(page).locator("[data-explain-summary]")).toBeVisible();
  await expect(primary(page)).toHaveCount(0);
  await page$(page).getByRole("button", { name: "Cancel" }).click();
  await expect(status(page)).toHaveText("You cancelled the walkthrough.", { timeout: RUN_MS });
  // The focus was in the status box, so it moves to the new primary button.
  await expect(primary(page)).toBeFocused();

  await control("claude", { stream: "tree", explain: EXPLAIN });
  await primary(page).click();
  await expect(page$(page).locator("[data-explain-state]")).toHaveCount(0, { timeout: RUN_MS });
  const secondHead = (await page$(page).locator("header p").textContent())?.match(/Head ([0-9a-f]{7})/)?.[1];
  expect(secondHead).toMatch(/^[0-9a-f]{7}$/);
  expect(secondHead).not.toBe(firstHead);
  // The Back button of the page returns to the PR.
  await page.locator("#explain-back").click();
  await expect(prH1(page)).toHaveText(TITLE);
  await expect(page$(page)).toHaveCount(0);
});

test("a link to the Explain page in a new tab opens the page; its Back goes to the PR in place", async ({ page }) => {
  await control("claude", { stream: "tree", explain: EXPLAIN });
  await connect(page);
  const prPath = path(page);
  await explain(page);
  await openApp(page, `${prPath}/explain`);
  await expect(page$(page).locator("[data-explain-summary]")).toHaveText(EXPLAIN.summary);
  const before = await depth(page);
  await page.locator("#explain-back").click();
  await expect.poll(() => path(page)).toBe(prPath);
  await expect(prH1(page)).toHaveText(TITLE);
  expect(await depth(page)).toBe(before);
});
