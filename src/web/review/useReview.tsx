// The review half of the detail (plan v3 WP11, replies.md WP18, pr-view-v4 2.6): buttons, brief, run record, drafts, questions,
// reply drafts, and run log for one PR.
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import type { CommitDto, ItemActionInput, MetaDto, PrRow, ReviewItemDto, RunConflict, RunDetail, RunDto, RunKind } from "../../shared/dto";
import { busyText } from "../ask/model";
import { useFix } from "../fix/FixBar";
import { canFix, fixWaiting } from "../fix/model";
import type { Layer } from "../keys";
import { useMeta } from "../meta";
import { ordered, type ThreadModel } from "../pr/threads";
import { planKey } from "../publish/data";
import { Hint, type Hints } from "../shell/Hint";
import { prKey } from "../shell/model";
import { BriefComposer, type BriefMode, ReviewButton } from "./Brief";
import { type DraftCtx, Drafts, draftDomId, modeOf, type TriageState } from "./Drafts";
import {
  replyKey,
  saveLastProfile,
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
  newCommits,
  plural,
  questionJump,
  questions,
  replyCard,
  replyMap,
  replyOf,
  rereviewState,
  runLine,
  severityJumps,
  shortHash,
  staleText,
  triageText,
} from "./model";
import { DraftRepliesButton, type ReplyCtx, ReplyDraftCard } from "./ReplyDraft";
import { Ledger, RunRecord } from "./RunLine";
import { type LogTarget, RunLog } from "./RunLog";
import { TaskChips, useTaskContext } from "./TaskChips";
import { storedEdit, type TriageAction, type TriageCtx, writeEdit } from "./Triage";
import { contextLines, trackerOf } from "./tasks";

export type Focus = { id: string; block: ScrollLogicalPosition; flash: boolean };

export type ReviewApi = {
  // Keys r and Shift+R: open the brief. Every review starts from it.
  rerun(): void;
  // Key c (plan r2 UI-RR): open the brief for a review of the commits since the newest review run.
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
  // A review run exists, so the run record goes before the Description (plan pr-view-v4 decision D3).
  reviewed: boolean;
  // The open drafts and questions of the newest review run, for the status strip.
  draftCount: number;
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

// The open brief and the review that its Start begins.
type Composer = { kind: "review" } | { kind: "rereview" } | null;

// Plan r2 UI-RR. It shows only when the server takes a re-review (rereviewState).
function RereviewButton({ since, busy, onClick }: { since: string; busy: boolean; onClick: () => void }) {
  return (
    <Hint label={`Open the review brief for the commits after ${since}. The open drafts carry over and get a new check. Key: c`}>
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
    // Opens Settings, Task IDs: "Set up task IDs" in the brief.
    onTaskIds: () => void;
    // Opens the settings at one profile: "Edit <profile>" in the brief.
    onProfile: (id: string) => void;
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
  // The review row can show a cancelled or failed run that is newer than latest.
  const reviewRun = useRun(newestOf("review"));
  const replies = useReplyDrafts(pr.id);
  const active = useRuns().data?.find((r) => r.status === "running") ?? null;
  const start = useStartReview(pr.id);
  const startReplies = useStartReplies(pr.id);
  const startRereview = useStartRereview(pr.id);
  const cancel = useCancelRun();
  const [composer, setComposer] = useState<Composer>(null);
  // of: "line" follows the run of the run line. "review" stays on the newest review run, for its drafts. A number is a run ID.
  const [log, setLog] = useState<(LogTarget & { of: "line" | "review" | number }) | null>(null);
  const pinned = useRun(typeof log?.of === "number" ? log.of : null);
  const fetched = useTaskContext(pr.id).data;
  const [openDrafts, setOpenDrafts] = useState<ReadonlyMap<number, boolean>>(new Map());
  // An unsent edit from an earlier visit opens its editor again (plan pr-view-v4 section 5).
  const [triage, setTriage] = useState<TriageState>(() => {
    const id = storedEdit(pr.id);
    return { open: id === null ? null : { id, mode: "edit", quiet: true }, busy: new Set() };
  });
  // The threads of the reply run that this page started. They show a pending card while it runs.
  const [asked, setAsked] = useState<{ run: number; threads: number[] } | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const detail = detailOf(latest, run.data);
  const items = detail?.items ?? NO_ITEMS;
  const replyItems = replies.data ?? NO_ITEMS;
  const state = briefState(brief.data, active, pr.id, meta.profiles);
  const { focusAfter } = o;

  const where = (id: number) => {
    if (id === pr.id) return "this pull request";
    const other = qc.getQueryData<PrRow[]>(["prs"])?.find((p) => p.id === id);
    return other ? prKey(other) : "another pull request";
  };
  // The run that holds the only slot, as words. The brief cannot start until it ends.
  const busy = active ? busyText(meta.runner.short, active.kind, where(active.pr)) : null;

  const slotTaken = (c: RunConflict) => {
    const kind = active?.id === c.running.run ? active.kind : "review";
    toast.add({ title: busyText(meta.runner.short, kind, where(c.running.pr)) });
  };

  // A review runs the stored brief. Its profile becomes the last used one (decision D2).
  const runNow = () =>
    start.mutate(undefined, {
      onSuccess: (r) => {
        if ("conflict" in r) return slotTaken(r.conflict);
        saveLastProfile(r.run.profile);
        setComposer(null);
        focusAfter({ id: "runline-log", block: "nearest", flash: false });
      },
      onError: (e) => toast.add({ title: "The review did not start", description: e.message }),
    });

  const rr = rereviewState(latest, brief.data, meta.profiles);
  const rereviewNow = () => {
    if (startRereview.isPending) return;
    startRereview.mutate(undefined, {
      onSuccess: (r) => {
        if ("conflict" in r) return slotTaken(r.conflict);
        saveLastProfile(r.run.profile);
        setComposer(null);
        focusAfter({ id: "runline-log", block: "nearest", flash: false });
      },
      onError: (e) => toast.add({ title: "The review of the new commits did not start", description: e.message }),
    });
  };

  // threads absent: every thread where it is my turn, as the server selects them (WP17). The run uses the brief profile.
  const draftReplies = (threads?: number[]) => {
    const ids = threads ?? o.threads.filter((t) => t.turn === "your").map((t) => t.id);
    startReplies.mutate(
      { threads },
      {
        onSuccess: (r) => {
          if ("conflict" in r) return slotTaken(r.conflict);
          setAsked({ run: r.run.id, threads: ids });
          o.announce(threads ? "Drafting a reply." : `Drafting replies for ${plural(ids.length, "thread")}.`);
        },
        onError: (e) => toast.add({ title: "The reply drafts did not start", description: e.message }),
      },
    );
  };

  // An open brief keeps its note and only changes the review that Start begins.
  const openBrief = (next: NonNullable<Composer> = { kind: "review" }) => {
    if (composer) document.getElementById("brief-note")?.focus();
    setComposer(next);
  };
  const closeBrief = () => {
    setComposer(null);
    focusAfter({ id: "review-btn", block: "nearest", flash: false });
  };
  const rereview = () => {
    if ("why" in rr) toast.add({ title: rr.why });
    else openBrief({ kind: "rereview" });
  };
  // A re-review keeps the head of its base also when the brief profile makes it impossible, so the brief can say why.
  const mode: BriefMode =
    composer?.kind === "rereview" && latest
      ? { kind: "rereview", since: shortHash(latest.sourceHead), commits: newCommits(latest, o.commits) }
      : { kind: "review" };
  const blocked = busy ?? (mode.kind === "rereview" && "why" in rr ? rr.why : null);

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

  // Stable while the items stay, so the diff renders again only when they change.
  const ds = useMemo(() => (items.length ? drafts(items) : NO_ITEMS), [items]);
  // Plan pr-view-v4 2.7: one list of the findings, then the questions. The first untriaged one starts open.
  const list = useMemo(() => (items.length ? [...ds, ...questions(items)] : NO_ITEMS), [items, ds]);
  const firstNew = list.find((x) => x.status === "new")?.id ?? null;
  const all = [...items, ...replyItems];
  const latestItems = useRef(all);
  latestItems.current = all;
  const latestList = useRef({ list, firstNew });
  latestList.current = { list, firstNew };
  const isDraftOpen = (it: ReviewItemDto) => openDrafts.get(it.id) ?? it.id === firstNew;
  const onLog = useRef(openLog);
  onLog.current = openLog;
  const onDraft = useRef(draftReplies);
  onDraft.current = draftReplies;
  const onShow = useRef(o.showInDiff);
  onShow.current = o.showInDiff;
  // Opens a draft or a question and focuses it: "Go to draft" in the diff, the ledger, and key 2.
  const openDraft = useCallback(
    (id: number) => {
      const it = latestList.current.list.find((x) => x.id === id);
      setOpenDrafts((m) => new Map(m).set(id, true));
      focusAfter({ id: it ? draftDomId(it) : `d-${id}`, block: "start", flash: true });
    },
    [focusAfter],
  );

  // ---------- Triage (plan v3 WP14a) ----------
  const domId = (it: ReviewItemDto) => (it.kind === "reply" ? `rd-${it.id}` : draftDomId(it));
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

  // prototype/v3 setItem: accept and discard close the row and open the next untriaged row of the Drafts list.
  // A reply draft stays under its thread, so the focus stays on it.
  const advance = (it: ReviewItemDto) => {
    if (it.kind === "reply") {
      focusAfter({ id: domId(it), block: "nearest", flash: false });
    } else if (it.status === "accepted" || it.status === "discarded") {
      const same = latestList.current.list;
      const fresh = (x: ReviewItemDto) => x.id !== it.id && x.status === "new";
      const next = same.slice(same.findIndex((x) => x.id === it.id) + 1).find(fresh) ?? same.find(fresh) ?? it;
      setOpenDrafts((m) => new Map(m).set(it.id, false).set(next.id, next !== it));
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
      if (input.action !== "move") writeEdit(pr.id, it.id, null);
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
  const quiet = useRef<number | null>(null);
  quiet.current = triage.open?.quiet ? triage.open.id : null;
  // Stable, so the memo drafts render again only when their own data changes.
  const prId = pr.id;
  const triageCtx = useMemo<TriageCtx>(
    () => ({
      pr: prId,
      act: (it, a) => onTriage.current.act(it, a),
      edit: (it) => onTriage.current.edit(it),
      save: (it, t) => onTriage.current.save(it, t),
      move: (it) => onTriage.current.move(it),
      moveTo: (it, l) => onTriage.current.moveTo(it, l),
      quiet: (id) => quiet.current === id,
    }),
    [prId],
  );
  // The questions ask the author. On your own PR, the runner asks you as the author.
  const asker = pr.role === "AUTHOR" ? "the author" : ((pr.authorName ?? pr.authorSlug ?? "the author").split(/\s+/)[0] ?? "the author");
  const draftCtx = useMemo<DraftCtx>(
    () => ({
      meta,
      asker,
      onToggle: (id) => setOpenDrafts((m) => new Map(m).set(id, !(m.get(id) ?? id === latestList.current.firstNew))),
      onFrom: (agent) => onLog.current(agent, false, "review"),
      onShowInDiff: (id) => onShow.current(id),
      triage: triageCtx,
    }),
    [meta, asker, triageCtx],
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

  const api: ReviewApi = {
    rerun: () => openBrief(),
    rereview,
    brief: () => openBrief(),
    drafts() {
      // prototype/v3 goDrafts: the first row of the Drafts section that is not discarded.
      // The reply drafts come next, in screen order. A press in the Drafts section goes on to them.
      const first = list.find((i) => i.status !== "discarded") ?? list[0];
      const rs = ordered(o.threads, false).flatMap((t) => {
        const it = byThread.get(t.id);
        return it ? [{ thread: t.id, it }] : [];
      });
      const reply = rs.find((r) => r.it.status !== "discarded") ?? rs[0];
      const inReview = !!document.activeElement?.closest("#s-drafts");
      if (reply && (inReview || !first)) {
        o.reveal(reply.thread);
        focusAfter({ id: `rd-${reply.it.id}`, block: "start", flash: true });
      } else if (first) openDraft(first.id);
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
  const details = [run.data, reviewRun.data, replyRun.data, fixRun.data, askRun.data, pinned.data];
  const tracker = trackerOf(meta);
  // The task text that a run read, as the run setup names it.
  const taskText = (r: RunDto) => {
    const lines = tracker ? contextLines(fetched ?? [], r, tracker.name, o.now) : [];
    if (lines.length) return `Task text: ${lines.join("; ")}`;
    return tracker?.configured ? "No task text fetched." : "No context source is set up.";
  };
  const qJump = questionJump(items);
  const rows = kinds.map((r) => {
    const d = details.find((x) => x?.run.id === r.id);
    const shown = d ? { ...d.run, stale: r.stale } : r;
    return {
      run: shown,
      state: runLine(shown, d, meta.profiles, fix.fixes?.find((f) => f.run.id === r.id)?.edits.length),
      stale: staleText(shown, o.commits),
      // The ledger follows the drafts of latestReview. The record shows it only for a done run.
      ledger:
        r.kind === "review" ? <Ledger jumps={severityJumps(ds)} questions={qJump} onDraft={openDraft} onQuestion={openDraft} /> : null,
      context: taskText(shown),
    };
  });
  const logRun = typeof log?.of === "number" ? log.of : (log?.of === "review" ? latest : newest)?.id;
  return {
    action: (
      <ReviewButton
        state={state}
        meta={meta}
        extra={
          <>
            {"since" in rr && <RereviewButton since={rr.since} busy={startRereview.isPending} onClick={rereview} />}
            <DraftRepliesButton turns={o.threads.map((t) => t.turn)} onRun={() => draftReplies()} />
            {fix.button}
          </>
        }
        onOpen={() => openBrief()}
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
          mode={mode}
          blocked={blocked}
          starting={start.isPending || startRereview.isPending}
          onStart={() => (mode.kind === "rereview" ? rereviewNow() : runNow())}
          onClose={closeBrief}
          onSettings={o.onSettings}
          onTaskIds={o.onTaskIds}
          onEditProfile={o.onProfile}
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
      <RunRecord
        rows={rows}
        meta={meta}
        now={o.now}
        cancelling={cancel.isPending}
        onLog={(id, raw) => openLog(null, raw, id)}
        onCancel={(id) => cancel.mutate(id, { onError: (e) => toast.add({ title: "Cancel failed", description: e.message }) })}
      />
    ),
    reviewed: latest !== null,
    draftCount: ds.filter((d) => d.status !== "discarded").length + (qJump?.n ?? 0),
    drafts: <Drafts items={list} isOpen={isDraftOpen} triage={triage} ctx={draftCtx} />,
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
