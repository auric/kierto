// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The open-PR confirm (docs/plans/review-v2/spec.md section 6.12): one outward dialog with the branch, the target, the title, the
// reviewers as editable chips, and the file and line counts. "Push and open PR" is the only way to push: nothing pushes before it.
import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { TaskDto, TaskPartDto } from "../../shared/dto";
import { MAX_TASK_REVIEWERS } from "../../shared/dto";
import { dialogKeys } from "../fix/CloneDialog";
import { useTaskDiff } from "./data";

export function OpenPrDialog(props: {
  t: TaskDto;
  part: TaskPartDto;
  open: boolean;
  busy: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reviewers: string[]) => void;
}) {
  const { t, part } = props;
  const [reviewers, setReviewers] = useState<string[]>(t.reviewers);
  const [name, setName] = useState("");
  const diff = useTaskDiff(t.id, part.id, part.head, props.open);
  const files = diff.data?.files.length;
  const add = () => {
    const n = name.trim();
    if (n && !reviewers.includes(n) && reviewers.length < MAX_TASK_REVIEWERS) setReviewers([...reviewers, n]);
    setName("");
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-[520px]" onKeyDown={dialogKeys(() => props.onOpenChange(false))}>
        <DialogHeader>
          <DialogTitle>
            Push <span translate="no">{part.branch}</span> and open a PR into <span translate="no">{t.targetBranch}</span>?
          </DialogTitle>
          <DialogDescription>The app pushes only this branch, and only now. It never pushes to {t.targetBranch}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <p className="m-0">
            <span className="text-ink-2">Title:</span> {t.key}: {t.title}
          </p>
          <p className="m-0 text-ink-2">
            {files === undefined ? "" : `${files} ${files === 1 ? "file" : "files"}, `}
            {part.lines === null ? "the line count is not known yet" : `${part.lines} changed lines`}
          </p>
          <div className="grid gap-1.5">
            <span id="pr-reviewers" className="text-ink-2">
              Reviewers
            </span>
            <ul aria-labelledby="pr-reviewers" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {reviewers.map((r) => (
                <li key={r} className="inline-flex items-center gap-1 rounded-[5px] border py-0.5 pr-0.5 pl-2 text-xs">
                  <span translate="no">{r}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${r}`}
                    className="inline-grid size-6 cursor-pointer place-items-center rounded-[4px] text-ink-2 hover:bg-hover hover:text-foreground"
                    onClick={() => setReviewers(reviewers.filter((x) => x !== r))}
                  >
                    <X aria-hidden className="size-3.5" />
                  </button>
                </li>
              ))}
              {!reviewers.length && (
                <li className="text-xs text-muted-foreground">No reviewer. Add a user name, or open the PR without one.</li>
              )}
            </ul>
            <div className="flex gap-2">
              <Input
                aria-label="Add a reviewer by user name"
                name="reviewer"
                placeholder="User name…"
                autoComplete="off"
                spellCheck={false}
                value={name}
                className="h-8"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  add();
                }}
              />
              <Button type="button" variant="outline" onClick={add} disabled={!name.trim()}>
                Add
              </Button>
            </div>
          </div>
          {props.error && (
            <p role="alert" className="m-0 text-destructive">
              {props.error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={props.busy} onClick={() => props.onConfirm(reviewers)}>
            {props.busy ? "Pushing…" : props.error ? "Try again" : "Push and open PR"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
