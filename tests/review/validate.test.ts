// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type DiffFile, parseDiff } from "../../src/server/review/diffmap";
import { MAX_FILE_CHARS, repoPath, type ValidateInput, validate } from "../../src/server/review/validate";
import { type Finding, MAX_FINDINGS, moveChoices, type ReviewResult, reviewJsonSchema, reviewResult } from "../../src/shared/review";

const range = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i + 1));
const text = (lines: string[], eol = "\n") => lines.map((l) => l + eol).join("");

const A = range(30, (i) => `const a${i} = ${i};`);
const R = range(20, (i) => `const r${i} = ${i};`);
const TIE = ["a();", "dup();", "b();", "c();", "d();", "dup();", "e();"];

// Base and head trees. Each scenario of the tests sits in its own file.
const BASE: Record<string, string> = {
  "src/a.ts": text(A),
  "src/same.ts": text(["one();", "two();", "three();", "four();"]),
  "src/old-name.ts": text(R),
  "src/crlf.ts": text(["first", "second", "third"], "\r\n"),
  "src/gone.ts": text(["bye();"]),
  "db/schema.sql": text(["-- old note", "select 1;"]),
  "src/naïve file.ts": text(["x = 1"]),
  "src/nonl.ts": "a\nb",
};
const HEAD: Record<string, string> = {
  "src/a.ts": text([...A.slice(0, 9), "const a10 = 100;", "const a10b = 101;", ...A.slice(10)]),
  "src/same.ts": BASE["src/same.ts"] as string,
  "src/new-name.ts": text(R.map((l, i) => (i === 4 ? "const r5 = 50;" : l))),
  "src/crlf.ts": text(["first", "second changed", "third"], "\r\n"),
  "db/schema.sql": text(["++ new", "select 1;"]),
  "src/naïve file.ts": text(["x = 2"]),
  "src/nonl.ts": "a\nc",
  "src/tie.ts": text(TIE),
};

let dir = "";
let diff = "";
let files: DiffFile[] = [];

// The diff comes from real git, the oracle for the format.
function git(cwd: string, env: Record<string, string>, ...args: string[]) {
  const r = Bun.spawnSync(["git", "-c", "core.autocrlf=false", "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
    cwd,
    env,
  });
  if (r.exitCode !== 0) throw new Error(`git ${args[0]}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

function writeTree(root: string, tree: Record<string, string>) {
  for (const [p, c] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rl-wp9-"));
  const repo = join(dir, "repo");
  mkdirSync(repo);
  const globalCfg = join(dir, "gitconfig");
  writeFileSync(globalCfg, "");
  const env: Record<string, string> = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: globalCfg, GIT_TERMINAL_PROMPT: "0" };
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_") && v !== undefined) env[k] ??= v;
  git(repo, env, "init", "-q");
  writeTree(repo, BASE);
  writeFileSync(join(repo, "img.bin"), new Uint8Array([0, 1, 2, 0]));
  git(repo, env, "add", "-A");
  git(repo, env, "commit", "-q", "-m", "base");
  for (const p of Object.keys(BASE)) rmSync(join(repo, p));
  writeTree(repo, HEAD);
  writeFileSync(join(repo, "img.bin"), new Uint8Array([0, 1, 3, 0]));
  git(repo, env, "add", "-A");
  git(repo, env, "commit", "-q", "-m", "head");
  diff = git(repo, env, "diff", "-M", "-U3", "--no-color", "--no-ext-diff", "--no-textconv", "HEAD~1", "HEAD");
  files = parseDiff(diff);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const file = (path: string) => files.find((f) => f.path === path || (f.path === null && f.oldPath === path)) as DiffFile;

describe("diffmap", () => {
  test("lists each changed file with its paths", () => {
    const pairs = files.map((f) => [f.oldPath, f.path, f.binary]);
    expect(pairs).toEqual(
      expect.arrayContaining([
        ["src/a.ts", "src/a.ts", false],
        ["src/old-name.ts", "src/new-name.ts", false],
        ["src/gone.ts", null, false],
        [null, "src/tie.ts", false],
        ["src/naïve file.ts", "src/naïve file.ts", false],
        ["img.bin", "img.bin", true],
      ]),
    );
    expect(files.length).toBe(9);
    // git quotes the non-ASCII name and appends a tab, because the name holds a space.
    expect(diff).toContain('--- "a/src/na\\303\\257ve file.ts"\t\n');
    expect(files.some((f) => f.path === "src/same.ts")).toBe(false);
  });

  test("gives the diff lines of each side with their kinds", () => {
    const a = file("src/a.ts");
    expect([...a.newLines]).toEqual([
      [7, "ctx"],
      [8, "ctx"],
      [9, "ctx"],
      [10, "add"],
      [11, "add"],
      [12, "ctx"],
      [13, "ctx"],
      [14, "ctx"],
    ]);
    expect([...a.oldLines]).toEqual([
      [7, "ctx"],
      [8, "ctx"],
      [9, "ctx"],
      [10, "del"],
      [11, "ctx"],
      [12, "ctx"],
      [13, "ctx"],
    ]);
  });

  test("reads hunk lines by count, so a removed '-- ' line is no header", () => {
    expect(file("db/schema.sql").rows).toEqual([
      { kind: "del", old: 1, new: 1, text: "-- old note" },
      { kind: "add", old: 2, new: 1, text: "++ new" },
      { kind: "ctx", old: 2, new: 2, text: "select 1;" },
    ]);
  });

  test("skips the no-newline marker and strips CR from CRLF lines", () => {
    expect(file("src/nonl.ts").rows.map((r) => [r.kind, r.text])).toEqual([
      ["ctx", "a"],
      ["del", "b"],
      ["add", "c"],
    ]);
    expect(file("src/crlf.ts").rows.map((r) => r.text)).toEqual(["first", "second", "second changed", "third"]);
  });

  test("an added file has only new-side lines", () => {
    const t = file("src/tie.ts");
    expect([...t.newLines.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(t.oldLines.size).toBe(0);
  });
});

const F = (o: Partial<Finding>): Finding => ({
  path: "src/a.ts",
  side: "new",
  line: 1,
  lineEnd: null,
  anchorText: "",
  severity: "major",
  category: "Correctness",
  body: "Body.",
  evidence: "Evidence.",
  evidenceStatus: "code",
  confidence: "high",
  agent: null,
  ...o,
});

const result = (findings: Finding[]): ReviewResult => ({
  summary: "One line.",
  risks: ["A risk."],
  questions: [{ text: "Why?", why: "Because." }],
  coverage: { read: ["src/a.ts"], skipped: [], unavailable: [], notChecked: [] },
  findings,
});

const run = (findings: Finding[], extra: Partial<ValidateInput> = {}) =>
  validate({
    result: result(findings),
    diff,
    newFiles: new Map(Object.entries(HEAD)),
    oldFiles: new Map(Object.entries(BASE)),
    agents: [],
    ...extra,
  });
const one = (f: Partial<Finding>, extra?: Partial<ValidateInput>) => {
  const r = run([F(f)], extra);
  return r.findings[0]?.anchor ?? r.dropped[0]?.reason;
};
const at = (f: Partial<Finding>) => {
  const a = one(f);
  return typeof a === "object" ? [a.state, a.line, a.lineEnd] : a;
};

describe("anchor", () => {
  test("exact: the reported line holds the quote", () => {
    const a = one({ line: 10, anchorText: "const a10 = 100;" });
    expect(a).toEqual({
      state: "exact",
      path: "src/a.ts",
      oldPath: null,
      line: 10,
      lineEnd: 10,
      excerpt: [
        { n: 7, kind: "ctx", text: "const a7 = 7;", hunk: true, old: 7 },
        { n: 8, kind: "ctx", text: "const a8 = 8;", hunk: true, old: 8 },
        { n: 9, kind: "ctx", text: "const a9 = 9;", hunk: true, old: 9 },
        { n: 10, kind: "del", text: "const a10 = 10;" },
        { n: 10, kind: "add", text: "const a10 = 100;" },
        { n: 11, kind: "add", text: "const a10b = 101;" },
        // Gate v3 U4: a hunk ctx line keeps its old-side number. One line was added above these two.
        { n: 12, kind: "ctx", text: "const a11 = 11;", hunk: true, old: 11 },
        { n: 13, kind: "ctx", text: "const a12 = 12;", hunk: true, old: 12 },
      ],
    });
    if (typeof a === "object") expect(moveChoices(a.excerpt, "new")).toEqual([7, 8, 9, 10, 11, 12, 13]);
  });

  test("exact ignores whitespace differences in the quote", () => {
    expect(at({ line: 10, anchorText: "  const\ta10   =\n100; " })).toEqual(["exact", 10, 10]);
  });

  test("moved up and moved down to the quoted line", () => {
    expect(at({ line: 13, anchorText: "const a10 = 100;" })).toEqual(["moved", 10, 10]);
    expect(at({ line: 7, anchorText: "const a10b = 101;" })).toEqual(["moved", 11, 11]);
  });

  test("moved: the nearest match wins, and a tie goes to the lower line (D4)", () => {
    expect(at({ path: "src/tie.ts", line: 4, anchorText: "dup();" })).toEqual(["moved", 2, 2]);
    expect(at({ path: "src/tie.ts", line: 5, anchorText: "dup();" })).toEqual(["moved", 6, 6]);
  });

  test("outside: context beyond -U3 in a changed file", () => {
    expect(at({ line: 14, anchorText: "const a13 = 13;" })).toEqual(["exact", 14, 14]);
    expect(at({ line: 15, anchorText: "const a14 = 14;" })).toEqual(["outside", 15, 15]);
    expect(at({ line: 20, anchorText: "const a24 = 24;" })).toEqual(["outside", 25, 25]);
  });

  test("outside: an unchanged file, with the excerpt clipped at the file start", () => {
    const a = one({ path: "src/same.ts", line: 2, anchorText: "two();" });
    expect(a).toMatchObject({ state: "outside", line: 2, oldPath: null });
    if (typeof a === "object") expect(a.excerpt.map((l) => [l.n, l.kind])).toEqual([1, 2, 3, 4].map((n) => [n, "ctx"]));
    // The diff does not show these lines.
    if (typeof a === "object") expect(a.excerpt.some((l) => l.hunk)).toBe(false);
    expect(at({ path: "src/same.ts", side: "old", line: 3, anchorText: "three();" })).toEqual(["outside", 3, 3]);
  });

  test("dropped: a missing file, a bad path, or no match", () => {
    expect(one({ path: "src/nope.ts", anchorText: "x" })).toBe("file");
    expect(one({ path: "src/gone.ts", anchorText: "bye();" })).toBe("file");
    expect(one({ path: "src/tie.ts", side: "old", anchorText: "a();" })).toBe("file");
    for (const path of [
      "../secret.txt",
      "src/../../secret.txt",
      "/etc/passwd",
      "C:\\secret.txt",
      "\\\\host\\share\\x",
      ".git/config",
      "",
      "./",
    ])
      expect([path, one({ path, anchorText: "x" })]).toEqual([path, "path"]);
    expect(one({ line: 10, anchorText: "const a10 = 1000;" })).toBe("match");
    expect(one({ line: 10, anchorText: " \n\t" })).toBe("match");
    const r = run([F({ path: "../x", anchorText: "x" })]);
    expect(r.findings).toEqual([]);
    expect(r.dropped).toEqual([{ ...F({ path: "../x", anchorText: "x" }), reason: "path" }]);
  });

  test("repoPath normalizes separators and dot parts", () => {
    expect(repoPath("src\\a.ts")).toBe("src/a.ts");
    expect(repoPath("./src//a.ts")).toBe("src/a.ts");
    expect(repoPath("src/.GIT/x")).toBeNull();
  });

  test("lineEnd: a range holds a quote of two lines", () => {
    expect(at({ line: 10, lineEnd: 11, anchorText: "const a10 = 100;\nconst a10b = 101;" })).toEqual(["exact", 10, 11]);
    // A moved range keeps its height.
    expect(at({ line: 2, lineEnd: 3, anchorText: "const a10b = 101;" })).toEqual(["moved", 10, 11]);
    // A range that is too short grows to the quote.
    expect(at({ line: 10, anchorText: "const a10 = 100;\nconst a10b = 101;" })).toEqual(["moved", 10, 11]);
    // A range with lineEnd before line counts as one line.
    expect(at({ line: 10, lineEnd: 4, anchorText: "const a10 = 100;" })).toEqual(["moved", 10, 10]);
  });

  test("old side: a removed line, with the added lines between the excerpt lines", () => {
    const a = one({ side: "old", line: 10, anchorText: "const a10 = 10;" });
    expect(a).toMatchObject({ state: "exact", line: 10 });
    if (typeof a !== "object") throw new Error("not anchored");
    expect(a.excerpt.map((l) => [l.n, l.kind])).toEqual([
      [7, "ctx"],
      [8, "ctx"],
      [9, "ctx"],
      [10, "del"],
      [10, "add"],
      [11, "add"],
      [11, "ctx"],
      [12, "ctx"],
      [13, "ctx"],
    ]);
    expect(moveChoices(a.excerpt, "old")).toEqual([7, 8, 9, 10, 11, 12, 13]);
    // Only a new-side excerpt carries the old-side number of its ctx lines.
    expect(a.excerpt.some((l) => l.old !== undefined)).toBe(false);
    expect(one({ path: "src/gone.ts", side: "old", line: 1, anchorText: "bye();" })).toEqual({
      state: "exact",
      path: "src/gone.ts",
      oldPath: null,
      line: 1,
      lineEnd: 1,
      excerpt: [{ n: 1, kind: "del", text: "bye();" }],
    });
  });

  test("rename: the new path, the old path, and the base side", () => {
    const names = { path: "src/new-name.ts", oldPath: "src/old-name.ts" };
    expect(one({ path: "src/new-name.ts", line: 5, anchorText: "const r5 = 50;" })).toMatchObject({ state: "exact", line: 5, ...names });
    expect(one({ path: "src/old-name.ts", side: "old", line: 5, anchorText: "const r5 = 5;" })).toMatchObject({
      state: "exact",
      line: 5,
      ...names,
    });
    expect(one({ path: "src/new-name.ts", line: 15, anchorText: "const r15 = 15;" })).toMatchObject({ state: "outside", ...names });
  });

  test("a CRLF file matches, and its excerpt has no CR", () => {
    const a = one({ path: "src/crlf.ts", line: 2, anchorText: "second changed" });
    expect(a).toMatchObject({
      state: "exact",
      excerpt: [
        { n: 1, kind: "ctx", text: "first" },
        { n: 2, kind: "del", text: "second" },
        { n: 2, kind: "add", text: "second changed" },
        { n: 3, kind: "ctx", text: "third" },
      ],
    });
  });

  test("the excerpt stops at the file start and the file end", () => {
    const lines = (line: number, anchorText: string) => {
      const a = one({ path: "src/tie.ts", line, anchorText });
      return typeof a === "object" ? a.excerpt.map((l) => l.n) : a;
    };
    expect(lines(1, "a();")).toEqual([1, 2, 3, 4]);
    expect(lines(7, "e();")).toEqual([4, 5, 6, 7]);
  });

  test("a huge file: the scan stays bounded", () => {
    const big = "x\n".repeat(MAX_FILE_CHARS / 2);
    const newFiles = new Map([
      ["over.txt", `${big}y`],
      ["big.txt", big],
      ["tall.txt", text(range(120, (i) => `t${i}`))],
    ]);
    const n = MAX_FILE_CHARS / 2;
    const t0 = performance.now();
    // Every line matches "x". One validation prepares the file once for all its findings.
    const r = run(
      [
        F({ path: "over.txt", line: 1, anchorText: "x" }),
        F({ path: "big.txt", line: 1_000_000, anchorText: "x" }),
        F({ path: "big.txt", line: 1_000_000, anchorText: "x x" }),
        F({ path: "big.txt", line: 3_000_000, anchorText: "x" }),
        F({ path: "big.txt", line: 1, anchorText: "x x y" }),
      ],
      { newFiles },
    );
    expect(performance.now() - t0).toBeLessThan(10_000);
    expect(r.dropped.map((f) => f.reason)).toEqual(["size", "match"]);
    expect(r.findings.map((f) => [f.anchor.state, f.anchor.line, f.anchor.lineEnd])).toEqual([
      ["outside", 1_000_000, 1_000_000],
      ["outside", 1_000_000, 1_000_001],
      ["outside", n, n],
    ]);
    // A quote of more than 100 lines is above the range limit. A range of 100 lines is not.
    const tall = (lineEnd: number, anchorText: string) => one({ path: "tall.txt", line: 1, lineEnd, anchorText }, { newFiles });
    expect(tall(101, range(101, (i) => `t${i}`).join("\n"))).toBe("size");
    expect(tall(100, "t50")).toMatchObject({ line: 1, lineEnd: 100 });
  });

  test("agent must name an Agent event of the run", () => {
    const r = run(
      [
        F({ line: 10, anchorText: "const a10 = 100;", agent: "correctness" }),
        F({ line: 10, anchorText: "const a10 = 100;", agent: "ghost" }),
        F({ path: "../x", agent: "correctness" }),
        F({ path: "../x", agent: "rl-main" }),
      ],
      { agents: ["correctness", "docs-check"] },
    );
    expect(r.findings.map((f) => f.agent)).toEqual(["correctness", null]);
    expect(r.dropped.map((f) => f.agent)).toEqual(["correctness", null]);
  });

  test("an Explain run keeps only its questions", () => {
    const r = run([F({ line: 10, anchorText: "const a10 = 100;" }), F({ path: "../x" })], { explain: true });
    expect(r).toEqual({ ...result([]), findings: [], dropped: [] });
  });
});

describe("result schema", () => {
  test("parses a result and caps the findings", () => {
    const ok = result([F({ line: 3, lineEnd: 4, anchorText: "x", agent: "correctness" })]);
    expect(reviewResult.parse(ok)).toEqual(ok);
    expect(reviewResult.safeParse(result(range(MAX_FINDINGS + 1, () => F({})))).success).toBe(false);
    expect(reviewResult.safeParse(result([F({ line: 0 })])).success).toBe(false);
    expect(reviewResult.safeParse(result([F({ severity: "info" as Finding["severity"] })])).success).toBe(false);
  });

  test("the JSON schema is draft-07 with an object root and no optional field", () => {
    const s = reviewJsonSchema() as {
      $schema: string;
      type: string;
      required: string[];
      properties: { findings: { items: { required: string[]; additionalProperties: boolean } } };
    };
    expect(s.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(s.type).toBe("object");
    expect(s.required.sort()).toEqual(["coverage", "findings", "questions", "risks", "summary"]);
    expect(s.properties.findings.items.required.sort()).toEqual(Object.keys(F({})).sort());
    expect(s.properties.findings.items.additionalProperties).toBe(false);
  });
});
