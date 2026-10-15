// Project instructions: the Settings block per repository, the preview, the warning for a ticked file that is gone, and the run inputs.
// Runs against serve.ts only: the fake Bitbucket with the author PR 1004, a temp clone, and the fake CLI.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import { APP_PORT, control, E2E_TOKEN, FAKE_URL, makeClone } from "./control";

const APP = `http://127.0.0.1:${APP_PORT}`;
const TITLE = "Release the write lock after each entry";
const REPO = "PROJ1/sample-repo-4";
const RUN_MS = 60_000;

const test = base.extend<{ seen: { urls: string[]; logs: string[] } }>({
  seen: [
    async ({ context }, use) => {
      const seen = { urls: [] as string[], logs: [] as string[] };
      context.on("request", (r) => seen.urls.push(r.url()));
      context.on("console", (m) => seen.logs.push(m.text()));
      await control("reset");
      await use(seen);
      expect(seen.urls.filter((u) => !u.startsWith(`${APP}/`))).toEqual([]);
      expect(seen.logs.filter((l) => l.includes(E2E_TOKEN))).toEqual([]);
    },
    { auto: true },
  ],
});

async function connect(page: Page) {
  await page.goto("/");
  await page.getByLabel("Bitbucket URL").fill(FAKE_URL);
  await page.getByLabel("Access token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Access token")).toBeHidden();
  await control("state", { author: true });
  await page.locator("[data-row]", { hasText: TITLE }).first().click();
  await expect(page.locator("section[aria-label='Details'] h1")).toHaveText(TITLE);
}

// The clone folder goes in through the clone route of the page session, as the Apply dialog sends it.
async function setClone(page: Page, path: string) {
  const status = await page.evaluate(
    async ({ repo, path }) => {
      const headers = {
        "content-type": "application/json",
        "X-RL-Session": document.querySelector<HTMLMetaElement>('meta[name="rl-session"]')?.content ?? "",
      };
      const rows = (await (await fetch("/api/instructions", { headers })).json()) as { project: string; repo: string; pr: number }[];
      const row = rows.find((r) => `${r.project}/${r.repo}` === repo);
      return (await fetch(`/api/prs/${row?.pr}/clone`, { method: "PUT", headers, body: JSON.stringify({ path }) })).status;
    },
    { repo: REPO, path },
  );
  expect(status).toBe(200);
}

test("Settings: tick a clone file, see the preview and the warning for a gone file; the run line lists the instruction files", async ({
  page,
}) => {
  await connect(page);
  const clone = await makeClone(1004);
  writeFileSync(join(clone, "CLAUDE.local.md"), "LOCAL-E2E-CANARY: keep each lock short.\n");
  await setClone(page, clone);

  await page.locator("nav[aria-label='Views']").getByRole("button", { name: "Settings" }).click();
  const section = page.getByRole("region", { name: "Project instructions" });
  const row = section.locator(`[data-instructions='${REPO}']`);
  await expect(row).toContainText("target branch");
  await row.locator("summary").click();
  await expect(row).toContainText(clone);
  await expect(row.getByRole("switch", { name: "Committed CLAUDE.md from the target branch" })).toBeChecked();
  const local = row.getByRole("checkbox", { name: "CLAUDE.local.md" });
  await expect(local).not.toBeChecked();
  // The clone checks out the PR head, which has no CLAUDE.md, so only the local file shows.
  await expect(row.getByRole("checkbox")).toHaveCount(1);
  const preview = row.locator("[data-instructions-preview]");
  await expect(preview).toContainText("Read at");

  await local.check();
  await expect(row.getByRole("status")).toHaveText("Saved. The next run uses it.");
  await row.getByLabel("Extra text (optional)").fill("EXTRA-E2E-CANARY");
  await row.getByLabel("Extra text (optional)").blur();
  await expect(preview).toContainText(/A run gets .+ from 2 sources/);
  await preview.getByText("Show the text").click();
  await expect(preview.locator("pre")).toContainText("## From your clone: CLAUDE.local.md");
  await expect(preview.locator("pre")).toContainText("LOCAL-E2E-CANARY");
  await expect(preview.locator("pre")).toContainText("## From Review Loop settings");

  // A ticked file that is gone gets a warning. The text change reads the sources again.
  rmSync(join(clone, "CLAUDE.local.md"));
  await row.getByLabel("Extra text (optional)").fill("EXTRA-E2E-CANARY 2");
  await row.getByLabel("Extra text (optional)").blur();
  await expect(row.locator("[data-instructions-missing]")).toHaveText("The clone does not have CLAUDE.local.md. Runs leave it out.");
  await expect(local).toBeChecked();
  // Prose such as "@team" is no import. A path that does not exist is a warning of the run, not a coverage gap.
  writeFileSync(join(clone, "CLAUDE.local.md"), "LOCAL-E2E-CANARY: ask @team. See @docs/missing.md\n");
  await row.getByLabel("Extra text (optional)").fill("EXTRA-E2E-CANARY");
  await row.getByLabel("Extra text (optional)").blur();
  await expect(row.locator("[data-instructions-missing]")).toHaveCount(0);
  await expect(preview).toContainText(
    "Not loaded: @docs/missing.md, imported by CLAUDE.local.md from your clone (the file does not exist)",
  );
  await expect(preview.locator("p", { hasText: "Not loaded:" })).toHaveCount(1);

  // A run reads the sources again and lists them in its inputs and its log.
  await page.keyboard.press("Escape");
  await page.locator("[data-row]", { hasText: TITLE }).first().click();
  await control("claude", { stream: "tree" });
  await page.getByRole("button", { name: /^Draft replies · / }).click();
  const reply = page.locator("#runline [data-run-kind='reply']");
  await expect(reply).toHaveAttribute("data-run-state", "done", { timeout: RUN_MS });
  const inputs = reply.locator("[data-run-instructions]");
  await expect(inputs).toContainText("CLAUDE.md, CLAUDE.local.md, your text");
  await expect(inputs).toHaveAttribute("title", /CLAUDE\.md from the target branch/);
  await reply.getByRole("button", { name: "Log of the reply drafts run" }).click();
  const log = page.getByRole("dialog", { name: "Reply drafts run log" });
  await expect(log.locator("footer [data-run-instructions]")).toContainText("Project instructions: CLAUDE.md, CLAUDE.local.md, your text");
  const missed = "Not loaded: @docs/missing.md, imported by CLAUDE.local.md from your clone (the file does not exist)";
  await expect(log.locator("footer [data-run-not-loaded]")).toHaveText(missed);
  await page.keyboard.press("Escape");
  await expect(reply.locator("[data-run-not-loaded]")).toHaveText(missed);
  await expect(reply).not.toContainText("incomplete");
});

test("Settings: the global switch adds the global file to every preview and to the run inputs; it stays on after a reload", async ({
  page,
}) => {
  await connect(page);
  await page.locator("nav[aria-label='Views']").getByRole("button", { name: "Settings" }).click();
  const section = page.getByRole("region", { name: "Project instructions" });
  const global = section.getByRole("switch", { name: "Use your global CLAUDE.md" });
  await expect(global).not.toBeChecked();
  await expect(section.locator("[data-instructions-global]")).toContainText("CLAUDE.md and its imports before the other sources");
  const row = section.locator(`[data-instructions='${REPO}']`);
  await row.locator("summary").click();
  const preview = row.locator("[data-instructions-preview]");
  await expect(preview).toContainText("Read at");
  await expect(preview).not.toContainText("2 sources");

  await global.click();
  await expect(global).toBeChecked();
  await expect(preview).toContainText(/A run gets .+ from 2 sources/);
  await expect(row.locator("summary").first()).toContainText("global file");
  await preview.getByText("Show the text").click();
  const pre = preview.locator("pre");
  await expect(pre).toContainText("## From your global Claude Code settings: CLAUDE.md");
  await expect(pre).toContainText("## From your global Claude Code settings: rules/locks.md (imported by CLAUDE.md)");
  await expect(pre).toContainText("GLOBAL-IMPORT-E2E-CANARY");

  // The reload keeps the settings URL, so Settings opens again by itself (plan pr-view-v4 section 5).
  await page.reload();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(
    page.getByRole("region", { name: "Project instructions" }).getByRole("switch", { name: "Use your global CLAUDE.md" }),
  ).toBeChecked();

  // A run lists the global file in its inputs and its log.
  await page.keyboard.press("Escape");
  await page.locator("[data-row]", { hasText: TITLE }).first().click();
  await control("claude", { stream: "tree" });
  await page.getByRole("button", { name: /^Draft replies · / }).click();
  const reply = page.locator("#runline [data-run-kind='reply']");
  await expect(reply).toHaveAttribute("data-run-state", "done", { timeout: RUN_MS });
  const inputs = reply.locator("[data-run-instructions]");
  await expect(inputs).toContainText("global CLAUDE.md, global rules/locks.md");
  await expect(inputs).toHaveAttribute("title", /CLAUDE\.md from your global settings/);
  await reply.getByRole("button", { name: "Log of the reply drafts run" }).click();
  const log = page.getByRole("dialog", { name: "Reply drafts run log" });
  await expect(log.locator("footer [data-run-instructions]")).toContainText(
    "Project instructions: global CLAUDE.md, global rules/locks.md",
  );
});
