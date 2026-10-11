// Edit rules of a fix run (plan r3 section 1). Pure: the caller reads each file at the source head S of the run.
import type { DiffRowDto } from "../../shared/dto";
import { repoPath } from "./validate";

// git xdiff-interface.c buffer_is_binary(): a NUL in the first FIRST_FEW_BYTES bytes.
const FIRST_FEW_BYTES = 8000;
// Git LFS spec: the first line of a pointer file.
const LFS_VERSION = "version https://git-lfs.github.com/spec/v1";
// git tree modes of a link and a submodule.
const REFUSED_MODES = new Set(["120000", "160000"]);

// Files that Claude Code loads (workspace.ts sanitize), .gitmodules, and the sources of commit hooks. Hooks run on Apply.
const DENIED = new Set([
  ".claude",
  ".mcp.json",
  "claude.md",
  "claude.local.md",
  "agents.md",
  ".gitmodules",
  ".githooks",
  ".husky",
  ".git",
  ".pre-commit-config.yaml",
  // lefthook.dev/configuration: the main and the -local config in each format, with or without the dot, also in .config/.
  ...["lefthook", ".lefthook", "lefthook-local", ".lefthook-local"].flatMap((n) =>
    ["yml", "yaml", "toml", "json", "jsonc"].map((e) => `${n}.${e}`),
  ),
]);
const DENIED_PREFIX = [".lintstagedrc", "lint-staged.config.", "commitlint.config.", ".commitlintrc"];
// git utf8.c next_hfs_char(): HFS+ ignores these code points in a name.
const hfsIgnored = (c: number) =>
  (c >= 0x200c && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x206a && c <= 0x206f) || c === 0xfeff;

export type FileProblem = "link" | "binary" | "encoding" | "lfs";
export type PreparedFile = { text: string } | { problem: FileProblem };

// mode: the tree mode of the path at S. text keeps a BOM as U+FEFF, so TextEncoder writes it back.
export function prepareFile(bytes: Uint8Array, mode: string): PreparedFile {
  if (REFUSED_MODES.has(mode)) return { problem: "link" };
  if (bytes.subarray(0, FIRST_FEW_BYTES).includes(0)) return { problem: "binary" };
  let text: string;
  try {
    // WHATWG Encoding: without ignoreBOM, decode() drops a leading BOM.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { problem: "encoding" };
  }
  if (text.split("\n", 1)[0]?.replace(/\r$/, "") === LFS_VERSION) return { problem: "lfs" };
  return { text };
}

// start: the UTF-16 offset of old in the decoded text. old and new are after the CRLF rule.
export type Located = { start: number; old: string; new: string };
// absent: old is not empty, but S has no such path. exists: an empty old for a path that S has. match, matches: 0 or 2+ places.
export type LocateProblem = "absent" | "exists" | "match" | "matches";

// text: the decoded file at S, or null when S has no such path. An empty old then creates the file.
export function locate(text: string | null, old: string, next: string): Located | { problem: LocateProblem } {
  if (text === null) return old === "" ? { start: 0, old, new: next } : { problem: "absent" };
  if (old === "") return { problem: "exists" };
  if (text.includes("\r\n") && !old.includes("\r")) {
    old = old.replaceAll("\n", "\r\n");
    next = next.replace(/(?<!\r)\n/g, "\r\n");
  }
  const start = text.indexOf(old);
  if (start < 0) return { problem: "match" };
  if (text.indexOf(old, start + 1) >= 0) return { problem: "matches" };
  return { start, old, new: next };
}

// Two edits of one file. Edits that only touch do not overlap. Two edits at one start always do, also two new files.
export const overlaps = (a: Located, b: Located) =>
  a.start === b.start || (a.start < b.start + b.old.length && b.start < a.start + a.old.length);

// Applies edits of one file in any order. Throws on an overlap or on an edit that is not at its start.
export function applyEdits(text: string, edits: Located[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  sorted.forEach((e, i) => {
    const prev = sorted[i - 1];
    if (prev && overlaps(prev, e)) throw new Error(`Edits at offsets ${prev.start} and ${e.start} overlap.`);
    if (text.slice(e.start, e.start + e.old.length) !== e.old) throw new Error(`The edit at offset ${e.start} does not match the file.`);
    out += text.slice(at, e.start) + e.new;
    at = e.start + e.old.length;
  });
  return out + text.slice(at);
}

// Each line with its "\n". The last line can lack it.
const lines = (s: string) => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const shown = (l: string) => l.replace(/\r?\n$/, "");

// The diff rows of one edit, as diffmap.ts numbers them: a del row has the next new line, an add row the next old line.
export function editRows(text: string, e: Located, context = 3): DiffRowDto[] {
  const end = e.start + e.old.length;
  const lineEnd = (p: number) => {
    const i = text.indexOf("\n", p);
    return i < 0 ? text.length : i + 1;
  };
  // The whole lines that the edit touches.
  const from = e.start === 0 ? 0 : text.lastIndexOf("\n", e.start - 1) + 1;
  let to = end > e.start && text[end - 1] === "\n" ? end : lineEnd(end);
  let after = text.slice(from, e.start) + e.new + text.slice(end, to);
  // A new text without a final newline joins the next line.
  if (after !== "" && !after.endsWith("\n") && to < text.length) {
    const next = lineEnd(to);
    after += text.slice(to, next);
    to = next;
  }
  const all = lines(text);
  const before = lines(text.slice(from, to));
  const changed = lines(after);
  const first = lines(text.slice(0, from)).length;
  let k = 0;
  while (k < before.length && k < changed.length && before[k] === changed[k]) k++;
  let m = 0;
  while (m < before.length - k && m < changed.length - k && before[before.length - 1 - m] === changed[changed.length - 1 - m]) m++;
  const s = first + k;
  const t = first + before.length - m;
  const delta = changed.length - before.length;
  const rows: DiffRowDto[] = [];
  for (let i = Math.max(0, s - context); i < s; i++) rows.push({ kind: "ctx", old: i + 1, new: i + 1, text: shown(all[i] as string) });
  for (let i = s; i < t; i++) rows.push({ kind: "del", old: i + 1, new: s + 1, text: shown(all[i] as string) });
  for (let j = k; j < changed.length - m; j++)
    rows.push({ kind: "add", old: t + 1, new: first + j + 1, text: shown(changed[j] as string) });
  for (let i = t; i < Math.min(all.length, t + context); i++)
    rows.push({ kind: "ctx", old: i + 1, new: i + 1 + delta, text: shown(all[i] as string) });
  return rows;
}

// One name as a file system compares it: no case, no HFS+ ignorable code point, no NTFS stream suffix, no trailing dots or spaces (Win32).
const fold = (name: string) =>
  (
    [...name]
      .filter((ch) => !hfsIgnored(ch.charCodeAt(0)))
      .join("")
      .split(":")[0] as string
  )
    .replace(/[. ]+$/, "")
    .toLowerCase();

// true: no edit may touch the path.
export function deniedPath(path: string): boolean {
  const p = repoPath(path);
  if (p === null) return true;
  return p.split("/").some((part) => {
    const n = fold(part);
    return DENIED.has(n) || DENIED_PREFIX.some((x) => n.startsWith(x));
  });
}
