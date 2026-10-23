// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The words of the Notes block (docs/plans/review-v2/spec.md section 2.7). No DOM access, so bun test runs them directly.
import type { NoteDto, NoteRef } from "../../shared/dto";
import type { ThreadModel } from "./threads";

const STATE: Record<NonNullable<NoteRef["state"]>, string> = { OPEN: "open", MERGED: "merged", DECLINED: "declined", MISSING: "not found" };

// "PR #45 merged". own: the repository of this PR. A link to another repository names it.
export function chipText(r: NoteRef, own: { project: string; repo: string }): string {
  const name = r.project === own.project && r.repo === own.repo ? `#${r.prId}` : `${r.project}/${r.repo}#${r.prId}`;
  return `PR ${name}${r.state ? ` ${STATE[r.state]}` : ""}`;
}

export const THREAD_DELETED = "The thread was deleted.";

// "From the thread of Anna on src/build.ts line 40". A thread without a live message is deleted. null: the note names no thread.
export function fromText(n: Pick<NoteDto, "thread">, threads: readonly ThreadModel[]): string | null {
  if (n.thread === null) return null;
  const t = threads.find((x) => x.id === n.thread);
  if (!t?.last) return THREAD_DELETED;
  const at = t.anchor ? ` on ${t.anchor.path}${t.anchor.line ? ` line ${t.anchor.line}` : ""}` : "";
  return t.root.who.me ? `From your thread${at}` : `From the thread of ${t.root.who.name}${at}`;
}
