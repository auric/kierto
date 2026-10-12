// Run list (R14, prototype/v3 runLine): one row for the newest run of each kind, newest first. Each row has the same parts:
// the kind, the state or the result, the time, and Log in its own column. Below them, the inputs of the run.
// Failed, usage-limit, and cancelled runs are one row each. A re-review names its range (plan r2 UI-RR).
import { Bot, Braces, CircleAlert, CircleStop, Cpu, GitCommitHorizontal, LoaderCircle, ScrollText, Ticket, User } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { MetaDto, RunDto } from "../../shared/dto";
import { fullTime, useSettled } from "../pr/Thread";
import { agoLong } from "../pr/threads";
import { Hint } from "../shell/Hint";
import { useNow } from "../shell/Sidebar";
import { clockDur, type Jump, KIND_LABEL, limitText, plural, RUN_TEXT, type RunLineState, SEVERITY, setupText, shortHash } from "./model";

const icon = "size-[15px] shrink-0";
const jump = "inline-flex cursor-pointer items-center gap-1 rounded text-sm font-medium hover:underline";
const linkish = `${jump} text-pen disabled:cursor-default disabled:opacity-60`;

function Elapsed({ from }: { from: number }) {
  const now = useNow(true);
  return <span>{clockDur(Math.max(0, now - from) / 1000)}</span>;
}

const Hash = ({ h }: { h: string }) => (
  <code translate="no" className="font-mono text-[0.95em] text-foreground">
    {h}
  </code>
);

function Err({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-start gap-1.5 text-destructive">
      <CircleAlert aria-hidden className={cn(icon, "mt-0.5")} />
      <span>{children}</span>
    </span>
  );
}

// The outer span is a live region that stays, so a screen reader reads each later state. The key gives each state a new node.
// full: the state takes its own line. quiet: no live region.
export function RunStatus({ state, full, quiet, children }: { state: string; full?: boolean; quiet?: boolean; children: ReactNode }) {
  return (
    <span role={quiet ? undefined : "status"} className={full ? "rl-full" : "inline-flex"}>
      <span key={state} className="rl-fade inline-flex items-center gap-1.5">
        {children}
      </span>
    </span>
  );
}

// The open drafts per severity. Each button goes to the first draft of its severity.
export function SeverityJumps({ jumps, onJump }: { jumps: Jump[]; onJump: (draft: number) => void }) {
  if (!jumps.length) return null;
  return (
    <span data-severity-jumps className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {jumps.map((j) => (
        <Hint key={j.severity} label={`Go to the first ${SEVERITY[j.severity]} draft`}>
          <button
            type="button"
            data-severity={j.severity}
            // Hue rule: the error hue marks only errors and Blocker findings. The word carries the severity.
            className={cn(jump, j.severity === "blocker" ? "text-destructive" : "text-pen")}
            onClick={() => onJump(j.first)}
          >
            {j.severity === "blocker" && <CircleAlert aria-hidden className={icon} />}
            {j.n} {SEVERITY[j.severity]}
          </button>
        </Hint>
      ))}
    </span>
  );
}

// stale: staleText of the run. jumps: the severity buttons of the newest review run.
export type KindRun = { run: RunDto; state: RunLineState; stale: string | null; jumps: ReactNode };

type RowProps = {
  meta: MetaDto;
  now: number;
  cancelling: boolean;
  onLog: (run: number, raw?: boolean) => void;
  onCancel: (run: number) => void;
  onGaps: (run: RunDto) => void;
};

// Three columns that all rows share: the kind, the state with its time, and Log. A narrow pane puts the state below the kind.
export function RunLines({ rows, ...props }: RowProps & { rows: KindRun[] }) {
  const steady = useSettled(rows[0]?.run.pr);
  if (!rows.length) return null;
  return (
    <ul
      id="runline"
      aria-label="Newest run of each kind"
      data-mounting={!steady || undefined}
      className="m-0 mt-0.5 grid list-none grid-cols-[6.5rem_minmax(0,1fr)_auto] gap-x-3 gap-y-2 p-0 text-sm text-ink-2 @max-[560px]/detail:grid-cols-[minmax(0,1fr)_auto]"
    >
      {rows.map((row, i) => (
        <RunRow key={row.run.kind} row={row} first={i === 0} {...props} />
      ))}
    </ul>
  );
}

// first: the newest run. Only it can run, so only its state is a live region. Key 3 opens its log.
function RunRow({ row, first, meta, now, cancelling, onLog, onCancel, onGaps }: RowProps & { row: KindRun; first: boolean }) {
  const { run, state: s } = row;
  const state = `${run.id}:${s.kind}`;
  const at = run.finishedAt ?? run.startedAt;
  // The log footer also shows the tokens. Here they stay in the hint, so the row keeps one line.
  const tokens =
    s.kind === "done" && s.tokens !== null ? `. ${s.tokens.toLocaleString()} tokens in ${plural(run.usage?.turns ?? 0, "turn")}` : "";
  const time = (
    <Hint label={`${fullTime(at)}${tokens}`}>
      <time dateTime={new Date(at).toISOString()}>{agoLong(at, now)}</time>
    </Hint>
  );
  let parts: ReactNode;
  switch (s.kind) {
    case "running":
      parts = (
        <>
          <RunStatus state={state} quiet={!first}>
            <LoaderCircle aria-hidden className={cn(icon, "animate-spin")} />
            {run.since ? `Reviewing changes since ${shortHash(run.since.head)}…` : RUN_TEXT[run.kind].running}
          </RunStatus>
          {s.agents > 0 && <span>{plural(s.agents, "agent")}</span>}
          <span>{plural(s.calls, "tool call")}</span>
          <Elapsed from={s.startedAt} />
          <button type="button" className={linkish} disabled={cancelling} onClick={() => onCancel(run.id)}>
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
        </>
      );
      break;
    case "done":
      parts = (
        <>
          <RunStatus state={state} quiet={!first}>
            {s.result || "Done"}
          </RunStatus>
          {row.jumps}
          {s.gaps && (
            <button type="button" className={linkish} onClick={() => onGaps(run)}>
              Coverage gaps
            </button>
          )}
          {time}
        </>
      );
      break;
    case "failed":
      parts = (
        <>
          <RunStatus state={state} quiet={!first} full>
            <Err>Failed. {s.text}</Err>
          </RunStatus>
          {s.raw && (
            <button type="button" className={linkish} onClick={() => onLog(run.id, true)}>
              <Braces aria-hidden className={icon} />
              Show raw output
            </button>
          )}
          {time}
        </>
      );
      break;
    case "limit":
      parts = (
        <>
          <RunStatus state={state} quiet={!first} full>
            <Err>{limitText(meta.runner.name, s.text)}</Err>
          </RunStatus>
          {time}
        </>
      );
      break;
    default:
      parts = (
        <>
          <RunStatus state={state} quiet={!first}>
            <CircleStop aria-hidden className={icon} />
            {s.calls === null ? "Cancelled" : `Cancelled after ${plural(s.calls, "tool call")}`}
          </RunStatus>
          {time}
        </>
      );
  }
  return (
    <li data-run-kind={run.kind} data-run-state={s.kind} className="col-span-full grid grid-cols-subgrid items-baseline gap-y-0.5">
      <span className="font-semibold text-foreground">{KIND_LABEL[run.kind]}</span>
      <p className="rl-sum m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 @max-[560px]/detail:col-span-2 @max-[560px]/detail:row-start-2">
        {parts}
      </p>
      <Hint label="Key: 3" disabled={!first}>
        <button
          id={first ? "runline-log" : undefined}
          type="button"
          className={cn(linkish, "@max-[560px]/detail:col-start-2 @max-[560px]/detail:row-start-1")}
          aria-keyshortcuts={first ? "3" : undefined}
          onClick={() => onLog(run.id)}
        >
          <ScrollText aria-hidden className={icon} />
          Log<span className="sr-only"> of the {KIND_LABEL[run.kind].toLowerCase()} run</span>
        </button>
      </Hint>
      <Inputs run={run} stale={row.stale} />
    </li>
  );
}

// What the run read: the commit or the range, the profile, the model and the effort, the tasks of plan r3 Feature C, and your note as plain text.
// A menu of a run button can pick another profile than the brief one, so the row names it.
// The run records its tasks at its start. A run from before Release 3 has no record, so it shows no task.
function Inputs({ run, stale }: { run: RunDto; stale: string | null }) {
  const tasks = run.tasks ?? [];
  const ids = tasks.map((t) => t.key).join(", ");
  const range = run.since?.incremental ? shortHash(run.since.head) : null;
  const item = "inline-flex items-center gap-1.5";
  return (
    <p className="col-span-2 col-start-2 m-0 flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-0.5 text-(length:--fs-s) text-muted-foreground @max-[560px]/detail:col-start-1">
      <span className={item}>
        <GitCommitHorizontal aria-hidden className={icon} />
        <span>
          <span className="sr-only">{range ? "Changes " : "Commit "}</span>
          {range && (
            <>
              <Hash h={range} />
              <span aria-hidden className="mx-1">
                →
              </span>
              <span className="sr-only"> to </span>
            </>
          )}
          <Hash h={shortHash(run.sourceHead)} />
        </span>
      </span>
      {run.since && !run.since.incremental && (
        <span>
          The run reviewed the full change, not only the commits since <Hash h={shortHash(run.since.head)} />
        </span>
      )}
      {stale && <span>{stale}</span>}
      <span className={item}>
        <Bot aria-hidden className={icon} />
        {run.profileName} profile
      </span>
      <span className={item} data-run-setup>
        <Cpu aria-hidden className={icon} />
        <span className="sr-only">Model and effort: </span>
        {setupText(run)}
      </span>
      {tasks.length > 0 && (
        <span className={item} title={`Task text that this run read: ${ids}`}>
          <Ticket aria-hidden className={icon} />
          <span className="sr-only">{tasks.length > 1 ? "Tasks" : "Task"}: </span>
          <code translate="no" className="font-mono">
            {ids}
          </code>
        </span>
      )}
      {run.note.trim() && (
        // It fills the rest of the line and cuts the text. With less than 10rem left, it takes the next line.
        <span className="flex min-w-40 flex-1 basis-0 items-center gap-1.5" title={run.note}>
          <User aria-hidden className={icon} />
          <span className="min-w-0 truncate">
            <b className="font-semibold">Your note:</b> {run.note}
          </span>
        </span>
      )}
    </p>
  );
}
