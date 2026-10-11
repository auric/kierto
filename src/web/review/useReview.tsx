// The review half of the detail (plan v3 WP11): button, brief, run line, summary, drafts, and run log for one PR.
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import type { CommitDto, MetaDto, PrRow, ReviewItemDto, RunDetail } from "../../shared/dto";
import type { Layer } from "../keys";
import { useMeta } from "../meta";
import type { Hints } from "../shell/Hint";
import { prKey } from "../shell/model";
import { BriefComposer, ReviewButton } from "./Brief";
import { AiSummary, type DraftCtx, Drafts } from "./Drafts";
import { useBrief, useCancelRun, usePrRuns, useRun, useRuns, useStartReview } from "./data";
import { briefState, drafts, questions, runLine } from "./model";
import { RunLine } from "./RunLine";
import { BriefLine, type LogTarget, RunLog } from "./RunLog";

export type Focus = { id: string; block: ScrollLogicalPosition; flash: boolean };

export type ReviewApi = {
  rerun(): void;
  brief(): void;
  drafts(): void;
  log(): void;
  // The layer that Esc closes first, for focus at target.
  layer(target: EventTarget | null): Layer;
  close(layer: Exclude<Layer, null>): void;
};

export type ReviewUi = {
  action: ReactNode;
  brief: ReactNode;
  run: ReactNode;
  summary: ReactNode;
  drafts: ReactNode;
  sheet: ReactNode;
  api: ReviewApi;
};

export function useReview(
  pr: PrRow,
  o: { commits: CommitDto[] | undefined; hints: Hints; now: number; focusAfter: (f: Focus) => void; onSettings: () => void },
): ReviewUi {
  const meta = useMeta().data as MetaDto;
  const qc = useQueryClient();
  const brief = useBrief(pr.id);
  const prRuns = usePrRuns(pr.id);
  const latest = prRuns.data?.[0] ?? null;
  const run = useRun(latest?.id ?? null);
  const active = useRuns().data?.find((r) => r.status === "running") ?? null;
  const start = useStartReview(pr.id);
  const cancel = useCancelRun();
  const [composer, setComposer] = useState(false);
  const [log, setLog] = useState<LogTarget | null>(null);
  const [sumOpen, setSumOpen] = useState(false);
  const [openDrafts, setOpenDrafts] = useState<ReadonlyMap<number, boolean>>(new Map());
  const opener = useRef<HTMLElement | null>(null);

  // A new run shows its line at once. Its log and items come with the next fetch.
  const detail: RunDetail | null =
    latest && run.data?.run.id === latest.id ? run.data : latest ? { run: latest, events: [], items: [] } : null;
  const items = detail?.items ?? [];
  const state = briefState(brief.data, latest, active, pr.id, meta.profiles);
  const { focusAfter } = o;

  const busy = (() => {
    if (!active || active.pr === pr.id) return null;
    const other = qc.getQueryData<PrRow[]>(["prs"])?.find((p) => p.id === active.pr);
    return `${meta.runner.short} is reviewing ${other ? prKey(other) : "another pull request"}. One review runs at a time.`;
  })();

  const runNow = () =>
    start.mutate(undefined, {
      onSuccess: (r) => {
        if ("conflict" in r) {
          const other = qc.getQueryData<PrRow[]>(["prs"])?.find((p) => p.id === r.conflict.running.pr);
          toast.add({
            title: `One review runs at a time. ${meta.runner.short} is reviewing ${other ? prKey(other) : "another pull request"}.`,
          });
          return;
        }
        setComposer(false);
        focusAfter({ id: "runline-log", block: "nearest", flash: false });
      },
      onError: (e) => toast.add({ title: "The review did not start", description: e.message }),
    });

  const openBrief = () => {
    if (composer) document.getElementById("brief-note")?.focus();
    setComposer(true);
  };
  const closeBrief = () => {
    setComposer(false);
    focusAfter({ id: "review-btn", block: "nearest", flash: false });
  };

  const openLog = (agent: string | null, raw = false) => {
    if (!latest) {
      toast.add({ title: "No review has run on this pull request yet. Press r to start one." });
      return;
    }
    const at = document.activeElement;
    if (at instanceof HTMLElement && !at.closest("#run-log")) opener.current = at;
    setLog((l) => ({ agent, raw, n: (l?.n ?? 0) + 1 }));
  };
  const closeLog = () => {
    setLog(null);
    const back = opener.current?.isConnected ? opener.current : document.getElementById("runline-log");
    back?.focus({ preventScroll: true });
  };

  const openSummary = (id = "ai-sum-head") => {
    setSumOpen(true);
    focusAfter({ id, block: "start", flash: false });
  };

  const ds = drafts(items);
  const latestItems = useRef(items);
  latestItems.current = items;
  const isDraftOpen = (it: ReviewItemDto) => openDrafts.get(it.id) ?? it.status === "new";
  const onLog = useRef(openLog);
  onLog.current = openLog;
  const draftCtx = useMemo<DraftCtx>(
    () => ({
      meta,
      hints: o.hints,
      onToggle: (id) =>
        setOpenDrafts((m) => {
          const it = latestItems.current.find((x) => x.id === id);
          return new Map(m).set(id, !(m.get(id) ?? it?.status === "new"));
        }),
      onFrom: (agent) => onLog.current(agent),
    }),
    [meta, o.hints],
  );

  const api: ReviewApi = {
    // The open brief can hold an unsaved note. There, Ctrl+Enter saves and starts, so r only focuses the note.
    rerun: () => (composer || state.rerun === "compose" ? openBrief() : runNow()),
    brief: openBrief,
    drafts() {
      // prototype/v3 goDrafts: the first draft, else the summary with the questions.
      const first = ds.find((i) => i.status !== "discarded") ?? ds[0];
      if (first) {
        setOpenDrafts((m) => new Map(m).set(first.id, true));
        focusAfter({ id: `d-${first.id}`, block: "start", flash: true });
      } else if (detail?.run.summary || questions(items).length) openSummary();
      else toast.add({ title: `No drafts. Press r to start a review with ${meta.runner.name}.` });
    },
    log: () => openLog(null),
    layer(target) {
      const inSheet = target instanceof Node && !!document.getElementById("run-log")?.contains(target);
      if (composer && !inSheet) return "brief";
      return log ? "log" : null;
    },
    close: (layer) => (layer === "brief" ? closeBrief() : closeLog()),
  };

  const lineState = detail ? runLine(detail, meta.profiles, o.commits) : null;
  return {
    action: <ReviewButton state={state} open={composer} meta={meta} onClick={() => (composer ? closeBrief() : openBrief())} />,
    brief:
      composer &&
      (brief.data ? (
        <BriefComposer
          pr={pr.id}
          brief={brief.data}
          tasks={pr.tasks}
          meta={meta}
          busy={busy}
          starting={start.isPending}
          onStart={runNow}
          onClose={closeBrief}
          onSettings={o.onSettings}
        />
      ) : (
        <Skeleton className="mt-1.5 h-40 w-full rounded-lg" />
      )),
    run: detail && lineState && (
      <>
        <RunLine
          state={lineState}
          run={detail.run}
          meta={meta}
          now={o.now}
          cancelling={cancel.isPending}
          onLog={() => openLog(null)}
          onRaw={() => openLog(null, true)}
          onCancel={() => cancel.mutate(detail.run.id, { onError: (e) => toast.add({ title: "Cancel failed", description: e.message }) })}
          onGaps={() => openSummary()}
        />
        <BriefLine tasks={pr.tasks} note={detail.run.note} />
      </>
    ),
    summary: detail?.run.summary && <AiSummary run={detail.run} items={items} pr={pr} meta={meta} open={sumOpen} onOpen={setSumOpen} />,
    drafts: <Drafts items={ds} isOpen={isDraftOpen} ctx={draftCtx} />,
    sheet: log && (
      <RunLog
        detail={run.data?.run.id === latest?.id ? run.data : undefined}
        meta={meta}
        prKey={prKey(pr)}
        tasks={pr.tasks}
        now={o.now}
        target={log}
        onRaw={(show) => setLog((l) => l && { agent: null, raw: show, n: show ? l.n + 1 : l.n })}
        onClose={closeLog}
      />
    ),
    api,
  };
}
