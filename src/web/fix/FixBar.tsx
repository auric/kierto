// Fix it on the own pull request (plan r3 UI-FIX, pr-view-v4 2.11 and 2.12): the Fix button and the Fix list, the fix runs, the
// fix card of each thread, the runner prompt, and the fix part of the bottom bar with the apply dialog.
// The fix part shows while a fix run runs, and while an edit is ticked, as the post part shows while an item is accepted.
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Wrench } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import type { FixCommitDto, FixDto, MetaDto, PrRow, ReviewItemDto, RunConflict } from "../../shared/dto";
import type { ThreadModel } from "../pr/threads";
import { planKey } from "../publish/data";
import { replyKey } from "../review/data";
import { plural, shortHash } from "../review/model";
import type { Focus } from "../review/useReview";
import { Hint, type Hints } from "../shell/Hint";
import { prKey, repoOf } from "../shell/model";
import { ApplyDialog, type ApplyTarget } from "./ApplyDialog";
import { CloneFolder } from "./CloneDialog";
import { cloneKey, fixesKey, getClone, undoFix, useClone, useClones, useFixes, useStartFix } from "./data";
import { FixCard, type FixCtx } from "./FixCard";
import { FixPicker } from "./FixPicker";
import { handoffText } from "./handoff";
import { applyText, fixReason, fixState, fixTargets, OWN_ONLY, selection, threadFixWhy } from "./model";

const icon = "size-[15px] shrink-0";

export type FixUi = {
  // "Fix N" next to Draft replies. false on a pull request of another author.
  button: ReactNode;
  // The fix card of each thread, keyed by thread ID.
  cards: ReadonlyMap<number, ReactNode>;
  // The fix parts of the bottom bar, or false.
  bar: ReactNode;
  // The apply dialog and the Fix list.
  dialog: ReactNode;
  fixes: FixDto[] | undefined;
  // Opens the Fix list. thread absent: the default ticks. A thread ID: only that thread is ticked. null: no current thread.
  // A pull request of another author, a resolved thread, or a thread without a live message gives a toast.
  open: (thread?: number | null) => void;
  // Copies the runner prompt of the thread. Call it in the click handler. Resolves to the next step, or null.
  copyPrompt: (thread: number) => Promise<string | null>;
};

const NO_CARDS: ReadonlyMap<number, ReactNode> = new Map();
const NO_TICKS: ReadonlySet<number> = new Set();

export function useFix(
  pr: PrRow,
  o: {
    meta: MetaDto;
    hints: Hints;
    threads: ThreadModel[];
    replies: ReviewItemDto[] | undefined;
    // The brief profile. Each fix run uses it.
    profile: { name: string; explain: boolean };
    // busyText of the run that holds the only slot, or null.
    busy: string | null;
    // The server has the source and target head of the PR.
    synced: boolean;
    announce: (text: string) => void;
    focusAfter: (f: Focus) => void;
    onLog: (run: number) => void;
    slotTaken: (c: RunConflict) => void;
    // Opens these threads, so their fix cards mount.
    show: (threads: number[]) => void;
  },
): FixUi {
  const author = pr.role === "AUTHOR";
  const qc = useQueryClient();
  const fixes = useFixes(pr.id, author);
  const start = useStartFix(pr.id);
  // The threads of the fix run that this page started. They show a pending card while it runs.
  const [asked, setAsked] = useState<{ run: number; threads: number[] } | null>(null);
  const [ticks, setTicks] = useState<ReadonlyMap<number, boolean>>(new Map());
  const [undoing, setUndoing] = useState<ReadonlySet<number>>(new Set());
  const [target, setTarget] = useState<ApplyTarget | null>(null);
  const clone = useClone(pr.id, author && target !== null);
  // The element that takes the focus when the apply dialog closes. The dialog can read it more than once, so only an open clears it.
  const focusTo = useRef<string | null>(null);
  const threads = useRef(o.threads);
  threads.current = o.threads;
  const list = fixes.data;
  const { announce, focusAfter } = o;

  // ---------- The Fix list ----------
  const targets = useMemo(() => fixTargets(o.threads, o.replies, list), [o.threads, o.replies, list]);
  // The ticked thread IDs while the Fix list is open. null: closed.
  const [pick, setPick] = useState<ReadonlySet<number> | null>(null);
  const ticked = pick ? targets.rows.flatMap((r) => (pick.has(r.thread) ? [r.thread] : [])) : [];
  const reason = fixReason({ rows: targets.rows.length, ticked: ticked.length, synced: o.synced, profile: o.profile, busy: o.busy });

  const open = (thread?: number | null) => {
    if (!author) return void toast.add({ title: OWN_ONLY });
    if (thread === undefined) return setPick(new Set(targets.rows.flatMap((r) => (r.tick ? [r.thread] : []))));
    const t = threads.current.find((x) => x.id === thread);
    const why = threadFixWhy(t);
    if (why !== null || !t) return void toast.add({ title: why ?? "" });
    setPick(new Set([t.id]));
  };

  const propose = () => {
    if (reason.kind !== "ok" || start.isPending) return;
    const ids = ticked;
    start.mutate(
      { threads: ids },
      {
        onSuccess: (r) => {
          if ("conflict" in r) return o.slotTaken(r.conflict);
          setAsked({ run: r.run.id, threads: ids });
          setPick(null);
          o.show(ids);
          void qc.invalidateQueries({ queryKey: fixesKey(pr.id) });
          announce(ids.length === 1 ? "Proposing a fix." : `Proposing fixes for ${plural(ids.length, "comment")}.`);
        },
        onError: (e) => toast.add({ title: "The fix run did not start", description: e.message }),
      },
    );
  };

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: fixesKey(pr.id) });
    void qc.invalidateQueries({ queryKey: replyKey(pr.id) });
    void qc.invalidateQueries({ queryKey: planKey(pr.id) });
    void qc.invalidateQueries({ queryKey: cloneKey(pr.id) });
  };
  const put = (c: FixCommitDto) =>
    qc.setQueryData<FixDto[]>(fixesKey(pr.id), (old) =>
      old?.map((f) => (f.run.id === c.run ? { ...f, commits: [c, ...f.commits.filter((x) => x.id !== c.id)] } : f)),
    );

  const committed = (c: FixCommitDto, ids: number[]) => {
    put(c);
    refresh();
    announce(
      c.mode === "clone"
        ? `Committed ${c.short ?? ""} on ${c.branch ?? "the branch"}. Push it, then post the “Fixed in” reply.`
        : `Committed ${c.short ?? ""} to an app branch. Run the two commands in your clone.`,
    );
    focusTo.current = `fxc-${ids[0]}`;
    if (c.mode === "clone") setTarget(null);
  };

  // thread: the card to focus after the undo. null: the focus stays, as in the apply dialog.
  const undo = async (c: FixCommitDto, thread: number | null) => {
    if (undoing.has(c.id)) return;
    setUndoing((s) => new Set(s).add(c.id));
    try {
      const r = await undoFix(c.id);
      put(r);
      announce(r.mode === "clone" ? `Undone. Your clone is back at ${shortHash(r.before)}.` : "Undone. The app branch is deleted.");
      if (thread !== null) focusAfter({ id: `fx-${thread}`, block: "nearest", flash: false });
    } catch (e) {
      toast.add({ title: "The undo did not run", description: (e as Error).message });
    } finally {
      refresh();
      setUndoing((s) => {
        const out = new Set(s);
        out.delete(c.id);
        return out;
      });
    }
  };
  const onUndo = useRef(undo);
  onUndo.current = undo;

  const { meta, hints, onLog } = o;
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;
  // Stable, so the memo cards render again only when their own data changes.
  const ctx = useMemo<FixCtx>(
    () => ({
      meta,
      hints,
      announce,
      onLog: (r) => onLogRef.current(r),
      onTick: (id, on) => setTicks((m) => new Map(m).set(id, on)),
      onUndo: (c, thread) => void onUndo.current(c, thread),
    }),
    [meta, hints, announce],
  );

  const cards = useMemo(() => {
    if (!author) return NO_CARDS;
    const out = new Map<number, ReactNode>();
    for (const t of o.threads) {
      const s = fixState(list, t.id, asked);
      if (!s) continue;
      const busy = s.kind === "done" && !!s.commit && undoing.has(s.commit.id);
      out.set(t.id, <FixCard state={s} thread={t.id} ticks={ticks} busy={busy} ctx={ctx} />);
    }
    return out;
  }, [author, o.threads, list, asked, ticks, undoing, ctx]);

  const copyPrompt = async (thread: number) => {
    const t = threads.current.find((x) => x.id === thread);
    if (!t) return null;
    const newest = t.last && t.last.id !== t.root.id ? t.last : null;
    const text = handoffText({
      pr: prKey(pr),
      branch: pr.sourceBranch,
      place: t.anchor && { path: t.anchor.path, line: t.anchor.line },
      root: { id: t.root.id, author: t.root.who.name, text: t.root.text ?? "" },
      newest: newest && { id: newest.id, author: newest.who.name, text: newest.text ?? "" },
    });
    if (!(await copyText(text))) {
      toast.add({ title: "The clipboard is blocked here. Copy the comment by hand." });
      return null;
    }
    announce("Copied the prompt.");
    const path = await qc
      .fetchQuery({ queryKey: cloneKey(pr.id), queryFn: () => getClone(pr.id), staleTime: 30_000 })
      .then((c) => c.path)
      .catch(() => null);
    // runner.login is the command that signs the runner in. Its first word is the command of the runner.
    const command = meta.runner.login.split(" ")[0] ?? meta.runner.short;
    return `Open a terminal in ${path ?? `your clone of ${repoOf(pr)}`}, run ${command}, and paste.`;
  };

  const free = (list ?? []).flatMap((f, i) => {
    if (f.run.status === "running") return [];
    const s = selection(f, i === 0, ticks);
    return s.edits.length ? [{ f, s }] : [];
  });
  const clones = useClones(author && free.length > 0).data;
  const folder = clones?.find((c) => c.project === pr.project && c.repo === pr.repo && !c.missing)?.path;
  // The run that this page started shows before GET /fixes lists it.
  const runningRun =
    list?.find((f) => f.run.status === "running")?.run.id ?? (asked && !list?.some((f) => f.run.id === asked.run) ? asked.run : null);
  const points = asked && asked.run === runningRun ? asked.threads.length : 0;
  // Review edits: the card of the first ticked edit.
  const reviewEdits = (thread: number) => {
    o.show([thread]);
    focusAfter({ id: `fx-${thread}`, block: "start", flash: true });
  };
  const part = "inline-flex flex-wrap items-center gap-x-3 gap-y-2";
  const bar = author && (runningRun !== null || free.length > 0) && (
    <>
      {runningRun !== null && (
        <span data-fixbar className={part}>
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            <LoaderCircle aria-hidden className={`${icon} animate-spin`} />
            Fix: checking {points ? plural(points, "point") : "the points"} and proposing edits
          </span>
          <Button variant="link" size="sm" className="h-auto px-0" onClick={() => o.onLog(runningRun)}>
            Log
          </Button>
        </span>
      )}
      {free.map(({ f, s }, i) => (
        <span key={f.run.id} data-fixbar className={part}>
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            <Wrench aria-hidden className={icon} />
            Fix: {plural(f.edits.length, "edit")} proposed
          </span>
          {s.threads[0] !== undefined && (
            <Button variant="link" size="sm" className="h-auto px-0" onClick={() => reviewEdits(s.threads[0] as number)}>
              Review edits
            </Button>
          )}
          {i === 0 && folder && <CloneFolder pr={pr.id} path={folder} icons />}
          <Button
            id={`fix-apply-${f.run.id}`}
            size="sm"
            onClick={() => {
              focusTo.current = null;
              setTarget({ run: f.run.id, ...s });
            }}
          >
            {applyText(s.edits.length, s.threads.length)}
          </Button>
        </span>
      ))}
    </>
  );

  const dialog = author && (
    <>
      <FixPicker
        open={pick !== null}
        prKey={prKey(pr)}
        targets={targets}
        ticks={pick ?? NO_TICKS}
        reason={reason}
        starting={start.isPending}
        onTick={(thread, on) =>
          setPick((p) => {
            const out = new Set(p);
            if (on) out.add(thread);
            else out.delete(thread);
            return out;
          })
        }
        onPropose={propose}
        onClose={() => setPick(null)}
      />
      <ApplyDialog
        target={target}
        pr={pr.id}
        prNumber={pr.prId}
        repo={repoOf(pr)}
        fixes={list ?? []}
        clone={{ data: clone.data, error: clone.error, refetch: () => void clone.refetch() }}
        onCommitted={committed}
        onRefused={(ids) => {
          // A failed commit holds the edits, so the bar can go. The focus then goes to the card of the edits.
          focusTo.current = `fx-${ids[0]}`;
          refresh();
        }}
        onClose={() => setTarget(null)}
        ctx={ctx}
        focusTo={() => focusTo.current}
      />
    </>
  );

  const n = targets.rows.length;
  return {
    button: author && (
      <Hint label="Choose the threads to fix. Key: F. The f key fixes the current thread.">
        <Button
          id="fix-btn"
          size="sm"
          variant="outline"
          aria-label={`Fix, ${plural(n, "open thread")}`}
          aria-keyshortcuts="Shift+F"
          onClick={() => open()}
        >
          <Wrench aria-hidden data-icon="inline-start" />
          Fix
          <span aria-hidden className="rounded-[4px] bg-sel px-1 text-xs font-semibold text-ink-2">
            {n}
          </span>
        </Button>
      </Hint>
    ),
    cards,
    bar,
    dialog,
    fixes: list,
    open,
    copyPrompt,
  };
}
