// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Builds one self-contained executable per target with the UI embedded (BRIEF section 7, Distribution).
// Usage: bun scripts/compile.ts [--all]. Output: dist/bin/kierto-<os>-<arch>, with .exe on Windows.
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
export const HOST = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
export const ALL = ["windows-x64", "linux-x64", "linux-arm64"];

export const binPath = (target: string) => join(ROOT, "dist", "bin", `kierto-${target}${target.startsWith("windows") ? ".exe" : ""}`);

function run(cmd: string[]): string {
  const r = Bun.spawnSync(cmd, { cwd: ROOT, stdout: "pipe", stderr: "inherit" });
  if (r.exitCode !== 0) {
    console.error(`Failed (exit ${r.exitCode}): ${cmd.join(" ")}\n${r.stdout.toString()}`);
    process.exit(1);
  }
  return r.stdout.toString();
}

if (import.meta.main) {
  // --exclude=* ignores tags, so the value is always the commit hash, with -dirty for uncommitted changes.
  const commit = run(["git", "describe", "--always", "--dirty", "--abbrev=12", "--exclude=*"]).trim();
  process.stdout.write(run([process.execPath, "run", "build"]));
  for (const target of new Set([HOST, ...(process.argv.includes("--all") ? ALL : [])])) {
    process.stdout.write(
      run([
        process.execPath,
        "build",
        "--compile",
        "src/server/main.ts",
        // A worker needs its own entry point. --root keeps each worker at the path where rules.ts or jira.ts looks.
        "src/server/tasks/worker.ts",
        "src/server/context/markdown-worker.ts",
        "--root",
        "src/server",
        "--asset",
        "dist/web",
        // A .env or bunfig.toml file in the working folder must not change the app or its git MCP child.
        "--no-compile-autoload-dotenv",
        "--no-compile-autoload-bunfig",
        "--define",
        `REVIEW_LOOP_COMMIT=${JSON.stringify(commit)}`,
        `--target=bun-${target}`,
        "--outfile",
        binPath(target),
      ]),
    );
    console.log(`Built ${binPath(target)} (${commit}).`);
  }
}
