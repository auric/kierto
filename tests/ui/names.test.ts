// Plan v3 section 2: UI code holds no product name. GET /api/meta gives it.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const WEB = join(import.meta.dir, "../../src/web");
// The forge, runner, tracker, and tool names of the prototype modular boundaries (prototype/v3 FORGE, RUNNER, TRACKER).
const NAMES = /\b(bitbucket|claude|anthropic|jira|deepwiki|ms learn)\b/gi;

function hits(text: string): string[] {
  return [...text.matchAll(NAMES)].map((m) => m[0]);
}

describe("product names", () => {
  test("the pattern finds a name in any case", () => {
    expect(hits("<a>Open in Bitbucket</a> // claude -p, JIRA, MS Learn")).toEqual(["Bitbucket", "claude", "JIRA", "MS Learn"]);
    expect(hits("bitbucketish clauded")).toEqual([]);
  });

  test("no file in src/web names a forge, runner, or tracker product", () => {
    const files = readdirSync(WEB, { recursive: true, encoding: "utf8" }).filter((f) => /\.(tsx?|css|html)$/.test(f));
    expect(files.length).toBeGreaterThan(10);
    const found = files.flatMap((f) => {
      const lines = readFileSync(join(WEB, f), "utf8").split("\n");
      return lines.flatMap((l, i) => (hits(l).length ? [`${relative(WEB, join(WEB, f))}:${i + 1}: ${l.trim()}`] : []));
    });
    expect(found).toEqual([]);
  });
});
