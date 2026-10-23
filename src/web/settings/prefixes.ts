// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Pure model of Settings > Tasks "Branch prefixes" (docs/plans/review-v2/spec.md section 6.16.1). No DOM access, so bun test runs it.
import { branchPrefix } from "../../shared/dto";
import { PREFIXES_MAX } from "../../shared/task";

// id: a stable React key, so a moved row keeps its DOM nodes. fresh: an added row that the user has not left yet. Its empty field
// shows no error until then.
export type PrefixDraft = { id: number; text: string; fresh: boolean };

let lastId = 0;
export const toPrefixDrafts = (list: string[]): PrefixDraft[] => list.map((text) => ({ id: ++lastId, text, fresh: false }));

export type PrefixChange =
  | { act: "add" }
  | { act: "remove"; i: number }
  | { act: "move"; i: number; d: -1 | 1 }
  | { act: "edit"; i: number; text: string }
  | { act: "leave"; i: number };

export function changePrefixes(list: PrefixDraft[], c: PrefixChange): PrefixDraft[] {
  switch (c.act) {
    case "add":
      return list.length >= PREFIXES_MAX ? list : [...list, { id: ++lastId, text: "", fresh: true }];
    case "remove":
      return list.filter((_, i) => i !== c.i);
    case "move": {
      const j = c.i + c.d;
      const r = list[c.i];
      if (!r || j < 0 || j >= list.length) return list;
      const out = list.filter((_, i) => i !== c.i);
      out.splice(j, 0, r);
      return out;
    }
    case "edit":
      return list.map((r, i) => (i === c.i ? { ...r, text: c.text } : r));
    case "leave":
      return list.map((r, i) => (i === c.i ? { ...r, fresh: false } : r));
  }
}

// The sentence of each row: the prefix rule of the server (branchPrefix in dto.ts), then a repeat of an earlier row.
export function prefixProblems(list: PrefixDraft[]): (string | null)[] {
  const seen = new Set<string>();
  return list.map((r) => {
    const text = r.text.trim();
    if (r.fresh && !text) return null;
    const ok = branchPrefix.safeParse(text);
    if (!ok.success) return ok.error.issues[0]?.message ?? "Invalid branch prefix.";
    if (seen.has(text)) return "This prefix is already in the list.";
    seen.add(text);
    return null;
  });
}

export const listProblem = (list: PrefixDraft[]): string | null =>
  list.length === 0 ? "Keep at least one prefix." : list.length > PREFIXES_MAX ? `At most ${PREFIXES_MAX} prefixes.` : null;

// The list that a save sends, or null while a row or the list has a problem. A fresh empty row also holds the save back.
export function prefixesToSave(list: PrefixDraft[]): string[] | null {
  if (listProblem(list) || list.some((r) => !r.text.trim()) || prefixProblems(list).some((p) => p !== null)) return null;
  return list.map((r) => r.text.trim());
}

// DOM ids of the editor controls.
export const prefixId = (i: number, part: "text" | "up" | "down" | "remove" | "error") => `prefix-${i}-${part}`;
export const PREFIX_ADD_ID = "prefix-add";

// The control that keeps the place after a change. n: the row count after it.
export function prefixFocus(c: PrefixChange, n: number): string | null {
  switch (c.act) {
    case "add":
      return prefixId(n - 1, "text");
    case "remove":
      return n ? prefixId(Math.min(c.i, n - 1), "remove") : PREFIX_ADD_ID;
    case "move": {
      const j = c.i + c.d;
      // The button in the same direction is disabled at the end of the list.
      const end = c.d < 0 ? j === 0 : j === n - 1;
      return prefixId(j, c.d < 0 !== end ? "up" : "down");
    }
    default:
      return null;
  }
}
