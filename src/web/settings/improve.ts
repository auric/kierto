// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Pure rules of the Improve prompt dialog. No DOM access, so bun test runs them directly.
import type { ImproveDto, ImproveInput, ProfileInput } from "../../shared/dto";
import { limitText } from "../review/model";
import { type Draft, toProfiles } from "./profiles";

// The goal limit of improveInput: MAX_QUESTION of src/shared/review.ts. tests/web/improve.test.ts pins it.
export const MAX_GOAL = 4000;

export type DiffLine = { kind: "same" | "del" | "add"; text: string };

// ponytail: an O(n·m) LCS table after the common head and tail. Above MAX_CELLS the middle shows as one removal and one addition.
const MAX_CELLS = 1_000_000;
const linesOf = (t: string) => (t ? t.split("\n") : []);

// The line changes from a to b. Equal lines stay in order. A changed line shows as a removal, then an addition.
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = linesOf(a);
  const y = linesOf(b);
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

// The request body: the draft as the editor shows it, with the same trims as a save.
export function improveBody(d: Draft, goal: string): ImproveInput {
  const p = toProfiles([d])[0] as ProfileInput;
  return {
    name: p.name,
    note: p.note,
    prompt: p.prompt,
    explain: p.explain,
    docs: p.docs,
    languageChecks: p.languageChecks,
    model: p.model,
    effort: p.effort,
    goal: goal.trim(),
  };
}

export const runningText = (runner: string) => `${runner} is writing a proposal…`;

// A usage limit and a wrong login use the texts of the run line and the review brief.
export function failedText(p: Extract<ImproveDto, { status: "failed" }>, runner: { name: string; login: string }): string {
  if (p.kind === "usage_limit") return limitText(runner.name, p.text);
  if (p.kind === "auth") return `${p.text} Run: ${runner.login}`;
  return `The proposal failed. ${p.text}`;
}

// The proposal is the same text as the prompt that the run got.
export const unchanged = (current: string, proposal: string) => current.trim() === proposal.trim();
