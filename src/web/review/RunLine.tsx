// Run line (prototype/v3 runLine): one line under the title for the newest run of the PR, of any kind. The words name the kind (R14).
// Failed, usage-limit, and cancelled runs are one line each. A re-review names its range (plan r2 UI-RR).
// A running or ended run names its profile. Below it, one short line for the newest run of each other kind.
import { Bot, Braces, CircleAlert, CircleStop, LoaderCircle, ScrollText } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { MetaDto, RunDto } from "../../shared/dto";
import { fullTime, useSettled } from "../pr/Thread";
import { agoLong } from "../pr/threads";
import { Hint } from "../shell/Hint";
import { useNow } from "../shell/Sidebar";
import { clockDur, type Jump, KIND_LABEL, limitText, plural, RUN_TEXT, type RunLineState, SEVERITY, shortHash, tokenText } from "./model";

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
// full: the state takes its own line.
export function RunStatus({ state, full, children }: { state: string; full?: boolean; children: ReactNode }) {
  return (
    <span role="status" className={full ? "rl-full" : "inline-flex"}>
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

// result: runResult of the run. jumps: the severity buttons of a review run.
export type OtherRun = { run: RunDto; result: string; jumps: ReactNode };

export function OtherRuns({ list, now, onLog }: { list: OtherRun[]; now: number; onLog: (run: number) => void }) {
  if (!list.length) return null;
  return (
    <ul id="runline-other" aria-label="Newest run of each other kind" className="m-0 grid list-none gap-1 p-0 text-sm text-ink-2">
      {list.map(({ run, result, jumps }) => {
        const at = run.finishedAt ?? run.startedAt;
        const failed = run.status === "failed";
        return (
          <li key={run.id} data-run-kind={run.kind} className="rl-sum flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("inline-flex items-center gap-1.5", failed && "text-destructive")}>
              {failed && <CircleAlert aria-hidden className={icon} />}
              <span>
                <b className={cn("font-semibold", !failed && "text-foreground")}>{KIND_LABEL[run.kind]}</b>
                {result && `: ${result}`}
              </span>
            </span>
            {jumps}
            <Hint label={fullTime(at)}>
              <time dateTime={new Date(at).toISOString()}>{agoLong(at, now)}</time>
            </Hint>
            <button type="button" className={linkish} onClick={() => onLog(run.id)}>
              <ScrollText aria-hidden className={icon} />
              Log<span className="sr-only"> of {RUN_TEXT[run.kind].cancelled}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function RunLine(props: {
  state: RunLineState;
  run: RunDto;
  meta: MetaDto;
  now: number;
  cancelling: boolean;
  // The severity buttons of a review run.
  jumps: ReactNode;
  onLog: () => void;
  onRaw: () => void;
  onCancel: () => void;
  onGaps: () => void;
}) {
  const { state: s, run, meta } = props;
  const words = RUN_TEXT[run.kind];
  const steady = useSettled(run.pr);
  const state = `${run.id}:${s.kind}`;
  const log = (
    <Hint label="Key: 3">
      <button id="runline-log" type="button" className={linkish} aria-keyshortcuts="3" onClick={props.onLog}>
        <ScrollText aria-hidden className={icon} />
        View log
      </button>
    </Hint>
  );
  // A menu of a run button can pick another profile than the brief one, so the line names it.
  const profile = <span data-run-profile>{run.profileName} profile</span>;
  let parts: ReactNode;
  switch (s.kind) {
    case "running":
      parts = (
        <>
          <RunStatus state={state}>
            <LoaderCircle aria-hidden className={cn(icon, "animate-spin")} />
            {run.since ? `Reviewing changes since ${shortHash(run.since.head)}…` : words.running}
          </RunStatus>
          {profile}
          {s.agents > 0 && <span>{plural(s.agents, "agent")}</span>}
          <span>{plural(s.calls, "tool call")}</span>
          <Elapsed from={s.startedAt} />
          {log}
          <button type="button" className={linkish} disabled={props.cancelling} onClick={props.onCancel}>
            {props.cancelling ? "Cancelling…" : "Cancel"}
          </button>
        </>
      );
      break;
    case "done":
      parts = (
        <>
          <RunStatus state={state}>
            <Bot aria-hidden className={icon} />
            <span>
              {meta.runner.short} {s.verb}{" "}
              {s.changes && !s.changes.full && (
                <>
                  changes <Hash h={s.changes.from} />
                  <span aria-hidden>→</span>
                  <span className="sr-only"> to </span>
                </>
              )}
              <Hash h={s.head} />
            </span>
          </RunStatus>
          <Hint label={fullTime(s.at)}>
            <time dateTime={new Date(s.at).toISOString()}>{agoLong(s.at, props.now)}</time>
          </Hint>
          {profile}
          {s.count && <span>{s.count}</span>}
          {props.jumps}
          {s.changes?.full && (
            <span>
              The run reviewed the full change, not only the commits since <Hash h={s.changes.from} />
            </span>
          )}
          {s.gaps && (
            <button type="button" className={linkish} onClick={props.onGaps}>
              Coverage gaps
            </button>
          )}
          {s.tokens !== null && (
            <Hint label={`${s.tokens.toLocaleString()} tokens in ${plural(run.usage?.turns ?? 0, "turn")}`}>
              <span>{tokenText(s.tokens)}</span>
            </Hint>
          )}
          {s.since && <span>{s.since}</span>}
          {log}
        </>
      );
      break;
    case "failed":
      parts = (
        <>
          <RunStatus state={state} full>
            <Err>
              {words.failed} {s.text}
            </Err>
          </RunStatus>
          {s.raw && (
            <button type="button" className={linkish} onClick={props.onRaw}>
              <Braces aria-hidden className={icon} />
              Show raw output
            </button>
          )}
          {log}
        </>
      );
      break;
    case "limit":
      parts = (
        <>
          <RunStatus state={state} full>
            <Err>{limitText(meta.runner.name, s.text)}</Err>
          </RunStatus>
          {log}
        </>
      );
      break;
    default:
      parts = (
        <>
          <RunStatus state={state}>
            <CircleStop aria-hidden className={icon} />
            You cancelled {words.cancelled} after {plural(s.calls, "tool call")}.
          </RunStatus>
          {log}
        </>
      );
  }
  return (
    <p
      id="runline"
      data-mounting={!steady || undefined}
      className="rl-sum m-0 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2"
    >
      {parts}
    </p>
  );
}
