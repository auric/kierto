// Run line (prototype/v3 runLine): one line under the title for the newest run of the PR, of any kind. The words name the kind (R14).
// Failed, usage-limit, and cancelled runs are one line each. A re-review names its range (plan r2 UI-RR).
import { Bot, Braces, CircleAlert, CircleStop, LoaderCircle, ScrollText } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { MetaDto, RunDto } from "../../shared/dto";
import { fullTime } from "../pr/Thread";
import { agoLong } from "../pr/threads";
import { Hint } from "../shell/Hint";
import { useNow } from "../shell/Sidebar";
import { clockDur, limitText, plural, RUN_TEXT, type RunLineState, shortHash, tokenText } from "./model";

const icon = "size-[15px] shrink-0";
const linkish =
  "inline-flex cursor-pointer items-center gap-1 rounded text-sm font-medium text-pen hover:underline disabled:cursor-default disabled:opacity-60";

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

export function RunLine(props: {
  state: RunLineState;
  run: RunDto;
  meta: MetaDto;
  now: number;
  cancelling: boolean;
  onLog: () => void;
  onRaw: () => void;
  onCancel: () => void;
  onGaps: () => void;
}) {
  const { state: s, run, meta } = props;
  const words = RUN_TEXT[run.kind];
  const log = (
    <Hint label="Key: 3">
      <button id="runline-log" type="button" className={linkish} aria-keyshortcuts="3" onClick={props.onLog}>
        <ScrollText aria-hidden className={icon} />
        View log
      </button>
    </Hint>
  );
  let parts: ReactNode;
  switch (s.kind) {
    case "running":
      parts = (
        <>
          <span role="status" className="inline-flex items-center gap-1.5">
            <LoaderCircle aria-hidden className={cn(icon, "animate-spin")} />
            {run.since ? `Reviewing changes since ${shortHash(run.since.head)}…` : words.running}
          </span>
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
          <span role="status" className="inline-flex items-center gap-1.5">
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
          </span>
          <Hint label={fullTime(s.at)}>
            <time dateTime={new Date(s.at).toISOString()}>{agoLong(s.at, props.now)}</time>
          </Hint>
          <span>{s.count}</span>
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
          <span role="status" className="rl-full">
            <Err>
              {words.failed} {s.text}
            </Err>
          </span>
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
          <span role="status" className="rl-full">
            <Err>{limitText(meta.runner.name, s.text)}</Err>
          </span>
          {log}
        </>
      );
      break;
    default:
      parts = (
        <>
          <span role="status" className="inline-flex items-center gap-1.5">
            <CircleStop aria-hidden className={icon} />
            You cancelled {words.cancelled} after {plural(s.calls, "tool call")}.
          </span>
          {log}
        </>
      );
  }
  return (
    <p id="runline" className="rl-sum m-0 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
      {parts}
    </p>
  );
}
