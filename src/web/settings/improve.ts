// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Pure rules of the Improve prompt dialog. No DOM access, so bun test runs them directly.
import type { ImproveDto, ImproveInput, ProfileInput } from "../../shared/dto";
import { limitText } from "../review/model";
import { type Draft, toProfiles } from "./profiles";

// The goal limit of improveInput: MAX_QUESTION of src/shared/review.ts. tests/web/improve.test.ts pins it.
export const MAX_GOAL = 4000;

export { type DiffLine, lineDiff } from "../lib/textdiff";

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
