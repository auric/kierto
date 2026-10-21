// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The rows of the run record (plan r2 R14): the newest run of each kind with its state, its stale note, its ledger, and its task text.
import type { CommitDto, FixDto, MetaDto, ReviewItemDto, RunDetail, RunDto, RunKind } from "../../shared/dto";
import { useRun } from "./data";
import { questionJump, runLine, severityJumps, staleText } from "./model";
import { Ledger } from "./RunLine";
import { useTaskContext } from "./TaskChips";
import { contextLines, trackerOf } from "./tasks";

export function useRunRecord(
  pr: number,
  o: {
    meta: MetaDto;
    // The newest run of each kind.
    kinds: RunDto[];
    // The details of the newest review run and of the run that the log sheet pins.
    review: RunDetail | undefined;
    pinned: RunDetail | undefined;
    findings: ReviewItemDto[];
    items: ReviewItemDto[];
    fixes: FixDto[] | undefined;
    commits: CommitDto[] | undefined;
    now: number;
    openDraft: (id: number) => void;
  },
) {
  const { meta, kinds } = o;
  const newestOf = (k: RunKind) => kinds.find((r) => r.kind === k)?.id ?? null;
  // Each row reads the log and the items of its run.
  const replyRun = useRun(newestOf("reply"));
  const fixRun = useRun(newestOf("fix"));
  const askRun = useRun(newestOf("ask"));
  const sessionRun = useRun(newestOf("session"));
  // The review row can show a cancelled or failed run that is newer than latest.
  const reviewRun = useRun(newestOf("review"));
  const fetched = useTaskContext(pr).data;

  const details = [o.review, reviewRun.data, replyRun.data, fixRun.data, askRun.data, sessionRun.data, o.pinned];
  const tracker = trackerOf(meta);
  // The task text that a run read, as the run setup names it.
  const taskText = (r: RunDto) => {
    const lines = tracker ? contextLines(fetched ?? [], r, tracker.name, o.now) : [];
    if (lines.length) return `Task text: ${lines.join("; ")}`;
    return tracker?.configured ? "No task text fetched." : "No context source is set up.";
  };
  const qJump = questionJump(o.items);
  const rows = kinds.map((r) => {
    const d = details.find((x) => x?.run.id === r.id);
    const shown = d ? { ...d.run, stale: r.stale } : r;
    return {
      run: shown,
      state: runLine(shown, d, meta.profiles, o.fixes?.find((f) => f.run.id === r.id)?.edits.length),
      stale: staleText(shown, o.commits),
      // The ledger follows the drafts of latestReview. The record shows it only for a done run.
      ledger:
        r.kind === "review" ? (
          <Ledger jumps={severityJumps(o.findings)} questions={qJump} onDraft={o.openDraft} onQuestion={o.openDraft} />
        ) : null,
      context: taskText(shown),
    };
  });
  return { rows, details, qJump };
}
