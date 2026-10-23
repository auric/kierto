// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The plan approval (docs/plans/review-v2/spec.md sections 6.1, 6.4, 6.8, and 6.12): the size with its one-line meaning and the rule
// lines, the branch with the prefix of the repository, the approved commands with the first-use warning, and the map check line. The
// header button "Approve the plan" submits this form.
// PlanParts is the Plan tab: the parts with their state in plain words, the tasks with check marks, and the lines against the limit.
import { Check, Circle } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { TaskDto, TaskPlanInput } from "../../shared/dto";
import { PART_STATE_TEXT, sizeRank, TASK_SIZES, type TaskSize } from "../../shared/task";
import { useRepoTaskSettings, useSaveBranchPrefix } from "./data";
import { codeParts, plannedBranch, prefixProblem, SIZE_LINE } from "./model";

export const PLAN_FORM = "task-plan";

// spec.md section 6.3 commands_json kinds. The build needs a test command to see red and green tests (loop.ts NO_TEST).
const KIND: Record<string, string> = { setup: "Setup", build: "Build", test: "Test", lint: "Lint" };

export function planProblem(t: TaskDto, picked: ReadonlySet<string>, warned: boolean): string | null {
  const plan = t.plan;
  if (!plan) return "The plan is not ready yet.";
  if (!plan.commands.some((c) => c.kind === "test" && picked.has(c.id)))
    return "Pick at least one test command. The build runs it to see failing and passing tests.";
  if (plan.warning && !warned) return "Read the warning and tick “I understand” first.";
  return null;
}

export function PlanApproval(props: {
  t: TaskDto;
  runner: string;
  busy: boolean;
  onSize: (size: TaskSize) => void;
  onApprove: (input: Omit<TaskPlanInput, "version">) => void;
}) {
  const { t, runner } = props;
  const plan = t.plan;
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(plan?.commands.map((c) => c.id) ?? []));
  const [warned, setWarned] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!plan) return null;
  const size = t.size ?? plan.proposed;
  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const picks = plan.commands.filter((c) => picked.has(c.id));
  return (
    <form
      id={PLAN_FORM}
      aria-label="Plan approval"
      className="grid max-w-[72ch] gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        const p = planProblem(t, picked, warned);
        setProblem(p);
        if (p) return;
        props.onApprove({ size, commands: picks.map((c) => c.id), ...(plan.warning && { warning: true }) });
      }}
    >
      <FieldSet className="gap-1.5">
        <FieldLegend className="text-sm font-semibold">Size</FieldLegend>
        <p className="m-0 text-sm text-ink-2">
          {runner} proposes: {plan.proposed}.
        </p>
        {plan.rules.map((r) => (
          <p key={r} className="m-0 text-sm text-ink-2">
            {r}
          </p>
        ))}
        {TASK_SIZES.map((s) => {
          const low = sizeRank(s) < sizeRank(plan.minimum);
          return (
            <label
              key={s}
              className={cn(
                "-mx-1.5 grid min-h-6 grid-cols-[auto_minmax(0,1fr)] gap-x-2 rounded-[5px] px-1.5 py-1",
                low ? "cursor-default opacity-60" : "cursor-pointer hover:bg-hover",
              )}
            >
              <input
                id={`task-size-${s}`}
                type="radio"
                name="task-size"
                checked={size === s}
                disabled={low || props.busy}
                className="m-0 mt-[3px] size-4 accent-foreground"
                onChange={() => props.onSize(s)}
              />
              <span className="text-sm">{SIZE_LINE[s]}</span>
              {s !== "small" && (
                <span className="col-start-2 text-xs text-muted-foreground">
                  This version builds small tasks only. A {s} plan waits after its approval.
                </span>
              )}
            </label>
          );
        })}
      </FieldSet>
      <BranchLine t={t} size={size} />
      {plan.missing > 0 && (
        <p className="m-0 text-sm text-ink-2">
          {plan.missing === 1 ? "1 map line names code that does not exist." : `${plan.missing} map lines name code that does not exist.`}{" "}
          The Spec tab marks them.
        </p>
      )}
      <FieldSet className="gap-1.5">
        <FieldLegend className="text-sm font-semibold">Commands that the app runs after each step</FieldLegend>
        {plan.commands.length === 0 && (
          <p className="m-0 text-sm text-ink-2">The plan names no command. Ask for a plan with a test command, or edit the plan.</p>
        )}
        {plan.commands.map((c) => (
          <label
            key={c.id}
            className="-mx-1.5 grid min-h-6 cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-2 rounded-[5px] px-1.5 py-1 hover:bg-hover"
          >
            <input
              type="checkbox"
              checked={picked.has(c.id)}
              className="m-0 mt-[3px] size-4 accent-foreground"
              onChange={(e) => toggle(c.id, e.target.checked)}
            />
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium">{c.name}</span>
              <Badge variant="quiet">{KIND[c.kind] ?? c.kind}</Badge>
              {c.saved && <span className="text-xs text-muted-foreground">approved before</span>}
              <code translate="no" className="basis-full font-mono text-xs [overflow-wrap:anywhere] text-ink-2">
                {c.argv.join(" ")}
              </code>
            </span>
          </label>
        ))}
      </FieldSet>
      {plan.warning && (
        <Alert>
          <AlertTitle>Before the first build in this repository</AlertTitle>
          <AlertDescription className="grid gap-2">
            <p className="m-0">
              The app will run these commands in a copy of the repository:{" "}
              <span translate="no" className="font-mono">
                {picks.length ? picks.map((c) => c.argv.join(" ")).join(", ") : "none picked"}
              </span>
              . They run code that {runner} writes. On Windows nothing limits what that code can read or reach. Run this only for code you
              would run yourself.
            </p>
            <label className="inline-flex min-h-6 cursor-pointer items-center gap-2 font-medium text-foreground">
              <input
                type="checkbox"
                checked={warned}
                className="m-0 size-4 accent-foreground"
                onChange={(e) => setWarned(e.target.checked)}
              />
              I understand
            </label>
          </AlertDescription>
        </Alert>
      )}
      {problem && (
        <p role="alert" className="m-0 text-sm text-destructive">
          {problem}
        </p>
      )}
    </form>
  );
}

// spec.md section 6.8: the build names the branch from the prefix of the repository when it starts, so a change here applies to this
// task. The prefix is a repository setting: later tasks use it too. Enter saves, and Esc closes the field.
function BranchLine({ t, size }: { t: TaskDto; size: TaskSize }) {
  const settings = useRepoTaskSettings(t.project, t.repo);
  const save = useSaveBranchPrefix(t.project, t.repo);
  // null: the field is closed.
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const change = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const stored = settings.data?.branchPrefix;
  const close = () => {
    setDraft(null);
    setProblem(null);
    save.reset();
    requestAnimationFrame(() => change.current?.focus());
  };
  const submit = () => {
    if (draft === null) return;
    const p = prefixProblem(draft);
    setProblem(p);
    if (p) return field.current?.focus();
    save.mutate(draft, { onSuccess: close });
  };
  const shown = draft !== null && prefixProblem(draft) === null ? draft : stored;
  const error = problem ?? save.error?.message ?? null;
  return (
    <FieldSet className="gap-1.5">
      <FieldLegend className="text-sm font-semibold">Branch</FieldLegend>
      {settings.error ? (
        <p role="alert" className="m-0 text-sm text-destructive">
          Cannot read the branch prefix. {settings.error.message}
        </p>
      ) : shown === undefined ? (
        <Skeleton className="h-5 w-72 max-w-full" />
      ) : (
        <>
          <p className="m-0 text-sm">
            <span className="text-ink-2">{size === "small" ? "The change goes to" : "The branches of this task start with"}</span>{" "}
            <code id="task-branch" translate="no" className="font-mono text-xs [overflow-wrap:anywhere]">
              {plannedBranch(shown, t, size)}
            </code>
          </p>
          <p className="m-0 text-xs text-muted-foreground">If a branch with this name exists, the app adds -2, -3, and so on.</p>
        </>
      )}
      {draft === null ? (
        stored !== undefined && (
          <Button ref={change} type="button" variant="outline" size="xs" className="mt-0.5 self-start" onClick={() => setDraft(stored)}>
            Change the prefix
          </Button>
        )
      ) : (
        <div className="mt-1 grid gap-1.5">
          <div className="flex flex-wrap items-end gap-2">
            <Field data-invalid={error ? true : undefined} className="w-48 gap-1.5">
              <FieldLabel htmlFor="task-prefix">Branch prefix</FieldLabel>
              <Input
                ref={field}
                id="task-prefix"
                name="branchPrefix"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                maxLength={100}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "task-prefix-help task-prefix-error" : "task-prefix-help"}
                className="h-8 font-mono"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setProblem(null);
                }}
                onKeyDown={(e) => {
                  // Enter must not submit the plan form around this field.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    close();
                  }
                }}
              />
            </Field>
            <Button type="button" variant="outline" disabled={save.isPending} onClick={submit}>
              {save.isPending ? "Saving…" : "Save the prefix"}
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
          </div>
          <FieldDescription id="task-prefix-help">
            For example feature/ or task/. Leave it empty for no prefix. New tasks in{" "}
            <span translate="no">
              {t.project}/{t.repo}
            </span>{" "}
            use it too.
          </FieldDescription>
          {error && <FieldError id="task-prefix-error">{error}</FieldError>}
        </div>
      )}
    </FieldSet>
  );
}

// "### [ ] T1.1 Title" lines of the tasks grammar (spec.md section 6.4) in the plan files of the task.
const TASK_LINE = /^### \[( |x)\] (T\d+\.\d+) (.+)$/gm;

export function plannedTasks(t: Pick<TaskDto, "docs" | "steps">) {
  const text = [t.docs?.plan, t.docs?.tasks].filter(Boolean).join("\n");
  const committed = new Set(t.steps.filter((s) => s.kind === "commit" && s.state === "ok" && s.item).map((s) => s.item as string));
  return [...text.matchAll(TASK_LINE)].map((m) => ({
    id: m[2] as string,
    title: (m[3] as string).trim(),
    done: m[1] === "x" || committed.has(m[2] as string),
  }));
}

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

// The run time of a part: the sum of its finished steps with a run.
function partTime(t: TaskDto, part: number) {
  const ms = t.steps
    .filter((s) => s.part === part && ["tests", "implement", "fix", "review"].includes(s.kind) && s.endedAt !== null)
    .reduce((n, s) => n + ((s.endedAt as number) - s.startedAt), 0);
  return ms > 0 ? `${minutes(ms)} min` : null;
}

export function PlanParts({ t }: { t: TaskDto }) {
  const parts = codeParts(t);
  const tasks = plannedTasks(t);
  const budget = t.settings.lineBudget ?? t.plan?.budget ?? null;
  const taskList = (
    <ul className="m-0 grid list-none gap-1 p-0">
      {tasks.map((k) => (
        <li key={k.id} className="flex items-start gap-2 text-sm">
          {k.done ? (
            <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
          ) : (
            <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <span>
            <span className="sr-only">{k.done ? "Done: " : "Open: "}</span>
            <code translate="no" className="mr-1.5 font-mono text-xs text-ink-2">
              {k.id}
            </code>
            {k.title}
          </span>
        </li>
      ))}
    </ul>
  );
  if (!parts.length)
    return (
      <div className="grid gap-2">
        <p className="m-0 text-sm text-ink-2">The build has not started. The plan has these tasks:</p>
        {tasks.length ? taskList : <p className="m-0 text-sm text-muted-foreground">No task yet.</p>}
      </div>
    );
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {parts.map((p) => {
        const time = partTime(t, p.id);
        return (
          <li key={p.id} data-task-item tabIndex={-1} className="grid gap-1.5 rounded-md border bg-card px-3 py-2.5 outline-offset-2">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
              <span className="font-semibold">{parts.length > 1 ? `Part ${p.ord}: ${p.title}` : p.title}</span>
              <Badge variant="quiet">{PART_STATE_TEXT[p.state]}</Badge>
              {p.remotePr !== null && <span className="text-ink-2">PR #{p.remotePr}</span>}
            </div>
            <p className="m-0 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-2">
              <span translate="no" className="font-mono">
                {p.branch}
              </span>
              {p.lines !== null && <span>{budget ? `${p.lines} of ${budget} lines` : `${p.lines} lines`}</span>}
              {time && <span>Time: {time}</span>}
              {p.usage && <span>{p.usage.turns} turns</span>}
            </p>
            {tasks.length > 0 && taskList}
          </li>
        );
      })}
    </ul>
  );
}
