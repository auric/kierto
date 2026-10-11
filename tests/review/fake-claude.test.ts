// The fake CLI picks its result from the --json-schema shape (plan r2 WP0). No test starts the real CLI.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askJsonSchema, askResult, rereviewJsonSchema, rereviewResult, reviewJsonSchema } from "../../src/shared/review";
import type { FakeScenario } from "../support/fake-claude";
import { claudeStream, REVIEW_RESULT } from "../support/review-fixture";

const FAKE = join(import.meta.dir, "../support/fake-claude.ts");
const dir = mkdtempSync(join(tmpdir(), "rl-fake-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
const fixture = claudeStream(dir, "tree", "claude/b9-wp8-flags.jsonl", REVIEW_RESULT);

const STDIN = [
  "# Task",
  "",
  "Answer the question about the change in ./repo.",
  "",
  "Earlier findings: 5, 9, 12, 14",
  "",
  "# Your instructions",
  "",
  "The user wrote the text below.",
  "",
  "Why does flush() lock each entry?",
  "",
  "# Metadata",
  "",
  "- Pull request: PROJ/repo#2",
  "",
].join("\n");

let n = 0;
// Runs the fake CLI once. Returns the init tools and the structured_output of the result.
async function run(schema: Record<string, unknown>, tools: string, extra: Partial<FakeScenario> = {}) {
  const scenario = join(dir, `scenario-${n++}.json`);
  writeFileSync(
    scenario,
    JSON.stringify({
      record: join(dir, "calls.jsonl"),
      auth: { loggedIn: true, authMethod: "claude.ai", projectsDirectory: join(dir, "projects") },
      fixture,
      delayMs: 0,
      ...extra,
    } satisfies FakeScenario),
  );
  const p = Bun.spawn([process.execPath, FAKE, scenario, "-p", "--json-schema", JSON.stringify(schema), "--tools", tools], {
    cwd: dir,
    stdin: new Blob([STDIN]),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  });
  const out = await new Response(p.stdout).text();
  expect(await p.exited).toBe(0);
  const events = out
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const result = events.find((e) => e.type === "result");
  return { tools: init?.tools as string[], output: result?.structured_output as Record<string, unknown> };
}

describe("fake CLI", () => {
  test("a review schema keeps the fixture result, and init keeps Task with the Agent tool", async () => {
    const r = await run(reviewJsonSchema(), "Read,Grep,Glob,Agent");
    expect(r.output).toEqual(REVIEW_RESULT);
    expect(r.tools).toContain("Task");
  });

  test("a re-review schema echoes one verdict per earlier finding; init drops Task without the Agent tool", async () => {
    const r = await run(rereviewJsonSchema(), "Read,Grep,Glob");
    expect(rereviewResult.safeParse(r.output).success).toBe(true);
    expect(r.output.summary).toBe(REVIEW_RESULT.summary);
    expect(r.output.findings).toEqual([]);
    const earlier = r.output.earlier as { id: number; status: string; path: unknown; line: unknown }[];
    expect(earlier.map((v) => [v.id, v.status, v.path, v.line])).toEqual([
      [5, "open", null, null],
      [9, "fixed", null, null],
      [12, "outdated", null, null],
      [14, "open", null, null],
    ]);
    expect(r.tools).not.toContain("Task");

    const fixed = { ...REVIEW_RESULT, findings: [], earlier: [] };
    expect((await run(rereviewJsonSchema(), "Read", { rereview: fixed })).output).toEqual(fixed);
  });

  test("an ask schema echoes the question line", async () => {
    const r = await run(askJsonSchema(), "Read,Grep,Glob");
    expect(askResult.safeParse(r.output).success).toBe(true);
    expect(r.output.answer).toBe("Echo: Why does flush() lock each entry?");
    expect(r.tools).not.toContain("Task");

    const answer = { answer: "Fixed.", coverage: { read: [], skipped: [], unavailable: [], notChecked: [] } };
    expect((await run(askJsonSchema(), "Read", { answer })).output).toEqual(answer);
  });
});
