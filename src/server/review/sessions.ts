// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Session finder (docs/plans/session-consult.md part C). It lists the transcripts of one branch in <config>/projects and reads only
// their metadata: the working folder, the branch, the time, the title lines, and continued-in. It never returns or logs message text.
// The transcript format is internal to the CLI and can change. Every file read stops at a byte cap, so a 93 MB file costs 320 KB.
import type { Dirent } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { open, readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { oneLine, SESSION_ID } from "../../shared/consult";
import { inside } from "./paths";

// In a sample of 54 transcripts (2026-10-16), the first cwd line started within 2 KB of the file start, the last branch line within
// 23 KB of the end, and the last title line within 37 KB of the end. A cut line at a cap edge is dropped.
export const HEAD_BYTES = 64 * 1024;
export const TAIL_BYTES = 256 * 1024;
// ponytail: only the newest files by modification time are read; an older session on the branch is not listed. Raise it if needed.
export const MAX_FILES = 300;
export const MAX_SESSIONS = 25;
const MAX_TITLE = 200;
const PARALLEL = 8;

// path: the absolute transcript path. It stays on the server. cwd: the newest working folder of the session.
export type FoundSession = {
  id: string;
  path: string;
  title: string | null;
  bytes: number;
  lastAt: number;
  folder: string;
  cwd: string | null;
  branch: string;
  inClone: boolean;
};

export type FindInput = {
  projectsDir: string;
  branch: string;
  // The clone folder of the repository from Settings, Clones. A session in it ranks first.
  clone: string | null;
  // Folders of the app runs. A transcript whose newest working folder is in one of them is a fork of an earlier run.
  exclude: string[];
};

type File = { id: string; path: string; bytes: number; mtime: number };
type Meta = File & {
  cwd: string | null;
  lastAt: number | null;
  title: string | null;
  next: string | null;
  matched: boolean;
  superseded: boolean;
};

async function bytesAt(fh: FileHandle, at: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, at);
  return buf.subarray(0, bytesRead);
}

// The complete lines of the head and the tail, in file order. The tail read starts one byte early: that byte tells whether its
// first line is complete.
async function edgeLines(path: string, size: number, head = HEAD_BYTES, tail = TAIL_BYTES): Promise<string[]> {
  const fh = await open(path, "r");
  try {
    if (size <= head + tail) return (await bytesAt(fh, 0, size)).toString("utf8").split("\n");
    const first = (await bytesAt(fh, 0, head)).toString("utf8").split("\n").slice(0, -1);
    const last = (await bytesAt(fh, size - tail - 1, tail + 1)).toString("utf8").split("\n").slice(1);
    return [...first, ...last];
  } finally {
    await fh.close();
  }
}

type Obj = Record<string, unknown>;
const parse = (l: string): Obj | null => {
  try {
    const o: unknown = JSON.parse(l);
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Obj) : null;
  } catch {
    return null;
  }
};
const text = (o: Obj | null, k: string) => (typeof o?.[k] === "string" ? (o[k] as string) : null);

// Reads the metadata of one transcript. The CLI writes compact JSON, so a top-level key shows as "key":value in the line text.
// Only the lines with a wanted key get parsed, and the parse confirms that the key is at the top level.
export async function readMeta(f: File, branch: string, caps?: { head: number; tail: number }): Promise<Meta> {
  const lines = await edgeLines(f.path, f.bytes, caps?.head, caps?.tail);
  const parsed = new Map<number, Obj | null>();
  const at = (i: number) => {
    if (!parsed.has(i)) parsed.set(i, parse(lines[i] as string));
    return parsed.get(i) ?? null;
  };
  const needle = `"gitBranch":${JSON.stringify(branch)}`;
  const m: Meta = { ...f, cwd: null, lastAt: null, title: null, next: null, matched: false, superseded: false };
  let custom: string | null = null;
  let ai: string | null = null;
  let cont = false;
  // Newest first: the first hit of each key is its newest value.
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i] as string;
    if (m.cwd === null && l.includes('"cwd":"')) {
      const cwd = text(at(i), "cwd");
      if (cwd && isAbsolute(cwd)) m.cwd = cwd;
    }
    if (m.lastAt === null && l.includes('"timestamp":"')) {
      const t = Date.parse(text(at(i), "timestamp") ?? "");
      if (Number.isFinite(t)) m.lastAt = t;
    }
    if (custom === null && l.includes('"type":"custom-title"') && at(i)?.type === "custom-title")
      custom = oneLine(text(at(i), "customTitle") ?? "").trim() || null;
    if (ai === null && l.includes('"type":"ai-title"') && at(i)?.type === "ai-title")
      ai = oneLine(text(at(i), "aiTitle") ?? "").trim() || null;
    if (!cont && l.includes('"type":"continued-in"') && at(i)?.type === "continued-in") {
      cont = true;
      const next = text(at(i), "continuedInSessionId");
      if (next && SESSION_ID.test(next) && next !== f.id) m.next = next;
    }
    if (!m.matched && l.includes(needle)) m.matched = text(at(i), "gitBranch") === branch;
  }
  // A rename by the user wins over the generated title.
  const title = custom ?? ai;
  m.title = title === null ? null : title.slice(0, MAX_TITLE);
  return m;
}

async function listFiles(projectsDir: string): Promise<File[]> {
  let dirs: Dirent[];
  try {
    dirs = await readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: File[] = [];
  for (const d of dirs) {
    // A link is not followed: Dirent.isDirectory and isFile are false for it.
    if (!d.isDirectory()) continue;
    const dir = join(projectsDir, d.name);
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
      const id = e.name.slice(0, -".jsonl".length);
      if (!SESSION_ID.test(id)) continue;
      const path = join(dir, e.name);
      try {
        const s = await stat(path);
        files.push({ id, path, bytes: s.size, mtime: s.mtimeMs });
      } catch {}
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const seen = new Set<string>();
  return files.filter((f) => !seen.has(f.id) && seen.add(f.id));
}

// The sessions of the branch: in the clone first, then newest first. A session that continued in a newer listed session gives its
// branch match and its title to that session and leaves the list.
export async function findSessions(o: FindInput): Promise<FoundSession[]> {
  const files = (await listFiles(o.projectsDir)).slice(0, MAX_FILES);
  const metas: Meta[] = [];
  for (let i = 0; i < files.length; i += PARALLEL) {
    const part = await Promise.all(files.slice(i, i + PARALLEL).map((f) => readMeta(f, o.branch).catch(() => null)));
    for (const m of part) if (m) metas.push(m);
  }
  const time = (m: Meta) => m.lastAt ?? m.mtime;
  // A total order, so no continued-in cycle can hide every member.
  const newer = (a: Meta, b: Meta) => time(a) > time(b) || (time(a) === time(b) && a.id > b.id);
  const byId = new Map(metas.map((m) => [m.id, m]));
  // Oldest first, so a match goes on along a chain A to B to C.
  for (const m of [...metas].sort((a, b) => (newer(a, b) ? 1 : newer(b, a) ? -1 : 0))) {
    const next = m.next ? byId.get(m.next) : undefined;
    if (!next || !newer(next, m)) continue;
    m.superseded = true;
    next.matched ||= m.matched;
    next.title ??= m.title;
  }
  const run = (cwd: string | null) => cwd !== null && o.exclude.some((root) => inside(root, cwd, { withRoot: true }));
  return metas
    .filter((m) => m.matched && !m.superseded && !run(m.cwd))
    .map((m) => ({
      id: m.id,
      path: m.path,
      title: m.title,
      bytes: m.bytes,
      lastAt: time(m),
      folder: m.cwd ? basename(m.cwd) : "",
      cwd: m.cwd,
      branch: o.branch,
      inClone: o.clone !== null && m.cwd !== null && inside(o.clone, m.cwd, { withRoot: true }),
    }))
    .sort((a, b) => Number(b.inClone) - Number(a.inClone) || b.lastAt - a.lastAt)
    .slice(0, MAX_SESSIONS);
}
