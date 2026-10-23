// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The step strip of the Task view (docs/plans/review-v2/spec.md section 6.12): "Questions › Plan › Build › Done". The current step is
// bold with aria-current="step". A done step has a check mark, so the state never rests on color alone.
import { Check } from "lucide-react";
import { Fragment } from "react";
import { cn } from "@/lib/utils";

export function StepStrip({ steps }: { steps: { label: string; current: boolean; done: boolean }[] }) {
  return (
    <ol aria-label="Steps" className="m-0 flex list-none flex-wrap items-center gap-x-1.5 gap-y-1 p-0 text-sm">
      {steps.map((s, i) => (
        <Fragment key={s.label}>
          {i > 0 && (
            <li aria-hidden className="text-muted-foreground">
              ›
            </li>
          )}
          <li
            aria-current={s.current ? "step" : undefined}
            className={cn(
              "inline-flex items-center gap-1 whitespace-nowrap",
              s.current ? "font-semibold text-foreground" : s.done ? "text-ink-2" : "text-muted-foreground",
            )}
          >
            {s.done && <Check aria-hidden className="size-3.5 shrink-0" />}
            {s.label}
            {s.done && <span className="sr-only"> (done)</span>}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}
