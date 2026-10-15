// Pure diff viewer rules (plan r2 UI-DIFF). No DOM access, so bun test runs them directly.
import type { CommentDto, DiffFileDto, DiffRowDto, ReviewItemDto } from "../../shared/dto";
import { type Spot, threadSpot } from "../../shared/types";
import { shortHash } from "../review/model";

export { type Spot, threadSpot };

// The file of a path: the new path, else the old path of a deleted or renamed file.
export function fileOf(files: DiffFileDto[], path: string): number {
  const i = files.findIndex((f) => f.path === path);
  return i >= 0 ? i : files.findIndex((f) => f.oldPath === path);
}

export const fileName = (f: Pick<DiffFileDto, "path" | "oldPath">) => (f.path ?? f.oldPath) as string;

export type Card = { kind: "thread" | "draft"; id: number };
// why: the reason that the card is not on a line.
export type Off = Card & { why: string };
// stale: a reason that the item cannot sit on a line of this diff.
export type Item = { card: Card; spot: Spot; stale?: string };
// at: the cards after each row index. marked: rows that a card covers. first: the first covered row of each placed card (cardKey).
export type Placement = { at: Map<number, Card[]>; marked: Set<number>; first: Map<string, number>; off: Off[] };

export const cardKey = (c: Card) => `${c.kind[0]}${c.id}`;

export const THREAD_OUTDATED = "Outdated. The code changed after this comment.";
export const DRAFT_OUTSIDE = "Outside the diff. It posts as a general comment.";
export const olderHead = (head: string) => `From the review of ${shortHash(head)}. The code changed after it.`;

// null: a general comment.
export function threadItem(t: { id: number; root: Pick<CommentDto, "anchor" | "excerpt"> }): Item | null {
  const s = threadSpot(t.root);
  if (!s) return null;
  const { orphaned, ...spot } = s;
  return { card: { kind: "thread", id: t.id }, spot, ...(orphaned ? { stale: THREAD_OUTDATED } : {}) };
}

// The current anchor of a finding draft. null: a discarded draft, or a finding without an anchor (always discarded).
// head: the source head of the review run. indexHead: the source head of the diff.
export function draftItem(it: ReviewItemDto, head: string | null, indexHead: string): Item | null {
  const a = it.anchor;
  if (!a || it.kind !== "finding" || it.status === "discarded") return null;
  const stale = a.state === "outside" ? DRAFT_OUTSIDE : head !== null && head !== indexHead ? olderHead(head) : undefined;
  return {
    card: { kind: "draft", id: it.id },
    spot: { path: a.path, side: a.side, line: a.line, lineEnd: a.lineEnd },
    ...(stale ? { stale } : {}),
  };
}

// A del row has only an old-side line, an add row only a new-side line.
export function lineIndex(rows: DiffRowDto[]): { new: Map<number, number>; old: Map<number, number> } {
  const out = { new: new Map<number, number>(), old: new Map<number, number>() };
  rows.forEach((r, i) => {
    if (r.kind !== "del") out.new.set(r.new, i);
    if (r.kind !== "add") out.old.set(r.old, i);
  });
  return out;
}

// complete: rows hold every row of the file. Else a missing line can be on a page that is not loaded.
export function place(rows: DiffRowDto[], complete: boolean, items: Item[]): Placement {
  const lines = lineIndex(rows);
  const out: Placement = { at: new Map(), marked: new Set(), first: new Map(), off: [] };
  for (const { card, spot, stale } of items) {
    if (stale) {
      out.off.push({ ...card, why: stale });
      continue;
    }
    if (spot.line === null) {
      out.off.push({ ...card, why: "A comment on the whole file." });
      continue;
    }
    const at = lines[spot.side];
    const first = at.get(spot.line);
    if (first === undefined) {
      out.off.push({ ...card, why: `Line ${spot.line} is not in the ${complete ? "diff" : "lines shown"}.` });
      continue;
    }
    out.first.set(cardKey(card), first);
    let last = first;
    for (let k = spot.line; k <= Math.max(spot.line, spot.lineEnd); k++) {
      const r = at.get(k);
      if (r === undefined) continue;
      out.marked.add(r);
      last = Math.max(last, r);
    }
    const list = out.at.get(last);
    if (list) list.push(card);
    else out.at.set(last, [card]);
  }
  return out;
}

// The unchanged lines that git leaves out before row r. 0: r follows prev in the same hunk.
// diffmap.ts: a del row holds the next new-side line, an add row the next old-side line.
export function hidden(prev: DiffRowDto | undefined, r: DiffRowDto): number {
  if (!prev) return Math.max(0, Math.min(r.old, r.new) - 1);
  return Math.max(0, r.new - (prev.new + (prev.kind === "del" ? 0 : 1)));
}

// DOM IDs. A row takes its new-side line, a del row its old-side line.
export const rowId = (file: number, r: DiffRowDto) => (r.kind === "del" ? `dl-${file}-o${r.old}` : `dl-${file}-n${r.new}`);
export const offId = (file: number, c: Card) => `dn-${file}-${cardKey(c)}`;

// The element that shows a card in this placement: the first row that it covers, else its entry in the list above the rows.
export function targetOf(file: number, rows: DiffRowDto[], p: Placement, c: Card): string | null {
  const i = p.first.get(cardKey(c));
  const r = i === undefined ? undefined : rows[i];
  if (r) return rowId(file, r);
  return p.off.some((x) => cardKey(x) === cardKey(c)) ? offId(file, c) : null;
}
