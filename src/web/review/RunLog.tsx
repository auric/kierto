// Run log sheet (prototype/v3 renderSheet, logTree, logFoot, rawBlock): one line per tool call, subagent calls nested by parent.
import { Braces, ChevronRight, CircleAlert, Copy, LoaderCircle, Ticket, User, X } from "lucide-react";
import { Fragment, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import type { MetaDto, RunDetail, RunDto } from "../../shared/dto";
import type { RunEvent, RunEventStatus } from "../../shared/run-log";
import { agoLong } from "../pr/threads";
import { useRaw } from "./data";
import {
  AGENT,
  agentInfo,
  agentPath,
  callDur,
  clockDur,
  countText,
  durLong,
  instructionsText,
  KIND_LABEL,
  type LogNode,
  limitText,
  logTree,
  seconds,
  setupText,
  shortHash,
  skillsText,
  tokenText,
  tokenTotal,
  toolCalls,
} from "./model";

const ST: Record<RunEventStatus, string> = { ok: "ok", error: "error", running: "…", stopped: "stop" };
const AG_WORD: Record<RunEventStatus, string> = { ok: "done", error: "failed", running: "running", stopped: "stopped" };
// Below this depth, rows keep the indent of the cap level and drop the tree line.
const LOG_CAP = 3;
const icon = "size-[15px] shrink-0";

// A path breaks after a slash, not inside a name.
const pathText = (s: string) =>
  s.split("/").map((part, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one path keep their order.
    <Fragment key={i}>
      {i > 0 && (
        <>
          /<wbr />
        </>
      )}
      {part}
    </Fragment>
  ));

const dur = (e: RunEvent) => {
  const s = seconds(e);
  return s === null || e.status === "running" || e.status === "stopped" ? "" : callDur(s);
};

// Brief of a run: the tasks whose text the run read (plan r3 Feature C), then your note as plain text, never as Markdown.
// The run records its tasks at its start. A run from before Release 3 has no record, so it shows no task.
export function BriefLine({ run, className }: { run: RunDto; className?: string }) {
  const tasks = run.tasks ?? [];
  const note = run.note;
  if (!tasks.length && !note.trim()) return null;
  const ids = tasks.map((t) => t.key).join(", ");
  return (
    <p className={cn("m-0 flex min-w-0 items-center gap-x-3.5 gap-y-1 text-sm text-ink-2", className)}>
      {tasks.length > 0 && (
        <span className="inline-flex flex-none items-center gap-1.5" title={`Task text that this run read: ${ids}`}>
          <Ticket aria-hidden className={cn(icon, "text-muted-foreground")} />
          <span className="sr-only">{tasks.length > 1 ? "Tasks" : "Task"}: </span>
          <code translate="no" className="font-mono text-xs">
            {ids}
          </code>
        </span>
      )}
      {note.trim() && (
        <span className="flex min-w-0 items-center gap-1.5" title={note}>
          <User aria-hidden className={cn(icon, "text-muted-foreground")} />
          <span className="min-w-0 truncate">
            <b className="font-semibold">Your note:</b> {note}
          </span>
        </span>
      )}
    </p>
  );
}

export type LogTarget = { agent: string | null; raw: boolean; n: number };

export function RunLog(props: {
  detail: RunDetail | undefined;
  meta: MetaDto;
  prKey: string;
  now: number;
  // n changes with each open request, so a second "from <agent>" click focuses the row again.
  target: LogTarget;
  onRaw: (show: boolean) => void;
  onClose: () => void;
}) {
  const { detail, meta, target } = props;
  const [folds, setFolds] = useState<ReadonlyMap<string, boolean>>(new Map());
  const list = useRef<HTMLOListElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const atEnd = useRef(true);
  const done = useRef(-1);
  const events = detail?.events;

  // An open request at an agent unfolds the agent and the agents above it.
  const [unfolded, setUnfolded] = useState(-1);
  if (events && unfolded !== target.n) {
    setUnfolded(target.n);
    const path = target.agent ? agentPath(events, target.agent) : [];
    if (path.length) setFolds((f) => new Map([...f, ...path.map((id) => [id, true] as const)]));
  }

  useLayoutEffect(() => {
    const ol = list.current;
    if (!ol || !events || done.current === target.n) return;
    done.current = target.n;
    if (target.raw) {
      document.getElementById("raw-copy")?.focus({ preventScroll: true });
      return;
    }
    const id = target.agent ? agentPath(events, target.agent)[0] : undefined;
    const row = id ? document.getElementById(`lg-${id}`) : null;
    if (!row) {
      ol.scrollTop = ol.scrollHeight;
      close.current?.focus({ preventScroll: true });
      return;
    }
    ol.scrollTop += row.getBoundingClientRect().top - ol.getBoundingClientRect().top - 8;
    atEnd.current = false;
    row.focus({ preventScroll: true });
    row.setAttribute("data-jump", "");
    row.addEventListener("blur", () => row.removeAttribute("data-jump"), { once: true });
  });

  // Live updates follow the end only while the reader is at the end.
  useLayoutEffect(() => {
    const ol = list.current;
    if (ol && atEnd.current && events) ol.scrollTop = ol.scrollHeight;
  }, [events]);

  const run = detail?.run;
  const isOpen = (e: RunEvent) => folds.get(e.id) ?? e.status !== "ok";
  const toggle = (e: RunEvent) => setFolds((f) => new Map(f).set(e.id, !isOpen(e)));

  return (
    <aside
      id="run-log"
      role="dialog"
      aria-modal="false"
      aria-labelledby="run-log-title"
      className="rl-sheet grid grid-rows-[auto_minmax(0,1fr)_auto_auto] border-l border-rule-strong bg-pane"
    >
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 border-b px-4 pt-3 pr-3 pb-2.5">
        <h2 id="run-log-title" className="m-0 text-[15px] font-bold">
          {run ? `${KIND_LABEL[run.kind]} run log` : "Run log"}
        </h2>
        <Button
          ref={close}
          variant="ghost"
          size="icon-sm"
          className="text-ink-2"
          aria-label="Close the run log"
          title="Close. Key: Esc"
          onClick={props.onClose}
        >
          <X aria-hidden />
        </Button>
        {run && (
          <>
            <p className="col-span-full m-0 text-xs text-muted-foreground">
              <span translate="no">{props.prKey}</span>, {run.profileName} profile, commit{" "}
              <code translate="no" className="font-mono">
                {shortHash(run.sourceHead)}
              </code>
              , {agoLong(run.finishedAt ?? run.startedAt, props.now)}
            </p>
            <BriefLine run={run} className="col-span-full text-xs" />
          </>
        )}
      </header>
      {detail ? (
        <ol
          ref={list}
          aria-label="Tool calls"
          className="rl-log"
          onScroll={(e) => {
            const ol = e.currentTarget;
            atEnd.current = ol.scrollTop + ol.clientHeight >= ol.scrollHeight - 8;
          }}
        >
          {logTree(detail.events).map((n) => (
            <Row key={n.e.id} n={n} depth={0} meta={meta} isOpen={isOpen} onToggle={toggle} />
          ))}
          {!detail.events.length && <li className="py-1 font-sans text-sm text-muted-foreground">No tool call yet.</li>}
        </ol>
      ) : (
        <div role="status" aria-busy="true" aria-label="Loading the run log" className="grid content-start gap-2 p-4">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      )}
      {run && target.raw && run.hasRaw ? <RawOutput id={run.id} /> : <div />}
      <footer
        aria-live="polite"
        className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5 border-t px-4 pt-2.5 pb-3.5 text-sm text-ink-2"
      >
        {detail && <Foot detail={detail} meta={meta} raw={target.raw} onRaw={props.onRaw} />}
        {detail && (
          <span data-run-setup className="text-muted-foreground">
            <span className="sr-only">Model and effort: </span>
            {setupText(detail.run, meta.runner.defaults)}
          </span>
        )}
        {detail && instructionsText(detail.run)?.short && (
          <span data-run-instructions className="text-muted-foreground" title={instructionsText(detail.run)?.long}>
            Project instructions: {instructionsText(detail.run)?.short}
          </span>
        )}
        {detail && skillsText(detail.run) && (
          <span data-run-skills className="text-muted-foreground">
            Skills: {skillsText(detail.run)}
          </span>
        )}
        {detail && instructionsText(detail.run)?.notLoaded && (
          <span data-run-not-loaded className="text-destructive">
            {instructionsText(detail.run)?.notLoaded}
          </span>
        )}
      </footer>
    </aside>
  );
}

function Row(props: { n: LogNode; depth: number; meta: MetaDto; isOpen: (e: RunEvent) => boolean; onToggle: (e: RunEvent) => void }) {
  const { n, meta } = props;
  const e = n.e;
  const tool = meta.tools[e.tool] ?? e.tool;
  if (e.tool !== AGENT) {
    return (
      <li className="rl-lr">
        <div className="rl-ll" data-st={e.status}>
          <span className="rl-ls">{ST[e.status]}</span>
          <span translate="no" className="rl-lt">
            {tool}
          </span>
          <span className="rl-lg">
            {pathText(e.target)}
            {e.note && e.status !== "running" && <span className="rl-lnote">{e.note}</span>}
          </span>
          <span className="rl-ld">{dur(e)}</span>
        </div>
      </li>
    );
  }
  const open = props.isOpen(e);
  const { words } = agentInfo(n);
  const ended = e.status === "ok" || e.status === "error";
  const result = ended ? (e.note ?? "") : "";
  const s = seconds(e);
  const name = e.agent ?? tool;
  const label = [`${name} subagent`, AG_WORD[e.status], words, ended && s !== null ? durLong(s) : "", result].filter(Boolean).join(", ");
  return (
    <li className={cn("rl-lr rl-ag", open && n.kids.length > 0 && "rl-kids")}>
      <button
        id={`lg-${e.id}`}
        type="button"
        className="rl-ll cursor-pointer"
        data-st={e.status}
        aria-expanded={open}
        aria-controls={`ag-${e.id}`}
        aria-label={label}
        onClick={() => props.onToggle(e)}
      >
        <ChevronRight aria-hidden className="rl-lchev" />
        <span className="rl-ls">
          {e.status === "running" ? <LoaderCircle aria-hidden className="inline size-[13px] animate-spin" /> : ST[e.status]}
        </span>
        <span translate="no" className="rl-lt">
          {tool}
        </span>
        <span className="rl-lg">
          <b translate="no">{name}</b> {e.target}
          <span className="rl-lnote">{[words, result].filter(Boolean).join(", ")}</span>
        </span>
        <span className="rl-ld">{ended && s !== null ? (s < 60 ? `${s.toFixed(1)} s` : clockDur(s)) : ""}</span>
      </button>
      <ol id={`ag-${e.id}`} className={cn("rl-lsub", props.depth + 1 >= LOG_CAP && "rl-cap")} hidden={!open}>
        {n.kids.map((k) => (
          <Row key={k.e.id} n={k} depth={props.depth + 1} meta={meta} isOpen={props.isOpen} onToggle={props.onToggle} />
        ))}
      </ol>
    </li>
  );
}

const linkish = "inline-flex cursor-pointer items-center gap-1 rounded text-sm font-medium text-pen hover:underline";

function Err({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-start gap-1.5 text-destructive">
      <CircleAlert aria-hidden className={cn(icon, "mt-0.5")} />
      <span>{children}</span>
    </span>
  );
}

function Foot({ detail, meta, raw, onRaw }: { detail: RunDetail; meta: MetaDto; raw: boolean; onRaw: (show: boolean) => void }) {
  const r = detail.run;
  switch (r.status) {
    case "running":
      return (
        <span className="inline-flex items-center gap-1.5">
          <LoaderCircle aria-hidden className={cn(icon, "animate-spin")} />
          Running. {toolCallsText(detail)} so far.
        </span>
      );
    case "cancelled":
      return <span>You cancelled the run. Nothing from it can be posted.</span>;
    case "failed":
      if (r.errorKind === "usage_limit") return <Err>Stopped. {limitText(meta.runner.name, r.errorText)}</Err>;
      return (
        <>
          <Err>Failed. {r.errorText ?? "No reason was recorded."}</Err>
          {r.hasRaw && (
            <button
              type="button"
              className={linkish}
              aria-expanded={raw}
              aria-controls={raw ? "raw" : undefined}
              onClick={() => onRaw(!raw)}
            >
              <Braces aria-hidden className={icon} />
              {raw ? "Hide raw output" : "Show raw output"}
            </button>
          )}
        </>
      );
    default: {
      const tokens = tokenTotal(r.usage);
      const time = r.usage ? clockDur(r.usage.durationMs / 1000) : r.finishedAt ? clockDur((r.finishedAt - r.startedAt) / 1000) : "";
      // An ask run has no items. Its answer shows in Ask, in the panel slot.
      const count = countText(detail.items, r.status === "incomplete", r.kind);
      return (
        <span>
          {count ? `Result: ${count}.` : "Answered."} {[tokens === null ? "" : tokenText(tokens), time].filter(Boolean).join(", ")}
          {tokens !== null || time ? "." : ""}
          {/* Only a review run has a summary section. The gaps of other runs show here. */}
          {r.status === "incomplete" &&
            (r.kind !== "review"
              ? ` Coverage has gaps. ${r.summary ? [...r.summary.coverage.skipped, ...r.summary.coverage.unavailable, ...r.summary.coverage.notChecked].join(" ") : ""}`
              : " Coverage has gaps. The summary lists them.")}
          {r.status === "completed" && r.kind !== "review" && r.summary?.coverage.notChecked.length
            ? ` ${r.summary.coverage.notChecked.join(" ")}`
            : null}
        </span>
      );
    }
  }
}

const toolCallsText = (d: RunDetail) => {
  const n = toolCalls(d.events);
  return `${n} tool ${n === 1 ? "call" : "calls"}`;
};

// A blocked clipboard leaves the text selected.
function RawOutput({ id }: { id: number }) {
  const q = useRaw(id, true);
  const pre = useRef<HTMLPreElement>(null);
  const selectAll = () => {
    const el = pre.current;
    if (!el) return;
    const r = document.createRange();
    r.selectNodeContents(el);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(r);
    el.focus();
    toast.add({ title: "The clipboard is blocked here. The raw output is selected: press Ctrl+C to copy it." });
  };
  const copy = () => {
    const text = q.data;
    if (text === undefined) return;
    copyText(text).then((ok) => (ok ? toast.add({ title: "Copied the raw output." }) : selectAll()));
  };
  return (
    <section id="raw" aria-labelledby="raw-title" className="grid max-h-[58dvh] grid-rows-[auto_minmax(0,1fr)] border-t">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 py-2 pr-3 pl-4">
        <h3 id="raw-title" className="m-0 text-sm font-bold">
          Raw output
        </h3>
        <span className="text-xs text-muted-foreground">Read-only. Kept with the run.</span>
        <Button id="raw-copy" variant="outline" size="sm" className="ml-auto" onClick={copy}>
          <Copy aria-hidden data-icon="inline-start" />
          Copy
        </Button>
      </div>
      {/* Chromium and Firefox put a scroll box without focusable content into the tab order. */}
      <pre
        ref={pre}
        id="raw-out"
        className="m-0 overflow-auto bg-sunken px-4 pt-2.5 pb-3.5 font-mono text-[11.5px] leading-[1.55] break-words whitespace-pre-wrap focus-visible:-outline-offset-2"
      >
        {q.error ? q.error.message : (q.data ?? "Loading…")}
      </pre>
    </section>
  );
}
