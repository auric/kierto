// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Links of an Explain result into the Files diff (docs/plans/review-v2/spec.md sections 3.1, 3.3, 3.5).
import type { ExplainResult } from "../../shared/review";
import type { FileRef } from "../lib/route";

// The form that src/server/review/judge.ts DIFF_LINK checks: diff:<path>#N<a>[-<b>] names lines at the head commit, #O lines at
// the merge base. The end can repeat the side letter. react-markdown gives the href percent-encoded (mdast-util-to-hast normalizeUri),
// and the server decodes the path once too.
const DIFF_LINK = /^diff:([^#]+)#([NO])(\d+)(?:-([NO])?(\d+))?$/;

export type DiffLink = FileRef & { line: number; lineEnd: number };

// null: not a diff link of that form. The caller shows the label as text.
export function parseDiffLink(href: string): DiffLink | null {
  const m = DIFF_LINK.exec(href);
  if (!m || (m[4] !== undefined && m[4] !== m[2])) return null;
  let path: string;
  try {
    path = decodeURIComponent(m[1] as string);
  } catch {
    return null;
  }
  const line = Number(m[3]);
  const lineEnd = m[5] === undefined ? line : Number(m[5]);
  if (!path || line < 1 || lineEnd < line) return null;
  return { path, side: m[2] === "N" ? "new" : "old", line, lineEnd };
}

type Risk = ExplainResult["risks"][number];

// The place of a risk in the Files diff. judgeExplain keeps a path only with the lines that the diff shows. null: no single place.
export const riskLink = (r: Risk): DiffLink | null =>
  r.path !== null && r.line !== null ? { path: r.path, side: r.side, line: r.line, lineEnd: r.lineEnd ?? r.line } : null;

// The lines of a place: "lines 3 to 5", "old line 2".
export function linesText(l: DiffLink): string {
  const lines = l.lineEnd > l.line ? `lines ${l.line} to ${l.lineEnd}` : `line ${l.line}`;
  return l.side === "old" ? `old ${lines}` : lines;
}

// The words of a place: "flush.ts, lines 3 to 5". The full path goes into the accessible name.
export const placeText = (l: DiffLink) => `${l.path.slice(l.path.lastIndexOf("/") + 1)}, ${linesText(l)}`;
