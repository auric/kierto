// Fix it on the own pull request (plan r3 UI-FIX): the fix runs, "Fix all valid", the fix card of each thread, the runner prompt,
// and the fix bar with the apply dialog. The bar shows while an edit is ticked, as the post bar shows while an item is accepted.
import { useQueryClient } from "@tanstack/react-query";
import { Wrench } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import type { FixCommitDto, FixDto, MetaDto, PrRow, ReviewItemDto, RunConflict } from "../../shared/dto";
import type { ThreadModel } from "../pr/threads";
import { planKey } from "../publish/data";
import { replyKey } from "../review/data";
import { plural, shortHash } from "../review/model";
import { RunSplit } from "../review/RunSplit";
import type { Focus } from "../review/useReview";
import type { Hints } from "../shell/Hint";
import { prKey, repoOf } from "../shell/model";
import { ApplyDialog, type ApplyTarget } from "./ApplyDialog";
import { CloneFolder } from "./CloneDialog";
import { cloneKey, fixesKey, getClone, undoFix, useClone, useClones, useFixes, useStartFix } from "./data";
import { FixCard, type FixCtx } from "./FixCard";
import { handoffText } from "./handoff";
import { applyText, fixAllButton, fixState, fixThreads, selection } from "./model";

// profile: the brief profile. The menu leaves out the Explain profiles: the server refuses them (jobs.ts fix).
function FixAllButton(props: {
  n: number;
  meta: MetaDto;
  profile: { id: string; name: string };
  busy: boolean;
  onRun: (profile?: string) => void;
}) {
  const s = fixAllButton(props.n, props.profile.name);
  return (
    <RunSplit
      id="fix-all-btn"
      variant="outline"
      hint={s.hint}
      disabled={s.disabled || props.busy}
      label={`Fix all valid${s.disabled ? `. ${s.hint}` : `, ${plural(props.n, "comment")}`}`}
      menu="Fix with another profile"
      heading="Profile for this fix run"
      profiles={props.meta.profiles.filter((p) => !p.explain)}
      current={props.profile.id}
      onRun={props.onRun}
    >
      <Wrench aria-hidden data-icon="inline-start" />
      Fix all valid
      <span aria-hidden className="rounded-[4px] bg-sel px-1 text-xs font-semibold text-ink-2">
        {props.n}
      </span>
    </RunSplit>
  );
}

export type FixUi = {
  // The button next to Draft replies. null on a pull request of another author.
  button: ReactNode;
  // The fix card of each thread, keyed by thread ID.
  cards: ReadonlyMap<number, ReactNode>;
  bar: ReactNode;
  dialog: ReactNode;
  fixes: FixDto[] | undefined;
  // threads absent: each thread with a valid or partly valid reply draft, as the server selects them.
  // profile absent: the brief profile.
  run: (threads?: number[], profile?: string) => void;
  // Copies the runner prompt of the thread. Call it in the click handler. Resolves to the next step, or null.
  copyPrompt: (thread: number) => Promise<string | null>;
};

const NO_CARDS: ReadonlyMap<number, ReactNode> = new Map();

export function useFix(
  pr: PrRow,
  o: {
    meta: MetaDto;
    hints: Hints;
    threads: ThreadModel[];
    replies: ReviewItemDto[] | undefined;
    // The brief profile. Fix runs use it, unless the menu of Fix all valid gives another one.
    profile: { id: string; name: string };
    announce: (text: string) => void;
    focusAfter: (f: Focus) => void;
    onLog: (run: number) => void;
    slotTaken: (c: RunConflict) => void;
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

  const live = new Set(o.threads.flatMap((t) => (t.last ? [t.id] : [])));
  const valid = fixThreads(o.replies, live);

  const run = (ids?: number[], profile?: string) => {
    const shown = ids ?? valid;
    start.mutate(
      { threads: ids, profile },
      {
        onSuccess: (r) => {
          if ("conflict" in r) return o.slotTaken(r.conflict);
          setAsked({ run: r.run.id, threads: shown });
          void qc.invalidateQueries({ queryKey: fixesKey(pr.id) });
          announce(
            `${ids ? "Proposing a fix" : `Proposing fixes for ${plural(shown.length, "comment")}`}${profile ? ` with the ${r.run.profileName} profile` : ""}.`,
          );
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

  const open = (list ?? []).flatMap((f, i) => {
    if (f.run.status === "running") return [];
    const s = selection(f, i === 0, ticks);
    return s.edits.length ? [{ f, s }] : [];
  });
  const clones = useClones(author && open.length > 0).data;
  const folder = clones?.find((c) => c.project === pr.project && c.repo === pr.repo && !c.missing)?.path;
  const bar = author && open.length > 0 && (
    <div data-fixbar className="border-t border-rule-strong bg-pane px-6 text-sm max-[759px]:px-4">
      {open.map(({ f, s }, i) => (
        <div key={f.run.id} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 py-2.5">
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            <Wrench aria-hidden className="size-[15px] shrink-0" />
            {meta.runner.short} proposed {plural(f.edits.length, "edit")} on {shortHash(f.run.sourceHead)}.
          </span>
          <span className="rl-wide-pane text-muted-foreground">Only the ticked edits apply.</span>
          <span className="flex-1" />
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
        </div>
      ))}
    </div>
  );

  const dialog = author && (
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
  );

  return {
    button: author && (
      <FixAllButton n={valid.length} meta={meta} profile={o.profile} busy={start.isPending} onRun={(p) => run(undefined, p)} />
    ),
    cards,
    bar,
    dialog,
    fixes: list,
    run,
    copyPrompt,
  };
}
