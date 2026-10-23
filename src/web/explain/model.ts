// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import type { ExplainDto, ProfileDto, RunDto } from "../../shared/dto";
// The Explain page in plain words (docs/plans/review-v2/spec.md sections 3.1, 3.2, and 7.1). Pure, so the unit tests need no DOM.
import { shortHash } from "../../shared/outcome";
import type { ExplainResult, FileRole } from "../../shared/review";
import { limitText, RUN_TEXT } from "../review/model";
import { linesText, riskLink } from "./links";

export type ExplainKind = "none" | "running" | "failed" | "cancelled" | "stale" | "done";
export const START = "Explain this PR";
export const AGAIN = "Explain again";

// sentence: the status sentence, null for a current walkthrough. primary: the one primary button, or null.
// run: the newest explain run, null before the first one. shown: the walkthrough on the page. While a newer run runs, or after it
// failed or was cancelled, it is the newest result before it.
export type ExplainView = {
  kind: ExplainKind;
  sentence: string | null;
  primary: typeof START | typeof AGAIN | null;
  run: RunDto | null;
  shown: { run: RunDto; result: ExplainResult } | null;
};

export function explainView(e: ExplainDto | null | undefined, runner: string): ExplainView {
  if (!e)
    return {
      kind: "none",
      sentence: `${runner} reads the change and writes a walkthrough. About 3 to 6 min.`,
      primary: START,
      run: null,
      shown: null,
    };
  const { run } = e;
  const previous = e.previous ?? null;
  switch (run.status) {
    case "running":
      return { kind: "running", sentence: `${runner} is reading the change.`, primary: null, run, shown: previous };
    case "cancelled":
      return { kind: "cancelled", sentence: "You cancelled the walkthrough.", primary: AGAIN, run, shown: previous };
    case "failed": {
      const sentence =
        run.errorKind === "usage_limit"
          ? limitText(runner, run.errorText)
          : `${RUN_TEXT.explain.failed} ${run.errorText?.trim() || "No reason was recorded."}`;
      return { kind: "failed", sentence, primary: AGAIN, run, shown: previous };
    }
    default:
      if (!e.result) return { kind: "failed", sentence: "The stored walkthrough cannot be read.", primary: AGAIN, run, shown: previous };
      // RunDto.stale: the PR heads moved after the run (run-rows.ts toRunDto). Opening the page starts no run (AC-X7).
      return run.stale
        ? { kind: "stale", sentence: "The PR changed after this walkthrough.", primary: AGAIN, run, shown: { run, result: e.result } }
        : { kind: "done", sentence: null, primary: null, run, shown: { run, result: e.result } };
  }
}

// The time of a running run, outside the live region: "Under 1 min so far.", "2 min so far."
export function soFar(startedAt: number, now: number): string {
  const m = Math.floor(Math.max(0, now - startedAt) / 60_000);
  return m < 1 ? "Under 1 min so far." : `${m} min so far.`;
}

export const headText = (run: RunDto) => `Head ${shortHash(run.sourceHead)}`;

// The Explain profiles and the one that a start uses. Order: the profile of the shown run, the brief profile, the first one.
// The server picks the brief profile or the first one when the start names none (jobs.ts startExplain).
export function explainProfiles(
  profiles: ProfileDto[],
  brief: string | undefined,
  shown: string | undefined,
): { list: ProfileDto[]; pick: string | null } {
  const list = profiles.filter((p) => p.explain);
  const has = (id: string | undefined) => (id !== undefined && list.some((p) => p.id === id) ? id : undefined);
  return { list, pick: has(shown) ?? has(brief) ?? list[0]?.id ?? null };
}

export const ROLE_LABEL: Record<FileRole, string> = {
  core: "Core",
  supporting: "Supporting",
  tests: "Tests",
  config: "Config",
  generated: "Generated",
  docs: "Docs",
};

// The walkthrough as one Markdown text for "Copy as Markdown": every part of the page in its order. The walkthrough text stays as
// the run wrote it, with its diff: links.
export function explainMarkdown(r: ExplainResult, title: string, run: RunDto): string {
  const code = (s: string) => `\`${s.replaceAll("`", "")}\``;
  const out = [`# Walkthrough: ${title}`, "", `${headText(run)}. ${r.summary}`];
  if (r.order.length) out.push("", "## Read in this order", "", ...r.order.map((o, i) => `${i + 1}. ${code(o.path)}: ${o.why}`));
  if (r.walkthrough.trim()) out.push("", "## Walkthrough", "", r.walkthrough.trim());
  if (r.risks.length)
    out.push(
      "",
      "## Risks",
      "",
      ...r.risks.map((x) => {
        const l = riskLink(x);
        return `- ${x.text}${l ? ` (${code(l.path)}, ${linesText(l)})` : ""}`;
      }),
    );
  if (r.files.length) out.push("", "## Files", "", ...r.files.map((f) => `- ${code(f.path)} (${ROLE_LABEL[f.role]}): ${f.summary}`));
  if (r.glossary.length) out.push("", "## Words used", "", ...r.glossary.map((g) => `- **${g.term}**: ${g.meaning}`));
  return `${out.join("\n")}\n`;
}
