// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Session consult (docs/plans/session-consult.md parts A to C): the copy dialog with its groups, the remembered choice, the copied
// text, the paste of a crafted answer with its preview, Apply, Undo, the direct session run with its opt-in and cancel, and no post.
// Runs against serve.ts only: the fake Bitbucket with the author PR 1004, the temp git remote, and the fake CLI.
import { test as base, expect, type Page } from "@playwright/test";
import { APP_PORT, control, E2E_TOKEN, FAKE_URL, openApp, runArgv, sessions, writes } from "./control";

const APP = `http://127.0.0.1:${APP_PORT}`;
const TITLE = "Release the write lock after each entry";
const RUN_MS = 60_000;
// PR 1004: the reviewer threads LOCK and LOOP, my thread OWN, the outdated inline thread INLINE, and the resolved thread DONE.
const LOCK = 5000001;
const LOOP = 5000002;
const OWN = 5000003;
const INLINE = 5000004;
const DONE = 5000005;
// The blocker and the minor finding of the fake review.
const BLOCKER = "The lock now covers one entry at a time";
const MINOR = "does not run when";

const test = base.extend<{ seen: { urls: string[]; logs: string[] } }>({
  seen: [
    async ({ context }, use) => {
      const seen = { urls: [] as string[], logs: [] as string[] };
      context.on("request", (r) => seen.urls.push(r.url()));
      context.on("console", (m) => seen.logs.push(m.text()));
      context.on("weberror", (e) => seen.logs.push(e.error().message));
      await control("reset");
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
      await use(seen);
      // Every test: only the local app gets requests, nothing goes to the forge, and the console holds no token.
      expect(seen.urls.filter((u) => !u.startsWith(`${APP}/`))).toEqual([]);
      expect(seen.logs.filter((l) => l.includes(E2E_TOKEN))).toEqual([]);
      expect(await writes()).toEqual([]);
    },
    { auto: true },
  ],
});

const copyDialog = (page: Page) => page.getByRole("dialog", { name: "Copy for your session" });
const pasteDialog = (page: Page) => page.getByRole("dialog", { name: "Paste the answer" });
const fixList = (page: Page) => page.getByRole("dialog", { name: "Fix comments on your pull request" });
const said = (page: Page) => page.locator("p[role='status'].sr-only");
const runRow = (page: Page) => page.locator("#runline [data-run-kind='review']");
// The Windows clipboard gives CRLF line ends.
const clipboard = async (page: Page) => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");

async function connect(page: Page) {
  await openApp(page);
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", { author: true, own: true, consult: true });
  await openPr(page);
}

async function openPr(page: Page) {
  await page.locator("[data-row]", { hasText: TITLE }).first().click();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(TITLE);
}

// Shift+R opens the brief. Ctrl+Enter starts the review. The fake CLI gives 3 finding drafts, and the run fills the git cache.
async function review(page: Page) {
  await page.keyboard.press("Shift+R");
  await page.getByLabel("Your note").press("Control+Enter");
  await expect(runRow(page)).toHaveAttribute("data-run-state", "done", { timeout: RUN_MS });
  await expect(page.locator("#s-drafts [data-draft]")).toHaveCount(3);
}

// A sync or the first-draft rule can open a row first, so the click repeats until the row stays open.
async function openRow(page: Page, head: string) {
  const el = page.locator(head);
  await expect(async () => {
    if ((await el.getAttribute("aria-expanded")) !== "true") await el.click();
    await expect(el).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
  }).toPass();
}

const findingId = async (page: Page, text: string) =>
  Number(await page.locator("#s-drafts [data-draft]").filter({ hasText: text }).getAttribute("data-draft"));

async function more(page: Page, item: string) {
  await page.locator("#more-btn").click();
  await page.getByRole("menuitem", { name: item }).click();
}

async function copyAll(page: Page) {
  await more(page, "Copy for your session…");
  await copyDialog(page)
    .getByRole("button", { name: /^Copy \d+ items$/ })
    .click();
  await expect(copyDialog(page)).toBeHidden();
}

test("Copy for your session: all groups on, counts and size, the remembered choice, and the IDs and code in the text", async ({ page }) => {
  await connect(page);
  await review(page);
  const blocker = await findingId(page, BLOCKER);
  await more(page, "Copy for your session…");
  const box = copyDialog(page);
  const group = (name: string) => box.getByRole("checkbox", { name: new RegExp(`^${name}`) });
  for (const g of ["Open reviewer comments", "Revido findings", "Your own open threads", "Resolved threads"])
    await expect(group(g)).toBeChecked();
  await expect(box.locator("[data-consult-group='reviewers']")).toContainText("Open reviewer comments3");
  await expect(box.locator("[data-consult-group='findings']")).toContainText("3");
  await expect(box.locator("[data-consult-group='resolved']")).toContainText("Context only. No verdict.");
  await expect(box.locator("#consult-size")).toHaveText(/^8 items, \d+\.\d KB\.$/);

  // The choice stays after a reload.
  await group("Resolved threads").uncheck();
  await expect(box.locator("#consult-size")).toHaveText(/^7 items, /);
  await page.reload();
  await openPr(page);
  await more(page, "Copy for your session…");
  await expect(group("Resolved threads")).not.toBeChecked();
  await expect(group("Open reviewer comments")).toBeChecked();
  await box.getByRole("button", { name: "Copy 7 items" }).click();
  await expect(box).toBeHidden();
  await expect(said(page)).toHaveText("Copied 7 items for your session. Paste its answer with Paste the answer.");
  await expect(page.locator("#more-btn")).toBeFocused();

  const text = await clipboard(page);
  expect(text).toContain("# Review points on my pull request PROJ1/sample-repo-4 #1004");
  expect(text).toContain("- Branch: fix/flush-lock into topic/sample-4");
  expect(text).toContain('{"id": "T123", "verdict": "accept"');
  expect(text).toContain("## Open reviewer comments: needs a verdict");
  for (const id of [LOCK, LOOP, OWN, INLINE]) expect(text).toContain(`### T${id}\n`);
  expect(text).not.toContain(`### T${DONE}`);
  expect(text).toContain(`### T${INLINE}\nSource: reviewer comment by`);
  expect(text).toContain("Place: src/cache/flush.ts:3, new side\nOutdated: yes. The code changed after this comment.");
  // The findings quote the code at the head from the review diff.
  const f = text.slice(text.indexOf(`### F${blocker}\n`));
  expect(f).toContain("Severity: Blocker.");
  expect(f).toContain("Outdated: no\nCode at the head commit");
  expect(f).toMatch(/> +3 [+ ] \| +const lock = cache\.lock\(\);/);
  expect(text).toContain("Release the lock in a `finally` block");
});

const answer = (blocker: number, minor: number) =>
  [
    "Here is my judgement of each point.",
    "",
    "```json",
    JSON.stringify(
      [
        { id: `T${LOCK}`, verdict: "reject", reason: "The finally block is already there." },
        { id: `T${LOOP}`, verdict: "question", reason: "Which writer?", reply: "Which writer do you mean?" },
        { id: `T${OWN}`, verdict: "accept", reason: "The README must say it." },
        { id: `F${blocker}`, verdict: "reject", reason: "Each entry is independent." },
        { id: `F${minor}`, verdict: "accept", reason: "A throw leaves the lock held." },
        { id: `T${DONE}`, verdict: "accept", reason: "Resolved anyway." },
        { id: "T42", verdict: "reject", reason: "No such thread." },
      ],
      null,
      2,
    ),
    "```",
    "",
    "Ask me if anything is unclear.",
  ].join("\n");

async function paste(page: Page) {
  const blocker = await findingId(page, BLOCKER);
  const minor = await findingId(page, MINOR);
  await copyAll(page);
  await more(page, "Paste the answer…");
  const box = pasteDialog(page);
  await box.getByLabel("Answer of your session").fill(answer(blocker, minor));
  await expect(box.locator("#consult-plan")).toHaveText("5 changes, 2 skipped.");
  return { box, blocker, minor };
}

test("Paste the answer: the preview, Apply makes reply drafts, discards, marks, and Fix list ticks, and nothing posts", async ({
  page,
}) => {
  await connect(page);
  await review(page);
  const { box, blocker, minor } = await paste(page);
  const row = (id: string) => box.locator(`[data-consult-row='${id}']`);
  await expect(row(`T${LOCK}`)).toContainText("Reply draft “Not valid” with the reason.");
  await expect(row(`T${LOOP}`)).toContainText("Reply draft “Question” with the reply text.");
  await expect(row(`T${OWN}`)).toContainText("Tick in the Fix list. Judgement “Valid”.");
  await expect(row(`F${blocker}`)).toContainText("Discard the finding. The reason stays on it.");
  await expect(row(`F${minor}`)).toContainText("Tick in the Fix list.");
  await expect(row(`T${DONE}`)).toContainText("Skipped. Resolved thread: context only. No change.");
  await expect(row("T42")).toContainText("Skipped. Unknown ID.");
  // Nothing changes before Apply.
  await expect(page.locator(`#t-${LOCK} [data-reply-draft]`)).toHaveCount(0);

  await box.getByRole("button", { name: "Apply 5 changes" }).click();
  await expect(box.locator("#consult-result")).toHaveText(
    "Applied. Made 3 reply drafts. Discarded 1 finding. Marked 1 finding. 2 items ticked for a fix.",
  );
  await box.getByRole("button", { name: "Open the Fix list (2 ticked)" }).click();
  const list = fixList(page);
  await expect(list.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await expect(list.getByRole("button", { name: "Propose fixes for 2" })).toBeVisible();
  await expect(list.getByRole("listitem").filter({ hasText: "Note to self" }).getByRole("checkbox")).toBeChecked();
  await expect(list.getByRole("listitem").filter({ hasText: MINOR }).getByRole("checkbox")).toBeChecked();
  await list.getByRole("button", { name: "Cancel" }).click();

  // The session drafts wait under their threads. The finding shows the verdict of the session.
  await openRow(page, `#th-${LOCK}`);
  const lock = page.locator(`#t-${LOCK} [data-reply-draft]`);
  await expect(lock).toHaveAccessibleName("Reply draft from your session to Alex Smith. Not valid.");
  await expect(lock).toContainText("The finally block is already there.");
  await expect(lock).toContainText("From your session.");
  const drafts = page.locator("#s-drafts");
  await expect(drafts.locator(`[data-draft='${blocker}']`)).toContainText("Rejected by your session");
  await openRow(page, `#dh-${minor}`);
  await expect(drafts.locator(`[data-draft='${minor}'] [data-session-note]`)).toHaveText(
    "Your session: Valid. A throw leaves the lock held.",
  );
  // The default ticks of the Fix list keep the accepts.
  await page.locator("#fix-btn").click();
  await expect(fixList(page).getByRole("listitem").filter({ hasText: "Note to self" }).getByRole("checkbox")).toBeChecked();
  await expect(fixList(page).getByRole("listitem").filter({ hasText: MINOR }).getByRole("checkbox")).toBeChecked();
  // The footer link opens the copy dialog.
  await fixList(page).getByRole("button", { name: "Copy for your session" }).click();
  await expect(fixList(page)).toBeHidden();
  await expect(copyDialog(page)).toBeVisible();
  await copyDialog(page).getByRole("button", { name: "Cancel" }).click();
});

test("Undo after Apply removes the session drafts, brings the finding back, and changes nothing on the forge", async ({ page }) => {
  await connect(page);
  await review(page);
  const { box, blocker } = await paste(page);
  await box.getByRole("button", { name: "Apply 5 changes" }).click();
  await expect(box.locator("#consult-result")).toBeVisible();
  await box.getByRole("button", { name: "Undo" }).click();
  await expect(box).toBeHidden();
  await expect(said(page)).toHaveText("Undone. Removed 3 reply drafts. Reset 2 findings.");
  await expect(page.locator(`#s-drafts [data-draft='${blocker}']`)).not.toContainText("Rejected by your session");
  await openRow(page, `#th-${LOCK}`);
  await expect(page.locator(`#t-${LOCK} [data-reply-draft]`)).toContainText("Discarded reply draft");
});

test("a paste that is not an answer shows the reason, and Apply stays off", async ({ page }) => {
  await connect(page);
  await more(page, "Paste the answer…");
  const box = pasteDialog(page);
  await expect(box.getByText("No copy from this browser. The app checks only the current state of each item.")).toBeVisible();
  await box.getByLabel("Answer of your session").fill('```json\n[{"id": "T1",]\n```');
  await expect(box.locator("#consult-answer-note")).toContainText("The json block is not a valid JSON array:");
  await expect(box.getByRole("button", { name: "Apply" })).toBeDisabled();
  await box.getByRole("button", { name: "Cancel" }).click();
  await expect(box).toBeHidden();
});

// ---------- Part C: ask the session directly ----------

const SESSION_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const sessionDialog = (page: Page) => page.getByRole("dialog", { name: "Ask your session" });
const answerDialog = (page: Page) => page.getByRole("dialog", { name: "Answer of your session" });

// Settings, Clones: the opt-in switch. Escape leaves Settings.
async function optIn(page: Page) {
  await page.locator("nav[aria-label='Views']").getByRole("button", { name: "Settings" }).click();
  const on = page.getByRole("region", { name: "Clones" }).getByRole("switch", { name: /^Let Revido find and consult your .+ sessions$/ });
  await expect(on).not.toBeChecked();
  await expect(page.locator("#sessions-on-help")).toContainText("It never shows or stores their message text.");
  await on.click();
  await expect(on).toBeChecked();
  await page.keyboard.press("Escape");
  await openPr(page);
}

test("Ask your session: off hides it; on lists the branch session with its cost, forks it in a run folder, previews, and applies", async ({
  page,
}) => {
  await connect(page);
  const canary = await sessions();
  // Off: no menu item and no link in the copy dialog.
  await page.locator("#more-btn").click();
  await expect(page.getByRole("menuitem", { name: "Copy for your session…" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Ask your session…" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await more(page, "Copy for your session…");
  await expect(copyDialog(page).getByRole("button", { name: "Ask your session instead…" })).toHaveCount(0);
  await copyDialog(page).getByRole("button", { name: "Cancel" }).click();

  await optIn(page);
  await control("claude", { stream: "session" });
  await more(page, "Ask your session…");
  const box = sessionDialog(page);
  // Only the session on the PR source branch shows. It is picked, with its folder, size, and token estimate.
  await expect(box.locator("[data-session]")).toHaveCount(1);
  const row = box.locator(`[data-session='${SESSION_ID}']`);
  await expect(row).toContainText("Fix the flush lock");
  await expect(row).toContainText(/sample-repo-4, last used 2 hours ago, \d+ B, about \d+ tokens/);
  await expect(row.getByRole("radio")).toBeChecked();
  await expect(box.locator("#session-cost")).toHaveText(
    /^The resume loads the whole history of this session: \d+ B, up to about \d+ tokens of your plan quota\. The review points add \d+\.\d KB\.$/,
  );
  await expect(box).not.toContainText(canary);
  await expect(box).not.toContainText("Other branch work");
  await box.getByRole("button", { name: "Ask the session" }).click();

  // The answer goes through the preview of part B. The fake session rejects each item that needs a verdict.
  const answer = answerDialog(page);
  await expect(answer.locator("#consult-plan")).toHaveText("4 changes, 0 skipped.", { timeout: RUN_MS });
  await expect(answer.locator(`[data-consult-row='T${LOCK}']`)).toContainText("Reply draft “Not valid” with the reason.");
  await expect(answer.locator(`[data-consult-row='T${LOCK}']`)).toContainText(`Reason: Echo: the session rejects T${LOCK}.`);
  await expect(answer.locator(`[data-consult-row='T${DONE}']`)).toHaveCount(0);
  // Nothing changes before Apply.
  await expect(page.locator(`#t-${LOCK} [data-reply-draft]`)).toHaveCount(0);
  await answer.getByRole("button", { name: "Apply 4 changes" }).click();
  await expect(answer.locator("#consult-result")).toHaveText("Applied. Made 4 reply drafts.");
  await answer.getByRole("button", { name: "Close" }).first().click();
  await openRow(page, `#th-${LOCK}`);
  await expect(page.locator(`#t-${LOCK} [data-reply-draft]`)).toContainText(`Echo: the session rejects T${LOCK}.`);

  // The run row keeps the answer. It names the session, not a profile.
  const run = page.locator("#runline [data-run-kind='session']");
  await expect(run).toHaveAttribute("data-run-state", "done");
  await expect(run).toContainText("Session done");
  await expect(run).toContainText("4 answers");
  await expect(run).toContainText("Fix the flush lock");
  await run.getByRole("button", { name: "Show the answer" }).click();
  await expect(answerDialog(page).locator("#consult-plan")).toBeVisible();
  await answerDialog(page).getByRole("button", { name: "Close" }).first().click();

  // The CLI forked the session file in a run folder, never in a clone, with the read tools only.
  // Gate B16 (d): the fork writes no transcript.
  const a = await runArgv();
  expect(a?.argv).toContain("--fork-session");
  expect(a?.argv[a.argv.indexOf("--resume") + 1]).toMatch(new RegExp(`${SESSION_ID}.jsonl$`));
  expect(a?.argv[a.argv.indexOf("--tools") + 1]).toBe("Read,Grep,Glob");
  expect(a?.argv).toContain("--no-session-persistence");
  // "." stands for the path separator of either OS.
  expect(a?.cwd).toMatch(/.runs.\d+.work$/);
  expect(a?.stdin).toContain(`### T${LOCK}\n`);
  expect(a?.stdin).toContain("## How to answer in this run");
  expect(a?.stdin).not.toContain(canary);
});

test("Ask your session: the copy dialog links to it; Cancel ends a running run; Ask again shows the list", async ({ page }) => {
  await connect(page);
  await sessions();
  await optIn(page);
  await control("claude", { stream: "session", hang: true });
  await more(page, "Copy for your session…");
  await copyDialog(page).getByRole("button", { name: "Ask your session instead…" }).click();
  const box = sessionDialog(page);
  await box.getByRole("button", { name: "Ask the session" }).click();
  await expect(box.locator("#session-state")).toHaveText("Your session is answering…");
  // The run takes the only slot. Its row shows it too.
  await expect(page.locator("#runline [data-run-kind='session']")).toHaveAttribute("data-run-state", "running");
  await box.getByRole("button", { name: "Cancel the run" }).click();
  await expect(box.getByText("The session run was cancelled.")).toBeVisible({ timeout: RUN_MS });
  await box.getByRole("button", { name: "Ask again" }).click();
  await expect(box.locator(`[data-session='${SESSION_ID}']`)).toBeVisible();
  await box.getByRole("button", { name: "Cancel" }).click();
  await expect(box).toBeHidden();
  await expect(page.locator("#runline [data-run-kind='session']")).toHaveAttribute("data-run-state", "cancelled");
});
