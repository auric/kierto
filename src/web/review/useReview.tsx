// The review half of the detail (plan v3 WP11, replies.md WP18): buttons, brief, run line, summary, drafts, reply drafts,
// and run log for one PR.
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import type { CommitDto, ItemActionInput, MetaDto, PrRow, ReviewItemDto, RunConflict, RunDetail, RunDto, RunKind } from "../../shared/dto";
import { useFix } from "../fix/FixBar";
import { canFix, fixWaiting } from "../fix/model";
import type { Layer } from "../keys";
import { useMeta } from "../meta";
import { ordered, type ThreadModel } from "../pr/threads";
import { planKey } from "../publish/data";
import { Hint, type Hints } from "../shell/Hint";
import { prKey } from "../shell/model";
import { BriefComposer, ReviewButton } from "./Brief";
import { AiSummary, type DraftCtx, Drafts, modeOf, type TriageState } from "./Drafts";
import {
  replyKey,
  sendItem,
  useBrief,
  useCancelRun,
  usePrRuns,
  useReplyDrafts,
  useRun,
  useRuns,
  useStartReplies,
  useStartRereview,
  useStartReview,
} from "./data";
import {
  briefState,
  drafts,
  kindRuns,
  latestReview,
  plural,
  questions,
  RUN_TEXT,
  replyCard,
  replyMap,
  replyOf,
  rereviewState,
  runLine,
  severityJumps,
  staleText,
  triageText,
} from "./model";
import { DraftRepliesButton, type ReplyCtx, ReplyDraftCard } from "./ReplyDraft";
import { RunLines, SeverityJumps } from "./RunLine";
import { type LogTarget, RunLog } from "./RunLog";
import { TaskChips } from "./TaskChips";
import type { TriageAction, TriageCtx } from "./Triage";

export type Focus = { id: string; block: ScrollLogicalPosition; flash: boolean };

export type ReviewApi = {
  rerun(): void;
  // Key c (plan r2 UI-RR): review the commits since the newest review run.
  rereview(): void;
  brief(): void;
  drafts(): void;
  log(): void;
  // The log sheet of one run, such as an ask run (plan r2 UI-ASK). raw: show its raw output.
  openRunLog(run: number, raw?: boolean): void;
  // Keys a, e, and d act on the draft, question, or reply draft that holds the focus (prototype/v3 triageKey).
  triage(key: "accept" | "edit" | "discard"): void;
  // A reply-draft run for one thread (replies.md step 6).
  draftReply(thread: number): void;
  // Plan r2 UI-DIFF: opens a draft and focuses it, for "Go to draft" in the diff.
  openDraft(id: number): void;
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
  // The reply draft card of each thread, keyed by thread ID.
  cards: ReadonlyMap<number, ReactNode>;
  sheet: ReactNode;
  api: ReviewApi;
  // Plan r2 UI-DIFF: the finding drafts, the source head of their run, and the reply draft of each thread.
  diff: { drafts: ReviewItemDto[]; head: string | null; replies: ReadonlyMap<number, ReviewItemDto> };
  // Plan r3 UI-FIX: the fix bar above the post bar, and the apply dialog.
  fix: { bar: ReactNode; dialog: ReactNode };
};

const NO_ITEMS: ReviewItemDto[] = [];

// A new run shows its line at once. Its log and items come with the next fetch.
// A synced push changes only `stale`, with no run event. Then only the runs list refetches (live.ts), so `stale` comes from it.
const detailOf = (r: RunDto | null, d: RunDetail | undefined): RunDetail | null =>
  r ? (d?.run.id === r.id ? { ...d, run: { ...d.run, stale: r.stale } } : { run: r, events: [], items: [] }) : null;

const doing = (r: RunDto | null) => RUN_TEXT[r?.kind ?? "review"].doing;

// Plan r2 UI-RR. It shows only when the server takes a re-review (rereviewState).
function RereviewButton({ since, busy, onClick }: { since: string; busy: boolean; onClick: () => void }) {
  return (
    <Hint label={`Review only the commits after ${since}. The open drafts carry over and get a new check. Key: c`}>
      <Button id="rereview-btn" size="sm" variant="outline" disabled={busy} aria-keyshortcuts="c" onClick={onClick}>
        Review changes since{" "}
        <code translate="no" className="font-mono">
          {since}
        </code>
      </Button>
    </Hint>
  );
}

export function useReview(
  pr: PrRow,
  o: {
    commits: CommitDto[] | undefined;
    threads: ThreadModel[];
    hints: Hints;
    now: number;
    focusAfter: (f: Focus) => void;
    // Opens and shows a thread, so its reply draft card mounts.
    reveal: (thread: number) => void;
    announce: (text: string) => void;
    onSettings: () => void;
    // Focuses the line of a draft in the diff.
    showInDiff: (draft: number) => void;
  },
): ReviewUi {
  const meta = useMeta().data as MetaDto;
  const qc = useQueryClient();
  const brief = useBrief(pr.id);
  const prRuns = usePrRuns(pr.id).data;
  // R14: the run list shows the newest run of each kind. The newest review run drives the drafts, the summary, and the brief.
  const newest = prRuns?.[0] ?? null;
  const latest = latestReview(prRuns);
  const kinds = kindRuns(prRuns);
  const newestOf = (k: RunKind) => kinds.find((r) => r.kind === k)?.id ?? null;
  const run = useRun(latest?.id ?? null);
  // Each row reads the log and the items of its run.
  const replyRun = useRun(newestOf("reply"));
  const fixRun = useRun(newestOf("fix"));
  const askRun = useRun(newestOf("ask"));
  const replies = useReplyDrafts(pr.id);
  const active = useRuns().data?.find((r) => r.status === "running") ?? null;
  const start = useStartReview(pr.id);
  const startReplies = useStartReplies(pr.id);
  const startRereview = useStartRereview(pr.id);
  const cancel = useCancelRun();
  const [composer, setComposer] = useState(false);
  // of: "line" follows the run of the run line. "review" stays on the newest review run, for its drafts. A number is a run ID.
  const [log, setLog] = useState<(LogTarget & { of: "line" | "review" | number }) | null>(null);
  const pinned = useRun(typeof log?.of === "number" ? log.of : null);
  const [sumOpen, setSumOpen] = useState(false);
  // A review run that ends while the page shows it opens the summary.
  const [watched, setWatched] = useState<{ id: number; running: boolean } | null>(null);
  if (latest && (watched?.id !== latest.id || watched.running !== (latest.status === "running"))) {
    setWatched({ id: latest.id, running: latest.status === "running" });
    if (watched?.id === latest.id && watched.running) setSumOpen(true);
  }
  const [openDrafts, setOpenDrafts] = useState<ReadonlyMap<number, boolean>>(new Map());
  const [triage, setTriage] = useState<TriageState>({ open: null, busy: new Set() });
  // The threads of the reply run that this page started. They show a pending card while it runs.
  const [asked, setAsked] = useState<{ run: number; threads: number[] } | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const detail = detailOf(latest, run.data);
  const items = detail?.items ?? NO_ITEMS;
  const replyItems = replies.data ?? NO_ITEMS;
  const state = briefState(brief.data, latest, active, pr.id, meta.profiles);
  const { focusAfter } = o;

  const busy = (() => {
    if (!active || active.pr === pr.id) return null;
    const other = qc.getQueryData<PrRow[]>(["prs"])?.find((p) => p.id === active.pr);
    return `${meta.runner.short} is ${doing(active)} ${other ? prKey(other) : "another pull request"}. One review runs at a time.`;
  })();

  const slotTaken = (c: RunConflict) => {
    const other = qc.getQueryData<PrRow[]>(["prs"])?.find((p) => p.id === c.running.pr);
    const kind = active?.id === c.running.run ? active : null;
    toast.add({
      title: `One review runs at a time. ${meta.runner.short} is ${doing(kind)} ${other ? prKey(other) : "another pull request"}.`,
    });
  };

  // profile: a profile for this review only. Absent: the brief profile.
  const runNow = (profile?: string) =>
    start.mutate(profile, {
      onSuccess: (r) => {
        if ("conflict" in r) return slotTaken(r.conflict);
        setComposer(false);
        focusAfter({ id: "runline-log", block: "nearest", flash: false });
      },
      onError: (e) => toast.add({ title: "The review did not start", description: e.message }),
    });

  const rr = rereviewState(latest, brief.data, meta.profiles);
  const rereview = () => {
    if ("why" in rr) {
      toast.add({ title: rr.why });
      return;
    }
    if (startRereview.isPending) return;
    startRereview.mutate(undefined, {
      onSuccess: (r) => {
        if ("conflict" in r) return slotTaken(r.conflict);
        focusAfter({ id: "runline-log", block: "nearest", flash: false });
      },
      onError: (e) => toast.add({ title: "The review of the new commits did not start", description: e.message }),
    });
  };

  // threads absent: every thread where it is my turn, as the server selects them (WP17). profile absent: the brief profile.
  const draftReplies = (threads?: number[], profile?: string) => {
    const ids = threads ?? o.threads.filter((t) => t.turn === "your").map((t) => t.id);
    startReplies.mutate(
      { threads, profile },
      {
        onSuccess: (r) => {
          if ("conflict" in r) return slotTaken(r.conflict);
          setAsked({ run: r.run.id, threads: ids });
          const what = threads ? "Drafting a reply" : `Drafting replies for ${plural(ids.length, "thread")}`;
          o.announce(`${what}${profile ? ` with the ${r.run.profileName} profile` : ""}.`);
        },
        onError: (e) => toast.add({ title: "The reply drafts did not start", description: e.message }),
      },
    );
  };

  const openBrief = () => {
    if (composer) document.getElementById("brief-note")?.focus();
    setComposer(true);
  };
  const closeBrief = () => {
    setComposer(false);
    focusAfter({ id: "review-btn", block: "nearest", flash: false });
  };

  const openLog = (agent: string | null, raw = false, of: "line" | "review" | number = "line") => {
    if (typeof of !== "number" && !(of === "review" ? latest : newest)) {
      toast.add({ title: "No review has run on this pull request yet. Press r to start one." });
      return;
    }
    const at = document.activeElement;
    if (at instanceof HTMLElement && !at.closest("#run-log")) opener.current = at;
    setLog((l) => ({ agent, raw, n: (l?.n ?? 0) + 1, of }));
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

  // Stable while the items stay, so the diff renders again only when they change.
  const ds = useMemo(() => (items.length ? drafts(items) : NO_ITEMS), [items]);
  const all = [...items, ...replyItems];
  const latestItems = useRef(all);
  latestItems.current = all;
  const isDraftOpen = (it: ReviewItemDto) => openDrafts.get(it.id) ?? it.status === "new";
  const onLog = useRef(openLog);
  onLog.current = openLog;
  const onDraft = useRef(draftReplies);
  onDraft.current = draftReplies;
  const onShow = useRef(o.showInDiff);
  onShow.current = o.showInDiff;
  const openDraft = useCallback(
    (id: number) => {
      setOpenDrafts((m) => new Map(m).set(id, true));
      focusAfter({ id: `d-${id}`, block: "start", flash: true });
    },
    [focusAfter],
  );

  // ---------- Triage (plan v3 WP14a) ----------
  const domId = (it: ReviewItemDto) => (it.kind === "question" ? `q-${it.id}` : it.kind === "reply" ? `rd-${it.id}` : `d-${it.id}`);
  const setBusy = (id: number, on: boolean) =>
    setTriage((s) => {
      const busy = new Set(s.busy);
      if (on) busy.add(id);
      else busy.delete(id);
      return { ...s, busy };
    });
  const putItem = (it: ReviewItemDto) => {
    qc.setQueryData<RunDetail>(["run", it.run], (old) => old && { ...old, items: old.items.map((x) => (x.id === it.id ? it : x)) });
    if (it.kind === "reply") qc.setQueryData<ReviewItemDto[]>(replyKey(pr.id), (old) => old?.map((x) => (x.id === it.id ? it : x)));
  };

  // prototype/v3 setItem: accept and discard close the item and go to the next untriaged one of the same kind.
  // A reply draft stays under its thread, so the focus stays on it.
  const advance = (it: ReviewItemDto) => {
    if (it.kind === "reply") {
      focusAfter({ id: domId(it), block: "nearest", flash: false });
    } else if (it.status === "accepted" || it.status === "discarded") {
      setOpenDrafts((m) => new Map(m).set(it.id, false));
      const same = latestItems.current.filter((x) => x.kind === it.kind && x.status !== "posted");
      const fresh = (x: ReviewItemDto) => x.id !== it.id && x.status === "new";
      const next = same.slice(same.findIndex((x) => x.id === it.id) + 1).find(fresh) ?? same.find(fresh) ?? it;
      focusAfter({ id: domId(next), block: "nearest", flash: false });
    } else {
      setOpenDrafts((m) => new Map(m).set(it.id, true));
      focusAfter({ id: domId(it), block: "nearest", flash: false });
    }
  };

  async function send(it: ReviewItemDto, input: ItemActionInput, close = false) {
    setBusy(it.id, true);
    try {
      const r = await sendItem(it.id, input);
      if ("conflict" in r) {
        putItem(r.conflict.item);
        toast.add({ title: r.conflict.error });
        return;
      }
      putItem(r.item);
      void qc.invalidateQueries({ queryKey: planKey(pr.id) });
      // The focus goes on to the next item, so the live region says what happened to this one.
      o.announce(triageText(it, r.item, input.action));
      if (close) setTriage((s) => ({ ...s, open: s.open?.id === it.id ? null : s.open }));
      if (input.action === "move") focusAfter({ id: domId(r.item), block: "nearest", flash: false });
      else advance(r.item);
    } catch (e) {
      toast.add({ title: "The change was not saved", description: (e as Error).message });
    } finally {
      setBusy(it.id, false);
    }
  }

  const openMode = (it: ReviewItemDto | null, mode: "edit" | "move") => {
    const was = triage.open;
    setTriage((s) => ({ ...s, open: it && { id: it.id, mode } }));
    if (it) {
      if (it.kind === "question") setSumOpen(true);
      setOpenDrafts((m) => new Map(m).set(it.id, true));
      return;
    }
    const back = was && latestItems.current.find((x) => x.id === was.id);
    if (back) focusAfter({ id: domId(back), block: "nearest", flash: false });
  };

  const triageFns = {
    act: (it: ReviewItemDto, action: TriageAction) => void send(it, { action, revision: it.revision }),
    edit: (it: ReviewItemDto | null) => openMode(it, "edit"),
    // An unchanged text only accepts, so the item does not get the "edited by you" mark.
    save: (it: ReviewItemDto, text: string) =>
      void send(
        it,
        text === it.body ? { action: "accept", revision: it.revision } : { action: "edit", revision: it.revision, body: text },
        true,
      ),
    move: (it: ReviewItemDto | null) => openMode(it, "move"),
    moveTo: (it: ReviewItemDto, line: number) => void send(it, { action: "move", revision: it.revision, line }, true),
  };
  const onTriage = useRef(triageFns);
  onTriage.current = triageFns;
  // Stable, so the memo drafts render again only when their own data changes.
  const triageCtx = useMemo<TriageCtx>(
    () => ({
      act: (it, a) => onTriage.current.act(it, a),
      edit: (it) => onTriage.current.edit(it),
      save: (it, t) => onTriage.current.save(it, t),
      move: (it) => onTriage.current.move(it),
      moveTo: (it, l) => onTriage.current.moveTo(it, l),
    }),
    [],
  );
  const draftCtx = useMemo<DraftCtx>(
    () => ({
      meta,
      hints: o.hints,
      onToggle: (id) =>
        setOpenDrafts((m) => {
          const it = latestItems.current.find((x) => x.id === id);
          return new Map(m).set(id, !(m.get(id) ?? it?.status === "new"));
        }),
      onFrom: (agent) => onLog.current(agent, false, "review"),
      onShowInDiff: (id) => onShow.current(id),
      triage: triageCtx,
    }),
    [meta, o.hints, triageCtx],
  );

  // ---------- Fix it (plan r3 UI-FIX) ----------
  const fix = useFix(pr, {
    meta,
    hints: o.hints,
    threads: o.threads,
    replies: replies.data,
    profile: { id: state.profile, name: state.name },
    announce: o.announce,
    focusAfter,
    onLog: (id) => openLog(null, false, id),
    slotTaken,
  });
  const onFix = useRef(fix);
  onFix.current = fix;
  const author = pr.role === "AUTHOR";

  // ---------- Reply drafts (replies.md step 6) ----------
  const replyCtx = useMemo<ReplyCtx>(
    () => ({
      meta,
      hints: o.hints,
      announce: o.announce,
      triage: triageCtx,
      again: (thread) => onDraft.current([thread]),
      fix: (thread) => onFix.current.run([thread]),
      copyPrompt: (thread) => onFix.current.copyPrompt(thread),
    }),
    [meta, o.hints, o.announce, triageCtx],
  );
  const byThread = useMemo(() => replyMap(replies.data), [replies.data]);
  const pending = asked && newest?.id === asked.run && newest.status === "running" ? asked : null;
  // Per thread, so a memo thread renders again only when its own card changes. The fix card follows the reply draft card.
  const { cards: fixCards, fixes } = fix;
  const { commits } = o;
  const cards = useMemo(() => {
    const out = new Map<number, ReactNode>();
    for (const t of o.threads) {
      const card = replyCard(byThread.get(t.id), t.last?.id ?? null, !!pending?.threads.includes(t.id));
      const fixCard = fixCards.get(t.id);
      if (!card && !fixCard) continue;
      const it = !card || card.kind === "pending" ? null : card.it;
      const p = it && replyOf(it);
      const to = p && t.msgs.find((m) => m.id === p.replyTo);
      out.set(
        t.id,
        <>
          {card && (
            <ReplyDraftCard
              card={card}
              thread={t.id}
              to={to ? (to.who.me ? "your message" : to.who.name) : null}
              mode={it ? modeOf(triage, it.id) : null}
              busy={!!it && triage.busy.has(it.id)}
              fixable={!!p && !!t.last && canFix(p, author)}
              waiting={p ? fixWaiting(p, commits, fixes) : null}
              ctx={replyCtx}
            />
          )}
          {fixCard}
        </>,
      );
    }
    return out;
  }, [o.threads, byThread, pending, triage, replyCtx, fixCards, fixes, commits, author]);

  // The open brief can hold an unsaved note. There, Ctrl+Enter saves and starts, so r only focuses the note.
  const rerun = () => (composer || state.rerun === "compose" ? openBrief() : runNow());
  const api: ReviewApi = {
    rerun,
    rereview,
    brief: openBrief,
    drafts() {
      // prototype/v3 goDrafts: the first draft, else the summary with the questions.
      // The reply drafts come next, in screen order. A press in the review drafts goes on to them.
      const first = ds.find((i) => i.status !== "discarded") ?? ds[0];
      const sum = !!detail?.run.summary || questions(items).length > 0;
      const rs = ordered(o.threads, false).flatMap((t) => {
        const it = byThread.get(t.id);
        return it ? [{ thread: t.id, it }] : [];
      });
      const reply = rs.find((r) => r.it.status !== "discarded") ?? rs[0];
      const at = document.activeElement;
      const inReview = !!at?.closest("#g-drafts") || at?.id === "ai-sum-head";
      if (reply && (inReview || (!first && !sum))) {
        o.reveal(reply.thread);
        focusAfter({ id: `rd-${reply.it.id}`, block: "start", flash: true });
      } else if (first) {
        setOpenDrafts((m) => new Map(m).set(first.id, true));
        focusAfter({ id: `d-${first.id}`, block: "start", flash: true });
      } else if (sum) openSummary();
      else toast.add({ title: `No drafts. Press r to start a review with ${meta.runner.name}.` });
    },
    log: () => openLog(null),
    openRunLog: (id, raw = false) => openLog(null, raw, id),
    triage(key) {
      const at = Number(document.activeElement?.closest("[data-item]")?.getAttribute("data-item"));
      const it = all.find((x) => x.id === at && x.status !== "posted");
      if (!it) {
        toast.add({ title: `Move to a draft or a question first. Key 2 goes to the drafts from ${meta.runner.short}.` });
        return;
      }
      if (triage.busy.has(it.id)) return;
      // items.ts refuses every action but discard on a finding without an anchor. Such a finding is always discarded.
      if (it.kind === "finding" && !it.anchor) {
        toast.add({ title: "The code of this finding is gone. It cannot come back." });
        return;
      }
      if (key === "accept") triageFns.act(it, it.status === "accepted" ? "restore" : "accept");
      else if (key === "discard") triageFns.act(it, it.status === "discarded" ? "restore" : "discard");
      else if (it.status !== "discarded") triageFns.edit(it);
    },
    draftReply: (thread) => draftReplies([thread]),
    openDraft,
    layer(target) {
      const inSheet = target instanceof Node && !!document.getElementById("run-log")?.contains(target);
      if (composer && !inSheet) return "brief";
      return log ? "log" : null;
    },
    close: (layer) => (layer === "brief" ? closeBrief() : closeLog()),
  };

  const head = latest?.sourceHead ?? null;
  const forDiff = useMemo(() => ({ drafts: ds, head, replies: byThread }), [ds, head, byThread]);
  const details = [run.data, replyRun.data, fixRun.data, askRun.data, pinned.data];
  const rows = kinds.map((r) => {
    const d = details.find((x) => x?.run.id === r.id);
    const shown = d ? { ...d.run, stale: r.stale } : r;
    return {
      run: shown,
      state: runLine(shown, d, meta.profiles, fix.fixes?.find((f) => f.run.id === r.id)?.edits.length),
      stale: staleText(shown, o.commits),
      // The severity buttons follow the result of the newest review run.
      jumps: r.id === latest?.id ? <SeverityJumps jumps={severityJumps(ds)} onJump={openDraft} /> : null,
    };
  });
  const logRun = typeof log?.of === "number" ? log.of : (log?.of === "review" ? latest : newest)?.id;
  const your = o.threads.filter((t) => t.turn === "your").length;
  return {
    action: (
      <ReviewButton
        state={state}
        meta={meta}
        extra={
          <>
            {"since" in rr && <RereviewButton since={rr.since} busy={startRereview.isPending} onClick={rereview} />}
            <DraftRepliesButton
              your={your}
              meta={meta}
              profile={{ id: state.profile, name: state.name }}
              onRun={(p) => draftReplies(undefined, p)}
            />
            {fix.button}
          </>
        }
        onRun={(p) => (p ? runNow(p) : rerun())}
        onBrief={openBrief}
      />
    ),
    // Plan r3 Feature C: every run kind reads the fetched task text. While the brief is closed, its task row shows here,
    // next to Draft replies and Fix all valid.
    brief: composer ? (
      brief.data ? (
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
          announce={o.announce}
        />
      ) : (
        <Skeleton className="mt-1.5 h-40 w-full rounded-lg" />
      )
    ) : (
      <TaskChips
        pr={pr.id}
        tasks={pr.tasks}
        meta={meta}
        id="tk-runs"
        focusTo="review-btn"
        compact
        announce={o.announce}
        onSettings={o.onSettings}
      />
    ),
    run: (
      <RunLines
        rows={rows}
        meta={meta}
        now={o.now}
        cancelling={cancel.isPending}
        onLog={(id, raw) => openLog(null, raw, id)}
        onCancel={(id) => cancel.mutate(id, { onError: (e) => toast.add({ title: "Cancel failed", description: e.message }) })}
        // Only a review run has a summary section. The log of another run kind lists the gaps.
        onGaps={(r) => (r.kind === "review" ? openSummary() : openLog(null, false, r.id))}
      />
    ),
    summary: detail?.run.summary && (
      <AiSummary run={detail.run} items={items} pr={pr} meta={meta} open={sumOpen} onOpen={setSumOpen} triage={triage} ctx={triageCtx} />
    ),
    drafts: <Drafts items={ds} isOpen={isDraftOpen} triage={triage} ctx={draftCtx} />,
    cards,
    sheet: log && (
      <RunLog
        detail={details.find((d) => d && d.run.id === logRun)}
        meta={meta}
        prKey={prKey(pr)}
        now={o.now}
        target={log}
        onRaw={(show) => setLog((l) => l && { ...l, agent: null, raw: show, n: show ? l.n + 1 : l.n })}
        onClose={closeLog}
      />
    ),
    api,
    diff: forDiff,
    fix: { bar: fix.bar, dialog: fix.dialog },
  };
}
