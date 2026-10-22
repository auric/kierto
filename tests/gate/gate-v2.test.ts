// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Argument parsing and dry-run output of the review v2 gate scripts (docs/gate-v2.md). No test starts claude or reaches a server.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const CLAUDE_CHECKS = join(ROOT, "scripts/gate/claude-checks.ts");
const BITBUCKET_WRITE = join(ROOT, "scripts/gate/bitbucket-write.ts");
// An empty PATH folder: the claude-checks dry run then finds no claude and runs no CLI at all.
const NO_TOOLS = mkdtempSync(join(tmpdir(), "rl-gate-test-path-"));
const GIT_DIR = dirname(Bun.which("git") ?? "git");
const REPO = "https://example.invalid/projects/TEST/repos/test-repo";

afterAll(() => rmSync(NO_TOOLS, { recursive: true, force: true }));

function run(script: string, args: string[], path: string) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k.toUpperCase() !== "PATH") env[k] = v;
  // A set token keeps the OS secret store out of every test.
  Object.assign(env, { PATH: path, GATE_BITBUCKET_TOKEN: "test-token" });
  const r = Bun.spawnSync([process.execPath, script, ...args], { cwd: ROOT, env, stdout: "pipe", stderr: "pipe", timeout: 120_000 });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

describe("claude-checks.ts B17 to B20", () => {
  test("a dry run takes bare check IDs and prints the planned argv within the caps", () => {
    const r = run(CLAUDE_CHECKS, ["--dry-run", "B17", "B18", "B19", "B20"], NO_TOOLS);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    for (const [id, calls] of [
      ["B17", 1],
      ["B18", 1],
      ["B19", 1],
      ["B20", 5],
    ] as const)
      expect(r.out).toContain(`DRY-RUN  ${id.padEnd(4)} calls=${calls}`);
    expect(r.out).toContain("B17 1/1, B18 1/1, B19 1/1, B20 5/5");
    const b17 = r.out.split("\n").find((l) => l.startsWith("dry-run b17-write-confinement:")) ?? "";
    expect(b17).toContain('"--tools","Read,Grep,Glob,Edit,Write","--allowedTools","Read,Grep,Glob,Edit,Write"');
    expect(b17).toContain('"--restricted","--strict-mcp-config"');
    expect(b17).not.toContain("--permission-mode");
    expect(r.out).toMatch(/dry-run b18-verify-effort: .*"--effort","medium"/);
    for (const tag of ["explain", "discuss", "interview", "spec", "implement"]) expect(r.out).toContain(`dry-run b20-${tag}:`);
    expect(r.out).not.toContain(process.env.USERPROFILE ?? process.env.HOME ?? "<no home>");
  });

  test("--only takes lower-case IDs and runs only those", () => {
    const r = run(CLAUDE_CHECKS, ["--only=b19", "--dry-run"], NO_TOOLS);
    expect(r.code).toBe(0);
    expect(r.out).toContain("DRY-RUN  B19");
    expect(r.out).not.toContain("DRY-RUN  B17");
  });

  test("an unknown check exits 2 with the usage", () => {
    const r = run(CLAUDE_CHECKS, ["--dry-run", "B21"], NO_TOOLS);
    expect(r.code).toBe(2);
    expect(r.err).toContain("unknown check: B21");
    expect(r.err).toContain("usage:");
  });
});

describe("bitbucket-write.ts G1 to G7", () => {
  test("a dry run passes all checks against the loopback fake and prints no host", () => {
    const r = run(BITBUCKET_WRITE, ["--dry-run"], GIT_DIR);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    for (const id of ["G1", "G2", "G3", "G4", "G5", "G6"]) expect(r.out).toContain(`PASS    ${id} `);
    expect(r.out).toContain("INFO    G7 ");
    expect(r.out).toContain("(stale info)");
    expect(r.out).toContain("dry run: PASS");
    expect(r.out).not.toContain("127.0.0.1");
    expect(r.out).not.toContain(tmpdir());
  }, 120_000);

  test("a dry run of one check sets up only what it needs", () => {
    const r = run(BITBUCKET_WRITE, ["--dry-run", "--only", "G6"], GIT_DIR);
    expect(r.code).toBe(0);
    expect(r.out).toContain("PASS    G6 ");
    expect(r.out).not.toContain("G1 ");
  }, 120_000);

  test.each([
    [[], "--repo is required"],
    [["--repo", REPO, "--target", "main"], "Refused: this script creates branches"],
    [["--repo", REPO, "--target", "main", "--authorize-writes", "G2"], "G2 needs --reviewer"],
    [["--repo", REPO, "--target", "main", "--authorize-writes", "G7", "--jira-key", "lower-1"], "G7 needs --jira-key"],
    [["--repo", REPO, "--authorize-writes", "G1"], "--target is required"],
    [["--repo", REPO, "--target", "rl-gate-x", "--authorize-writes"], "--target is not a usable branch name"],
    [["--repo", "https://example.invalid/browse", "--target", "main", "--authorize-writes"], "--repo is not a repository URL"],
    [["--dry-run", "G9"], "unknown check: G9"],
    [["--dry-run", "--bogus"], "unknown argument: --bogus"],
  ])("refuses %j before any request", (args, message) => {
    const r = run(BITBUCKET_WRITE, args, GIT_DIR);
    expect(r.code).toBe(2);
    expect(r.err).toContain(message);
    expect(r.out).toBe("");
  });
});
