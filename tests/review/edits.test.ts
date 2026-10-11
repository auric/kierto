// Edit rules of a fix run (plan r3 WP0). Pure functions, no git.
import { describe, expect, test } from "bun:test";
import { applyEdits, deniedPath, editRows, type Located, locate, overlaps, prepareFile } from "../../src/server/review/edits";

const enc = (s: string) => new TextEncoder().encode(s);
const at = (text: string | null, old: string, next: string) => {
  const r = locate(text, old, next);
  if ("problem" in r) throw new Error(`locate failed: ${r.problem}`);
  return r;
};
const FILE = ["one", "two", "const x = 1;", "four", "five", "six", "seven", "eight"].map((l) => `${l}\n`).join("");

describe("prepareFile", () => {
  test("a UTF-8 file decodes, and a BOM survives the round trip", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc("x = 1\n")]);
    const p = prepareFile(bytes, "100644");
    if (!("text" in p)) throw new Error(p.problem);
    expect(p.text).toBe("\ufeffx = 1\n");
    const out = applyEdits(p.text, [at(p.text, "x = 1", "x = 2")]);
    expect([...enc(out)]).toEqual([0xef, 0xbb, 0xbf, ...enc("x = 2\n")]);
    expect("text" in prepareFile(bytes, "100755")).toBe(true);
  });

  test("binary, invalid UTF-8, LFS pointers, links, and submodules are refused", () => {
    const nul = new Uint8Array([...enc("a"), 0, ...enc("b\n")]);
    expect(prepareFile(nul, "100644")).toEqual({ problem: "binary" });
    // git buffer_is_binary() reads the first 8000 bytes only.
    const late = new Uint8Array([...enc("a".repeat(8000)), 0]);
    expect("text" in prepareFile(late, "100644")).toBe(true);
    expect(prepareFile(new Uint8Array([0x61, 0xc3, 0x28]), "100644")).toEqual({ problem: "encoding" });
    const lfs = "version https://git-lfs.github.com/spec/v1\noid sha256:4d7a\nsize 12345\n";
    expect(prepareFile(enc(lfs), "100644")).toEqual({ problem: "lfs" });
    expect(prepareFile(enc(lfs.replaceAll("\n", "\r\n")), "100644")).toEqual({ problem: "lfs" });
    expect("text" in prepareFile(enc(`# ${lfs}`), "100644")).toBe(true);
    expect(prepareFile(enc("target/path"), "120000")).toEqual({ problem: "link" });
    expect(prepareFile(new Uint8Array(), "160000")).toEqual({ problem: "link" });
  });
});

describe("locate", () => {
  test("old must match exactly one place", () => {
    expect(locate(FILE, "x = 1", "x = 2")).toEqual({ start: FILE.indexOf("x = 1"), old: "x = 1", new: "x = 2" });
    expect(locate(FILE, "x = 3", "x = 2")).toEqual({ problem: "match" });
    expect(locate("a\nb\na\n", "a", "c")).toEqual({ problem: "matches" });
    // Matches that share characters count too.
    expect(locate("aaa", "aa", "b")).toEqual({ problem: "matches" });
  });

  test("CRLF rule: a CRLF file and an old without CR convert LF in old and new", () => {
    const text = "a\r\nb\r\nc\r\n";
    const e = at(text, "a\nb", "a\nB\r\nX");
    expect(e).toEqual({ start: 0, old: "a\r\nb", new: "a\r\nB\r\nX" });
    expect(applyEdits(text, [e])).toBe("a\r\nB\r\nX\r\nc\r\n");
    // An old with CR keeps its own line ends. An LF file converts nothing.
    expect(at(text, "b\r\nc", "C\nD")).toEqual({ start: 3, old: "b\r\nc", new: "C\nD" });
    expect(at("a\nb\n", "a\nb", "x\ny")).toEqual({ start: 0, old: "a\nb", new: "x\ny" });
    expect(locate("a\nb\n", "a\r\nb", "x")).toEqual({ problem: "match" });
  });

  test("an empty old creates a file only when the path is absent at the source head", () => {
    expect(locate(null, "", "new\n")).toEqual({ start: 0, old: "", new: "new\n" });
    expect(locate(null, "x", "y")).toEqual({ problem: "absent" });
    expect(locate("", "", "x")).toEqual({ problem: "exists" });
    expect(locate(FILE, "", "x")).toEqual({ problem: "exists" });
    expect(applyEdits("", [at(null, "", "a\nb\n")])).toBe("a\nb\n");
    expect(editRows("", at(null, "", "a\nb\n"))).toEqual([
      { kind: "add", old: 1, new: 1, text: "a" },
      { kind: "add", old: 1, new: 2, text: "b" },
    ]);
  });
});

describe("overlaps and applyEdits", () => {
  const e = (start: number, old: string, next = ""): Located => ({ start, old, new: next });

  test("edits that share a character or a start overlap; edits that only touch do not", () => {
    expect(overlaps(e(0, "abc"), e(2, "cd"))).toBe(true);
    expect(overlaps(e(2, "cd"), e(0, "abc"))).toBe(true);
    expect(overlaps(e(0, "abcdef"), e(2, "c"))).toBe(true);
    expect(overlaps(e(0, "ab"), e(2, "cd"))).toBe(false);
    expect(overlaps(e(0, ""), e(0, ""))).toBe(true);
  });

  test("any subset of edits applies, in any order; an overlap is refused", () => {
    const text = "alpha beta gamma\n";
    const a = at(text, "alpha", "A");
    const b = at(text, "beta", "B");
    const c = at(text, "gamma", "G");
    expect(applyEdits(text, [c, a, b])).toBe("A B G\n");
    expect(applyEdits(text, [c, a])).toBe("A beta G\n");
    expect(applyEdits(text, [b])).toBe("alpha B gamma\n");
    expect(() => applyEdits(text, [a, at(text, "pha be", "x")])).toThrow(/overlap/);
    expect(() => applyEdits(text, [e(1, "alpha", "A")])).toThrow(/does not match/);
  });
});

describe("editRows", () => {
  test("a mid-line old gives whole lines with diffmap numbers", () => {
    expect(editRows(FILE, at(FILE, "x = 1", "x = 2"))).toEqual([
      { kind: "ctx", old: 1, new: 1, text: "one" },
      { kind: "ctx", old: 2, new: 2, text: "two" },
      { kind: "del", old: 3, new: 3, text: "const x = 1;" },
      { kind: "add", old: 4, new: 3, text: "const x = 2;" },
      { kind: "ctx", old: 4, new: 4, text: "four" },
      { kind: "ctx", old: 5, new: 5, text: "five" },
      { kind: "ctx", old: 6, new: 6, text: "six" },
    ]);
  });

  test("lines that old and new share show as context, and later lines shift", () => {
    const e = at(FILE, "four\nfive\nsix\n", "four\nFIVE\nfive and a half\nsix\n");
    expect(editRows(FILE, e, 1)).toEqual([
      { kind: "ctx", old: 4, new: 4, text: "four" },
      { kind: "del", old: 5, new: 5, text: "five" },
      { kind: "add", old: 6, new: 5, text: "FIVE" },
      { kind: "add", old: 6, new: 6, text: "five and a half" },
      { kind: "ctx", old: 6, new: 7, text: "six" },
    ]);
  });

  test("an edit at the file end, with and without a final newline", () => {
    const text = "a\nb\nc";
    expect(editRows(text, at(text, "c", "c\nd\n"))).toEqual([
      { kind: "ctx", old: 1, new: 1, text: "a" },
      { kind: "ctx", old: 2, new: 2, text: "b" },
      { kind: "del", old: 3, new: 3, text: "c" },
      { kind: "add", old: 4, new: 3, text: "c" },
      { kind: "add", old: 4, new: 4, text: "d" },
    ]);
    expect(editRows("a\nb\n", at("a\nb\n", "b\n", "b\nc\n"))).toEqual([
      { kind: "ctx", old: 1, new: 1, text: "a" },
      { kind: "ctx", old: 2, new: 2, text: "b" },
      { kind: "add", old: 3, new: 3, text: "c" },
    ]);
    // A deleted last line, and a new text that joins the next line.
    expect(editRows("a\nb\n", at("a\nb\n", "b\n", ""))).toEqual([
      { kind: "ctx", old: 1, new: 1, text: "a" },
      { kind: "del", old: 2, new: 2, text: "b" },
    ]);
    expect(editRows("a\nb\nc\n", at("a\nb\nc\n", "b\n", "B"))).toEqual([
      { kind: "ctx", old: 1, new: 1, text: "a" },
      { kind: "del", old: 2, new: 2, text: "b" },
      { kind: "del", old: 3, new: 2, text: "c" },
      { kind: "add", old: 4, new: 2, text: "Bc" },
    ]);
  });

  test("CRLF lines show without the CR", () => {
    const text = "a\r\nb\r\n";
    expect(editRows(text, at(text, "b", "B"))).toEqual([
      { kind: "ctx", old: 1, new: 1, text: "a" },
      { kind: "del", old: 2, new: 2, text: "b" },
      { kind: "add", old: 3, new: 2, text: "B" },
    ]);
  });
});

describe("deniedPath", () => {
  test("refuses unsafe paths, agent config, .gitmodules, and hook sources at any depth and in any case", () => {
    const denied = [
      "../x",
      "/etc/passwd",
      "C:/x",
      "a/../../x",
      "a\0b",
      "a/.git/config",
      ".GIT/hooks/pre-commit",
      ".claude/settings.json",
      "pkg/.Claude/agents/x.md",
      ".mcp.json",
      "pkg/.MCP.JSON",
      "CLAUDE.md",
      "docs/claude.md",
      "CLAUDE.local.md",
      "pkg/Agents.MD",
      ".gitmodules",
      ".githooks/pre-commit",
      ".husky/pre-commit",
      "web/.HUSKY/_/h",
      ".pre-commit-config.yaml",
      "LEFTHOOK.yml",
      "lefthook.yaml",
      ".lefthook.yml",
      ".lefthook.yaml",
      "lefthook.toml",
      ".config/lefthook.jsonc",
      ".lefthook-local.yml",
      "lefthook-local.json",
      ".lintstagedrc",
      ".lintstagedrc.json",
      "pkg/lint-staged.config.mjs",
      "commitlint.config.ts",
      ".commitlintrc.yaml",
      // Win32 drops trailing dots and spaces; NTFS reads a stream suffix; HFS+ ignores U+200C.
      "CLAUDE.md.",
      "CLAUDE.md ",
      "CLAUDE.md::$DATA",
      ".claude\u200c/settings.json",
      "a\\.claude\\settings.json",
    ];
    for (const p of denied) expect(deniedPath(p), p).toBe(true);
    const allowed = [
      "src/app.ts",
      "./src/app.ts",
      "src/claude/x.ts",
      "docs/claude-notes.md",
      "husky.md",
      "lefthook.ymlx",
      "docs/lefthook.md",
      "lint-staged.md",
      ".github/workflows/ci.yml",
      "README.md",
    ];
    for (const p of allowed) expect(deniedPath(p), p).toBe(false);
  });
});
