// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Text diffs for the Improve prompt dialog (lines) and the revision of a reply draft (words). No DOM access, so bun test runs them.
export type DiffLine = { kind: "same" | "del" | "add"; text: string };

// ponytail: an O(n·m) LCS table after the common head and tail. Above MAX_CELLS the middle shows as one removal and one addition.
const MAX_CELLS = 1_000_000;
const linesOf = (t: string) => (t ? t.split("\n") : []);

// The line changes from a to b. Equal lines stay in order. A changed line shows as a removal, then an addition.
export const lineDiff = (a: string, b: string): DiffLine[] => tokenDiff(linesOf(a), linesOf(b));

// The word changes from a to b. A word is a run of non-space characters, and each run of spaces is a token too, so the parts join
// back to the texts. A run of changes gives one removal, then one addition. Spaces between two changes join the run, so the diff
// shows phrases and not single words.
export function wordDiff(a: string, b: string): DiffLine[] {
  const words = (t: string) => t.split(/(\s+)/).filter(Boolean);
  const raw = tokenDiff(words(a), words(b));
  const out: DiffLine[] = [];
  let del = "";
  let add = "";
  const flush = () => {
    if (del) out.push({ kind: "del", text: del });
    if (add) out.push({ kind: "add", text: add });
    del = "";
    add = "";
  };
  raw.forEach((d, k) => {
    if (d.kind === "del") del += d.text;
    else if (d.kind === "add") add += d.text;
    else if ((del || add) && !d.text.trim() && raw[k + 1] && raw[k + 1]?.kind !== "same") {
      del += d.text;
      add += d.text;
    } else {
      flush();
      const last = out.at(-1);
      if (last?.kind === "same") last.text += d.text;
      else out.push({ ...d });
    }
  });
  flush();
  return out;
}

// The changes from the tokens x to the tokens y, one entry per token.
function tokenDiff(x: readonly string[], y: readonly string[]): DiffLine[] {
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  const xs = x.slice(head, x.length - tail);
  const ys = y.slice(head, y.length - tail);
  const line = (kind: DiffLine["kind"]) => (text: string) => ({ kind, text });
  const mid: DiffLine[] = [];
  if (xs.length * ys.length > MAX_CELLS) mid.push(...xs.map(line("del")), ...ys.map(line("add")));
  else {
    const w = ys.length + 1;
    // t[i * w + j]: the LCS length of xs[i..] and ys[j..].
    const t = new Uint32Array((xs.length + 1) * w);
    for (let i = xs.length - 1; i >= 0; i--)
      for (let j = ys.length - 1; j >= 0; j--)
        t[i * w + j] =
          xs[i] === ys[j] ? (t[(i + 1) * w + j + 1] as number) + 1 : Math.max(t[(i + 1) * w + j] as number, t[i * w + j + 1] as number);
    let i = 0;
    let j = 0;
    while (i < xs.length || j < ys.length) {
      if (i < xs.length && j < ys.length && xs[i] === ys[j]) {
        mid.push(line("same")(xs[i++] as string));
        j++;
      } else if (j >= ys.length || (i < xs.length && (t[(i + 1) * w + j] as number) >= (t[i * w + j + 1] as number)))
        mid.push(line("del")(xs[i++] as string));
      else mid.push(line("add")(ys[j++] as string));
    }
  }
  return [...x.slice(0, head).map(line("same")), ...mid, ...x.slice(x.length - tail).map(line("same"))];
}
