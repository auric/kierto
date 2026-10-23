// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The README screenshots of the demo (scripts/demo.ts): synthetic data, a fake Bitbucket, a fake Jira, and the fake CLI.
// Usage: bun run screenshots. It builds the UI, starts the demo on SHOTS_PORT (default 7419), and writes WebP files to docs/screenshots/.
// The demo gets its own temp folder, so the script can delete every file that the demo makes. The run log shows paths in it.
// So on Windows the folder is at the drive root, outside the user profile. SHOTS_TEMP sets another parent folder.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Locator, type Page } from "@playwright/test";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "docs", "screenshots");
const PORT = Number(process.env.SHOTS_PORT || 7419);
const BASE = `http://127.0.0.1:${PORT}`;
const START_MS = 60_000;
const RUN_MS = 60_000;
const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 400, height: 860 };

// Starts the demo and resolves when it prints its URL.
function startDemo(temp: string): Promise<ChildProcess> {
  const env = { ...process.env, DEMO_PORT: String(PORT), TEMP: temp, TMP: temp, TMPDIR: temp };
  const child = spawn("bun", ["scripts/demo.ts"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`The demo did not start in ${START_MS} ms.`)), START_MS);
    let out = "";
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
      if (out.includes(`demo: ${BASE}/`)) {
        clearTimeout(timer);
        ok(child);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`The demo exited with code ${code}:\n${out}`));
    });
  });
}

// Windows has no SIGTERM handler, so taskkill ends the demo and its children. The temp folder removal then cleans up.
async function stopDemo(child: ChildProcess) {
  if (child.exitCode !== null || !child.pid) return;
  const exited = new Promise((ok) => child.once("exit", ok));
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  else child.kill("SIGTERM");
  await Promise.race([exited, new Promise((ok) => setTimeout(ok, 10_000))]);
}

// Chromium encodes the PNG screenshot as WebP, so the script needs no image package.
let encoder: Page;
async function save(page: Page, name: string, clip?: Locator) {
  const png = clip ? await clip.screenshot() : await page.screenshot();
  const webp = await encoder.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
    return new Promise<string>((ok) => {
      const reader = new FileReader();
      reader.onload = () => ok(String(reader.result));
      reader.readAsDataURL(blob);
    });
  }, png.toString("base64"));
  const file = join(OUT, `${name}.webp`);
  writeFileSync(file, Buffer.from(webp.slice(webp.indexOf(",") + 1), "base64"));
  console.log(`${name}.webp ${Math.round(statSync(file).size / 1024)} KB`);
}

// Puts the element near the top of its scroll pane. The gap keeps it clear of the compact title row.
const toTop = (l: Locator, gap = 0) =>
  l.evaluate((e, gap) => {
    e.scrollIntoView({ block: "start" });
    let pane = e.parentElement;
    while (pane && pane.scrollHeight <= pane.clientHeight) pane = pane.parentElement;
    pane?.scrollBy({ top: -gap });
  }, gap);

const row = (page: Page, title: string) => page.locator("[data-row]", { hasText: title }).first();
const runRow = (page: Page, kind: string) => page.locator(`#runline [data-run-kind='${kind}']`);

async function openPr(page: Page, title: string) {
  await row(page, title).click();
  await page.locator("#s-threads").waitFor();
}

// Shift+R opens the brief. Ctrl+Enter starts the review. brief: a callback while the brief is open.
async function review(page: Page, brief?: () => Promise<void>) {
  await page.keyboard.press("Shift+R");
  const note = page.getByLabel("Your note");
  await note.waitFor();
  await brief?.();
  await note.press("Control+Enter");
  await runRow(page, "review").and(page.locator("[data-run-state='done']")).waitFor({ timeout: RUN_MS });
}

async function shots(browser: Browser) {
  const ctx = await browser.newContext({ viewport: WIDE, colorScheme: "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await openPr(page, "Take the cache lock");
  await review(page, async () => {
    await page.getByLabel("Your note").fill("Check the lock order in evict(). Callers hold the cache lock today.");
    await save(page, "brief");
  });
  // The review record: the plain-word ledger, the refuted points with their reasons, and the "Not checked" list. The list starts
  // open when the run has gaps.
  const gaps = runRow(page, "review").getByRole("button", { name: /^Not checked/ });
  if ((await gaps.getAttribute("aria-expanded")) !== "true") await gaps.click();
  await runRow(page, "review")
    .getByRole("button", { name: /refuted by the check/ })
    .click();
  await toTop(page.locator("#runline"), 64);
  await save(page, "review");
  // The Drafts list with its check chips and the open "Low confidence" fold.
  await page.getByRole("button", { name: /^Low confidence \(/ }).click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // The rows of the fold fade in (.rl-enter).
  await page.waitForTimeout(400);
  await toTop(page.locator("#s-drafts"), 64);
  await save(page, "drafts");
  await page.keyboard.press("3");
  await page.getByRole("dialog", { name: "Review run log" }).waitFor();
  // The log opens at its end. Its start shows the first agent and its calls.
  await page.locator("ol[aria-label='Tool calls']").evaluate((e) => e.scrollTo({ top: 0 }));
  await save(page, "run-log");
  await page.keyboard.press("Escape");
  // The hero: the inbox and the pull request with its review. The compact title row hides when the pane is back at the top.
  await page.keyboard.press("1");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(500);
  await save(page, "inbox-light");
  // A discard offers the reason chips on the card. One chip is picked.
  await page.locator("[data-draft]").first().getByRole("button", { name: "Discard" }).click();
  const chips = page.locator("[data-reason-chips]");
  await chips.getByRole("button", { name: "Not a bug" }).click();
  await chips.locator("[aria-pressed='true']").waitFor();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await toTop(page.locator("#s-drafts"), 64);
  await save(page, "discard-reason");

  // Fix it on my own PR: a review, reply drafts, then the Fix list.
  await openPr(page, "Release the write lock after each entry");
  await review(page);
  await page.locator("#replies-btn").click();
  await runRow(page, "reply").and(page.locator("[data-run-state='done']")).waitFor({ timeout: RUN_MS });
  await page.locator("#fix-btn").focus();
  await page.keyboard.press("Shift+F");
  const list = page.getByRole("dialog", { name: "Fix comments on your pull request" });
  await list.waitFor();
  await save(page, "fix-list");
  // The fix run of the two ticked threads. The first thread then shows its outcome line, its reply draft, and its fix card.
  await list.getByRole("button", { name: /^Propose fixes for / }).click();
  await runRow(page, "fix").and(page.locator("[data-run-state='done']")).waitFor({ timeout: RUN_MS });
  const head = page.locator("#th-2000");
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  await page.locator("#t-2000 [data-fix] [data-edit]").waitFor();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await toTop(page.locator("#t-2000"), 64);
  await save(page, "fix-thread");

  // Thread history: the resolved thread 3000 of my other PR, with its draft, my edit, the fix commit, the revision, the post, and
  // the resolve (scripts/demo.ts). Show changes opens the word diff of my edit.
  await openPr(page, "Replace the polling timer");
  await page.getByRole("button", { name: /^Show \d+ resolved$/ }).click();
  const resolved = page.locator("#th-3000");
  if ((await resolved.getAttribute("aria-expanded")) !== "true") await resolved.click();
  await page.locator("#t-3000").getByRole("button", { name: "More for this thread" }).click();
  await page.getByRole("menuitem", { name: "Show history" }).click();
  const history = page.locator("#hist-3000");
  await history.locator("[data-history-line]").first().waitFor();
  await history.getByRole("button", { name: "Show changes" }).click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await toTop(history, 120);
  await save(page, "thread-history");
  // PR notes (scripts/demo.ts): the Notes block with a kept note and a suggestion, and the draft card that cites another thread.
  await page.locator(`#s-notes [data-note-ref]`).waitFor();
  await toTop(page.locator("#s-notes"), 64);
  await save(page, "notes");
  const card = page.locator("#t-1000003 [data-reply-draft]");
  await card.locator("[data-note-suggestion]").waitFor();
  await toTop(page.locator("#t-1000003"), 64);
  await save(page, "reply-note");

  await page.goto(`${BASE}/settings/profiles`);
  await page.locator("#h-profiles").waitFor();
  await toTop(page.locator("#h-profiles"));
  await save(page, "settings-profiles");
  await page.goto(`${BASE}/settings/quality`);
  await page.locator("[data-stats-row]").first().waitFor();
  await toTop(page.locator("#h-quality"));
  await save(page, "settings-quality");
  await ctx.close();

  const narrow = await browser.newContext({ viewport: NARROW, colorScheme: "light", reducedMotion: "reduce" });
  const phone = await narrow.newPage();
  await phone.goto(`${BASE}/`);
  await row(phone, "Take the cache lock").waitFor();
  await save(phone, "narrow");
  await narrow.close();

  // The same view in the dark theme.
  const dark = await browser.newContext({ viewport: WIDE, colorScheme: "dark", reducedMotion: "reduce" });
  const night = await dark.newPage();
  await night.goto(`${BASE}/`);
  await openPr(night, "Take the cache lock");
  await night.keyboard.press("1");
  await night.waitForTimeout(500);
  await save(night, "inbox-dark");
  await dark.close();

  // Explain this PR (docs/plans/review-v2/spec.md section 3.1), after the inbox shots, so both of them show the same run record.
  // w opens the page, and its one button starts the run. The page shows the walkthrough with its diagram (scripts/demo.ts EXPLAIN).
  for (const scheme of ["light", "dark"] as const) {
    const c = await browser.newContext({ viewport: WIDE, colorScheme: scheme, reducedMotion: "reduce" });
    const p = await c.newPage();
    await p.goto(`${BASE}/`);
    await openPr(p, "Take the cache lock");
    await p.keyboard.press("w");
    // The dark page finds the stored walkthrough of the same head. Opening the page starts no run.
    if (scheme === "light") await p.locator("[data-explain] [data-primary]").click();
    await p.locator("[data-explain] figure[data-diagram='image'] img").waitFor({ timeout: RUN_MS });
    await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await save(p, `explain-${scheme}`);
    await c.close();
  }
}

mkdirSync(OUT, { recursive: true });
const parent = process.env.SHOTS_TEMP || (process.platform === "win32" ? `${process.env.SystemDrive || "C:"}\\` : tmpdir());
const temp = mkdtempSync(join(parent, "pr-review-inbox-shots-"));
let demo: ChildProcess | undefined;
let browser: Browser | undefined;
try {
  demo = await startDemo(temp);
  browser = await chromium.launch();
  encoder = await (await browser.newContext()).newPage();
  await shots(browser);
} finally {
  await browser?.close();
  if (demo) await stopDemo(demo);
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
