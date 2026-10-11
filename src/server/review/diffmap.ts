// Parses `git diff -M -U3 <base> <head>` output (plan v3 WP9). Pure.
// The caller runs git with the default a/ and b/ prefixes, with no color, no external diff, and no textconv.
import type { DiffKind } from "../../shared/review";

// One hunk line. A del row has no new-side line, so its `new` is the next new-side line: the row sits before it.
// An add row has no old-side line, so its `old` is the next old-side line in the same way.
export type DiffRow = { kind: DiffKind; old: number; new: number; text: string };

export type DiffFile = {
  // null: the file was deleted.
  path: string | null;
  // null: the file was added.
  oldPath: string | null;
  binary: boolean;
  rows: DiffRow[];
  // The lines of each side that the hunks show. Other lines are outside the diff.
  newLines: Map<number, "add" | "ctx">;
  oldLines: Map<number, "del" | "ctx">;
};

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const ESC: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };

// git quote_c_style: C escapes, and octal bytes of the UTF-8 name.
function unquote(s: string): string {
  if (!s.startsWith('"') || !s.endsWith('"') || s.length < 2) return s;
  const inner = s.slice(1, -1);
  const enc = new TextEncoder();
  const bytes: number[] = [];
  let last = 0;
  for (const m of inner.matchAll(/\\([0-7]{3}|[\s\S])/g)) {
    bytes.push(...enc.encode(inner.slice(last, m.index)));
    const e = m[1] as string;
    bytes.push(e.length === 3 ? Number.parseInt(e, 8) : (ESC[e] ?? e.charCodeAt(0)));
    last = m.index + m[0].length;
  }
  bytes.push(...enc.encode(inner.slice(last)));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// A name in a ---/+++ line. git appends a tab when the name holds a space.
function sideName(raw: string, prefix: string): string | null {
  const s = raw.endsWith("\t") ? raw.slice(0, -1) : raw;
  if (s === "/dev/null") return null;
  const name = unquote(s);
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

// The names in `diff --git a/X b/Y`. Unquoted names can hold spaces, so only equal names (no rename) split safely.
function gitLineNames(rest: string): [string, string] | null {
  if (rest.startsWith('"')) {
    const end = /^"(?:[^"\\]|\\.)*"/.exec(rest)?.[0];
    if (!end) return null;
    const a = sideName(end, "a/");
    const b = sideName(rest.slice(end.length + 1), "b/");
    return a !== null && b !== null ? [a, b] : null;
  }
  const len = (rest.length - 5) / 2;
  if (!Number.isInteger(len) || len < 1) return null;
  const a = rest.slice(2, 2 + len);
  return rest === `a/${a} b/${a}` ? [a, a] : null;
}

export function parseDiff(text: string): DiffFile[] {
  const lines = text.split(/\r?\n/);
  const files: DiffFile[] = [];
  let f: DiffFile | undefined;
  // Header state of the current file, until its first hunk.
  let head: { names: [string, string] | null; from?: string | null; to?: string | null; added: boolean; deleted: boolean } | undefined;

  const finish = () => {
    if (!f || !head) return;
    const oldName = head.from !== undefined ? head.from : (head.names?.[0] ?? null);
    const newName = head.to !== undefined ? head.to : (head.names?.[1] ?? null);
    f.oldPath = head.added ? null : oldName;
    f.path = head.deleted ? null : newName;
    head = undefined;
  };

  let i = 0;
  while (i < lines.length) {
    const l = lines[i] as string;
    i++;
    if (l.startsWith("diff --git ")) {
      finish();
      f = { path: null, oldPath: null, binary: false, rows: [], newLines: new Map(), oldLines: new Map() };
      files.push(f);
      head = { names: gitLineNames(l.slice(11)), added: false, deleted: false };
      continue;
    }
    if (!f) continue;
    const h = HUNK.exec(l);
    if (h) {
      finish();
      let ro = h[2] === undefined ? 1 : Number(h[2]);
      let rn = h[4] === undefined ? 1 : Number(h[4]);
      // git: a side with count 0 names the line before the hunk.
      let o = Number(h[1]) + (ro === 0 ? 1 : 0);
      let n = Number(h[3]) + (rn === 0 ? 1 : 0);
      while ((ro > 0 || rn > 0) && i < lines.length) {
        const r = lines[i] as string;
        const c = r[0];
        // git apply reads an empty line in a hunk as an empty context line.
        if ((c === " " || r === "") && ro > 0 && rn > 0) {
          f.rows.push({ kind: "ctx", old: o, new: n, text: r.slice(1) });
          f.oldLines.set(o++, "ctx");
          f.newLines.set(n++, "ctx");
          ro--;
          rn--;
        } else if (c === "-" && ro > 0) {
          f.rows.push({ kind: "del", old: o, new: n, text: r.slice(1) });
          f.oldLines.set(o++, "del");
          ro--;
        } else if (c === "+" && rn > 0) {
          f.rows.push({ kind: "add", old: o, new: n, text: r.slice(1) });
          f.newLines.set(n++, "add");
          rn--;
        } else if (c !== "\\") break;
        i++;
      }
      continue;
    }
    if (!head) continue;
    if (l.startsWith("rename from ")) head.from = unquote(l.slice(12));
    else if (l.startsWith("rename to ")) head.to = unquote(l.slice(10));
    else if (l.startsWith("--- ")) head.from ??= sideName(l.slice(4), "a/");
    else if (l.startsWith("+++ ")) head.to ??= sideName(l.slice(4), "b/");
    else if (l.startsWith("new file mode ")) head.added = true;
    else if (l.startsWith("deleted file mode ")) head.deleted = true;
    else if (l.startsWith("Binary files ") || l === "GIT binary patch") f.binary = true;
  }
  finish();
  return files;
}
