// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The eval cases of fixtures/eval (docs/plans/review-v2/spec.md section 4.3) and the temp git repository of one case.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import { parseDiff } from "../../src/server/review/diffmap";
import { git, gitEnv } from "../../src/server/review/git";
import { severities } from "../../src/shared/review";

const EVAL_DIR = resolve(import.meta.dir, "../../fixtures/eval");
// v1: the 12 cases of the first baseline. hard: bugs that need unchanged code, bigger diffs, more traps, and cases with no bug.
export const SETS = { v1: join(EVAL_DIR, "cases"), hard: join(EVAL_DIR, "hard") } as const;
export type EvalSet = keyof typeof SETS;
export const CASES_DIR = SETS.v1;
const CASE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// spec.md section 1.3: core and the module IDs.
export const MODULE_IDS = [
  "core",
  "security",
  "concurrency",
  "performance",
  "tests",
  "api",
  "docs",
  "simplify",
  "rules",
  "intent",
] as const;
export const LANGUAGES = ["typescript", "cpp", "python"] as const;

const range = z
  .tuple([z.number().int().min(1), z.number().int().min(1)])
  .refine(([s, e]) => s <= e, "The first line is after the last line.");
const spot = { path: z.string().min(1), side: z.enum(["new", "old"]), lines: range };
// alt: other places of the same bug or trap, such as a declaration and its definition, or a caller and its changed callee.
const place = { id: z.string().min(1), ...spot, alt: z.array(z.object(spot)).min(1).optional() };
export const evalBug = z.object({ ...place, severityMin: z.enum(severities), module: z.enum(MODULE_IDS), note: z.string().min(1) });
export const evalTrap = z.object({ ...place, why: z.string().min(1) });
// A real issue that is no seeded bug. A shown item on it counts for no metric but extras.
export const evalExtra = z.object({ ...spot, note: z.string().min(1) });
// tests/eval/harness.test.ts checks the bug, trap, and line counts of each set.
export const caseFile = z.object({
  id: z.string().regex(CASE_ID),
  title: z.string().min(1),
  language: z.enum(LANGUAGES),
  pr: z.object({ title: z.string().min(1), description: z.string() }),
  task: z.string().optional(),
  instructions: z.string().optional(),
  bugs: z.array(evalBug).max(3),
  traps: z.array(evalTrap).min(1).max(4),
  extras: z.array(evalExtra).optional(),
});
export type EvalBug = z.infer<typeof evalBug>;
export type EvalTrap = z.infer<typeof evalTrap>;
export type EvalExtra = z.infer<typeof evalExtra>;
export type CaseFile = z.infer<typeof caseFile>;
// base: the files of base/ by repository path. changedLines: added and removed lines of head.patch.
export type EvalCase = CaseFile & { dir: string; base: Map<string, string>; patch: string; changedLines: number };

const files = (root: string, dir = root): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(root, p) : [relative(root, p).replaceAll("\\", "/")];
  });

export const changedLines = (patch: string) => parseDiff(patch).reduce((n, f) => n + f.rows.filter((r) => r.kind !== "ctx").length, 0);

// Claude Code loads these files as instructions when a session reads files in their folder. A case stores each one with
// FIXTURE_SUFFIX, so the fixtures never steer a session in this repository. buildRepo writes it under its real name.
export const INSTRUCTION_FILE = /^(CLAUDE\.md|CLAUDE\.local\.md|AGENTS\.md)$/i;
export const FIXTURE_SUFFIX = ".fixture";

export function loadCase(dir: string): EvalCase {
  const c = caseFile.parse(JSON.parse(readFileSync(join(dir, "case.json"), "utf8")));
  const folder = dir.replaceAll("\\", "/").split("/").at(-1);
  if (c.id !== folder) throw new Error(`Case ${c.id} is in the folder ${folder}.`);
  const baseDir = join(dir, "base");
  const base = new Map(
    files(baseDir).map((p) => {
      const name = (q: string) => q.split("/").at(-1) ?? "";
      if (INSTRUCTION_FILE.test(name(p))) throw new Error(`Case ${c.id}: store ${p} as ${p}${FIXTURE_SUFFIX}.`);
      const real = p.slice(0, -FIXTURE_SUFFIX.length);
      return [p.endsWith(FIXTURE_SUFFIX) && INSTRUCTION_FILE.test(name(real)) ? real : p, readFileSync(join(baseDir, p), "utf8")];
    }),
  );
  if (!base.size) throw new Error(`Case ${c.id} has no base files.`);
  const patch = readFileSync(join(dir, "head.patch"), "utf8");
  return { ...c, dir, base, patch, changedLines: changedLines(patch) };
}

// ids: case IDs, or "all". The order is the folder order.
export function loadCases(ids: string, root = CASES_DIR): EvalCase[] {
  const all = readdirSync(root)
    .filter((f) => existsSync(join(root, f, "case.json")))
    .sort();
  if (ids === "all") return all.map((f) => loadCase(join(root, f)));
  const want = ids.split(",").map((s) => s.trim());
  const unknown = want.filter((id) => !all.includes(id));
  if (unknown.length) throw new Error(`Unknown case: ${unknown.join(", ")}. Known cases: ${all.join(", ")}.`);
  return all.filter((f) => want.includes(f)).map((f) => loadCase(join(root, f)));
}

// The current fixture of a case ID in any set, or null.
export function findCase(id: string): EvalCase | null {
  if (!CASE_ID.test(id)) return null;
  const dir = Object.values(SETS)
    .map((s) => join(s, id))
    .find((d) => existsSync(join(d, "case.json")));
  return dir ? loadCase(dir) : null;
}

// A fixed identity and date, so a case gives the same commits on each run.
const AUTHOR = {
  GIT_AUTHOR_NAME: "Eval Author",
  GIT_AUTHOR_EMAIL: "eval@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_NAME: "Eval Author",
  GIT_COMMITTER_EMAIL: "eval@example.invalid",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

// A bare repository in root: main holds the base commit, feature and refs/pull-requests/1/from hold base plus head.patch.
// The git config is isolated, so no user filter or hook changes the files.
export async function buildRepo(c: Pick<EvalCase, "base" | "dir" | "pr">, root: string) {
  const empty = join(root, "empty.gitconfig");
  writeFileSync(empty, "");
  const url = join(root, "remote.git");
  const env = { ...gitEnv(empty), ...AUTHOR, GIT_INDEX_FILE: join(root, "eval.index") };
  const g = async (args: string[], stdin?: string) => (await git(["--git-dir", url, ...args], { env, stdin })).trim();
  await git(["init", "-q", "--bare", "--template=", url], { env });
  const entries = [...c.base.entries()];
  const blobs = entries.map(([, text], i) => {
    const f = join(root, `blob-${i}`);
    writeFileSync(f, text);
    return f;
  });
  const shas = (await g(["hash-object", "-w", "--no-filters", "--stdin-paths"], `${blobs.join("\n")}\n`)).split("\n");
  await g(["update-index", "--index-info"], `${entries.map(([p], i) => `100644 ${shas[i]}\t${p}`).join("\n")}\n`);
  const base = await g(["commit-tree", await g(["write-tree"]), "-m", "base"]);
  await g(["apply", "--cached", "--whitespace=nowarn", join(c.dir, "head.patch")]);
  const head = await g(["commit-tree", await g(["write-tree"]), "-p", base, "-m", c.pr.title]);
  for (const [ref, sha] of [
    ["refs/heads/main", base],
    ["refs/heads/feature", head],
    ["refs/pull-requests/1/from", head],
  ] as const)
    await g(["update-ref", ref, sha]);
  // The file text of a commit, for checks of the case lines.
  const show = (commit: string, path: string) => git(["--git-dir", url, "show", `${commit}:${path}`], { env });
  return { url, base, head, env, show };
}
