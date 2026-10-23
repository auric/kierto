// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The Diff tab (docs/plans/review-v2/spec.md section 6.12): the part diff from the base commit to the part head, with the diff rows
// of the PR view (FileDiff.tsx Rows).
import { Skeleton } from "@/components/ui/skeleton";
import type { TaskPartDto } from "../../shared/dto";
import { Rows } from "../diff/FileDiff";
import { useTaskDiff } from "./data";

export function DiffTab({ task, part }: { task: number; part: TaskPartDto | null }) {
  const q = useTaskDiff(task, part?.id ?? 0, part?.head ?? null, part !== null);
  if (!part?.head) return <p className="m-0 text-sm text-muted-foreground">The diff shows after the first commit of the build.</p>;
  if (q.isPending)
    return (
      <div role="status" aria-label="Loading the diff" className="grid gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  if (q.error) return <p className="m-0 text-sm text-destructive">Cannot show the diff. {q.error.message}</p>;
  const files = q.data.files;
  if (!files.length) return <p className="m-0 text-sm text-muted-foreground">No file changed.</p>;
  return (
    <ul aria-label="Changed files" className="m-0 grid list-none gap-2 p-0">
      {files.map((f) => {
        const name = (f.path ?? f.oldPath) as string;
        return (
          <li key={name}>
            <details className="rounded-md border bg-card">
              <summary className="flex min-h-8 cursor-pointer flex-wrap items-center gap-x-3 px-3 py-1.5 text-sm">
                <code translate="no" className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]">
                  {name}
                </code>
                <span className="ml-auto text-xs text-ink-2">{f.binary ? "Binary" : `+${f.added} −${f.removed}`}</span>
              </summary>
              {f.binary ? (
                <p className="m-0 px-3 py-2 text-sm text-muted-foreground">Binary file. The diff has no lines to show.</p>
              ) : (
                <Rows rows={f.rows} label={`Changes in ${name}`} />
              )}
              {f.more > 0 && <p className="m-0 px-3 py-2 text-xs text-muted-foreground">{f.more} more lines are not shown.</p>}
            </details>
          </li>
        );
      })}
    </ul>
  );
}
