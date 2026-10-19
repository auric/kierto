// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Builds and tests a release. Usage: bun scripts/release.ts [--allow-dirty] [--skip-e2e].
// Output: dist/release/<version>-<commit>/ with one binary per target, a SHA256SUMS file, and the license files.
import { copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import pkg from "../package.json";
import { ALL, binPath, HOST } from "./compile";

const ROOT = resolve(import.meta.dir, "..");
// AGPL-3.0 section 6 and the MIT notices: each binary goes out with these texts.
const LEGAL = ["LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"];

export const artifactName = (version: string, target: string) => `kierto-${version}-${target}${target.startsWith("windows") ? ".exe" : ""}`;

// `sha256sum` text-mode line: hash, two spaces, file name.
export const sumsLine = (sha256: string, name: string) => `${sha256}  ${name}\n`;

function fail(step: string, detail: string): never {
  console.error(`\nRELEASE FAILED at step "${step}": ${detail}`);
  process.exit(1);
}

function git(args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) fail("git", `git ${args.join(" ")}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString().trimEnd();
}

async function step(name: string, cmd: string[]) {
  console.log(`\n=== ${name}: ${cmd.join(" ")}`);
  const code = await Bun.spawn(cmd, { cwd: ROOT, stdio: ["inherit", "inherit", "inherit"] }).exited;
  if (code !== 0) fail(name, `exit code ${code}`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const bun = process.execPath;
  const dirty = git(["status", "--porcelain"]);
  if (dirty && !args.includes("--allow-dirty"))
    fail("clean tree", `the working tree has changes. Commit them or pass --allow-dirty.\n${dirty}`);
  const commit = git(["rev-parse", "--short=12", "HEAD"]) + (dirty ? "-dirty" : "");
  console.log(`Release ${pkg.version} from commit ${commit}`);

  // An old host binary makes the compiled-binary test in `check` fail as stale.
  rmSync(join(ROOT, "dist", "bin"), { recursive: true, force: true });
  await step("check", [bun, "run", "check"]);
  await step("third-party notices", [bun, "scripts/notices.ts", "--check"]);
  if (args.includes("--skip-e2e")) console.warn("\n!!! WARNING: --skip-e2e: the browser acceptance tests DID NOT RUN. !!!\n");
  else await step("test:e2e", [bun, "run", "test:e2e"]);
  await step("compile", [bun, "scripts/compile.ts", "--all"]);
  await step("compiled binary test", [bun, "test", "tests/build/compiled.test.ts"]);

  const out = join(ROOT, "dist", "release", `${pkg.version}-${commit}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const names: string[] = [];
  let sums = "";
  for (const target of new Set([HOST, ...ALL])) {
    const name = artifactName(pkg.version, target);
    copyFileSync(binPath(target), join(out, name));
    const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(join(out, name)).arrayBuffer()).digest("hex");
    sums += sumsLine(hash, name);
    names.push(name);
  }
  await Bun.write(join(out, "SHA256SUMS"), sums);
  for (const name of LEGAL) copyFileSync(join(ROOT, name), join(out, name));

  console.log(`\nRelease ${pkg.version} (${commit}) in ${relative(ROOT, out)}:`);
  for (const name of [...names, "SHA256SUMS", ...LEGAL])
    console.log(`  ${name.padEnd(44)} ${statSync(join(out, name)).size.toLocaleString("en-US").padStart(14)} bytes`);
}
