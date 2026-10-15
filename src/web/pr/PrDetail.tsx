// PR detail (plan v3 WP5, r2 UI-ASK, r2 UI-DIFF, pr-view-v4 section 2): header and status strip, then one column of the run record,
// Description, Threads, Files, Commits, and Ask. The run record goes after the Description until a review exists (decision D3).
import { useMutation } from "@tanstack/react-query";
import { type Ref, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import type { CommentDto, PrRow } from "../../shared/dto";
import { archived } from "../../shared/views";
import { AskPanel } from "../ask/AskPanel";
import { fileCount, useDiffIndex } from "../diff/data";
import { type DiffCtx, DiffSection, useDiffView } from "../diff/FileDiff";
import type { Card } from "../diff/model";
import type { Layer } from "../keys";
import { type FileRef, restoreScroll } from "../lib/route";
import { useMeta } from "../meta";
import { PostsGroup, useOutbox } from "../publish/Outbox";
import { usePostBar } from "../publish/PostBar";
import { type Focus, useReview } from "../review/useReview";
import { ApiError, sendSeen, usePr } from "../shell/data";
import { createHints, SharedHint } from "../shell/Hint";
import { useMinute } from "../shell/ListPane";
import { ArchiveNotice, Calm } from "../states";
import { Header, Strip, webLink } from "./Header";
import type { ReplyTarget } from "./ReplyComposer";
import { CommitsFold, Description } from "./Sections";
import { type ThreadCtx, useSettled } from "./Thread";
import { Threads } from "./ThreadList";
import { buildThreads, mergeHighlights, newMessages, ordered, type Person, passes, reveal, shownThreads, summary } from "./threads";
import { useAck } from "./useAck";

// The shell calls these for the detail keys (keys.ts effects).
export type DetailApi = {
  // Opens the thread that put the PR in the inbox and focuses its message. Waits for the data when it is not loaded yet.
  cause(): void;
  step(d: 1 | -1): void;
  toggle(): void;
  nextNew(d: 1 | -1): void;
  nextYour(): void;
  section(id: "files" | "commits"): void;
  // Plan r2 UI-DIFF: g d focuses the line of the focused inline thread or draft in the diff.
  showInDiff(): void;
  // Plan r2 UI-ASK: q opens the Ask section with the focus in its box.
  ask(): void;
  // Plan v3 WP11: r, Shift+R, 2, 3, and the Esc layers of the review. Plan r2 UI-RR: c.
  rerun(): void;
  rereview(): void;
  brief(): void;
  drafts(): void;
  log(): void;
  // Plan v3 WP14a: a, e, d, and p.
  triage(key: "accept" | "edit" | "discard"): void;
  post(): void;
  layer(target: EventTarget | null): Layer;
  close(layer: Exclude<Layer, null>): void;
};

// The URL state that the detail restores on mount and on each Back or Forward (plan pr-view-v4 section 5).
// key: the PR (prKeyOf). close: the file of the entry that Back or Forward left. scroll: the saved scrollTop, null for none.
export type DetailAt = {
  key: string;
  thread: number | null;
  file: FileRef | null;
  close: string | null;
  scroll: number | null;
  n: number;
};
export type DetailPatch = { thread?: number | null; file?: FileRef | null };

// The rows of an open Files section, in screen order. Both file lists put the row button first in its item.
const FILE_ROWS = "#s-files[open] ul[aria-label='Changed files'] > li > button";

const NO_COMMENTS: CommentDto[] = [];
const NONE: ReadonlySet<number> = new Set();

const toggled = <T,>(s: ReadonlySet<T>, v: T) => {
  const out = new Set(s);
  if (!out.delete(v)) out.add(v);
  return out;
};

// A jump target shows a short highlight. Reduced motion keeps only the focus ring.
// The highlight has no end keyframe, so it ends on the own background of the target, such as the fill of a diff line.
function flash(el: HTMLElement) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const css = getComputedStyle(el);
  const from = css.getPropertyValue("--sel").trim();
  el.animate([{ backgroundColor: from, offset: 0 }], {
    duration: 900,
    easing: css.getPropertyValue("--ease-out").trim(),
  });
}

// onLeave: the shell moves the selection away before the PR leaves the list. onSettings: the brief links to the task ID rules.
// onTaskIds: a header task chip without a link opens Settings, Task IDs. onProfile: "Edit <profile>" in the brief opens the
// settings at one profile. onRestore: the Archive view brings the PR back.
// at: the URL state to restore. file: the file path in the URL. onRoute: the current thread and the opened file go to the URL.
export function PrDetail({
  pr: row,
  me,
  at,
  file,
  onRoute,
  onLeave,
  onSettings,
  onTaskIds,
  onProfile,
  onRestore,
  ref,
}: {
  pr: PrRow;
  me: string | null;
  at: DetailAt | null;
  file: string | null;
  onRoute: (patch: DetailPatch) => void;
  onLeave: () => void;
  onSettings: () => void;
  onTaskIds: () => void;
  onProfile: (id: string) => void;
  onRestore: (pr: PrRow) => void;
  ref: Ref<DetailApi | null>;
}) {
  const q = usePr(row.id);
  const data = q.data;
  const pr = data?.pr ?? row;
  const comments = data?.comments ?? NO_COMMENTS;
  const meta = useMeta().data;
  const forge = meta?.forge.name ?? "";
  const runner = meta?.runner.name ?? "";
  const now = useMinute();
  const [hints] = useState(createHints);
  const steady = useSettled(data ? row.id : null);
  // The last visit before this one. The POST below moves the stored value to now.
  const [since] = useState(row.seenAt);
  const { mutate: markSeen } = useMutation({ mutationFn: () => sendSeen(row.id) });
  useEffect(() => markSeen(), [markSeen]);

  // Highlights keep the messages that were new at open, so they stay marked after the read.
  const [hl, setHl] = useState(NONE);
  const next = mergeHighlights(hl, comments);
  if (next !== hl) setHl(next);
  const { role, authorSlug, authorName } = pr;
  const threads = useMemo(
    () => buildThreads(comments, next, me, { role, authorSlug, authorName }),
    [comments, next, me, role, authorSlug, authorName],
  );
  const latest = useRef(threads);
  latest.current = threads;
  const ackRef = useAck(row.id, comments);

  const [open, setOpen] = useState<ReadonlyMap<number, boolean>>(new Map());
  const [spines, setSpines] = useState(NONE);
  const [branches, setBranches] = useState(NONE);
  const [needMe, setNeedMe] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [cur, setCur] = useState<number | null>(null);
  const [secs, setSecs] = useState<ReadonlySet<string>>(new Set());
  const [targets, setTargets] = useState<ReadonlyMap<number, ReplyTarget>>(new Map());
  // n gives each text a new node, so a screen reader reads the same text again.
  const [said, setSaid] = useState({ text: "", n: 0 });

  // Focus moves after the render that shows its target.
  const focus = useRef<Focus | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const focusAfter = useCallback((f: Focus) => {
    focus.current = f;
    rerender();
  }, []);
  useLayoutEffect(() => {
    const f = focus.current;
    focus.current = null;
    const el = f && document.getElementById(f.id);
    if (!f || !el) return;
    el.scrollIntoView({ block: f.block });
    el.focus({ preventScroll: true });
    if (f.flash) flash(el);
  });

  // focus false: Back and Forward open the thread and leave the scroll position to the saved one.
  const jump = useCallback(
    (tid: number, msg?: number, focus = true) => {
      const t = latest.current.find((x) => x.id === tid);
      if (!t) return;
      const m = msg === undefined ? undefined : t.msgs.find((x) => x.id === msg)?.id;
      setNeedMe((on) => on && passes(t, true));
      if (t.turn === "resolved") setShowResolved(true);
      if (m !== undefined) {
        const r = reveal(t, m);
        if (r.spine) setSpines((s) => new Set(s).add(tid));
        if (r.branches.length) setBranches((b) => new Set([...b, ...r.branches]));
      }
      setOpen((o) => new Map(o).set(tid, true));
      setCur(tid);
      if (focus) focusAfter({ id: m === undefined ? `t-${tid}` : `c-${m}`, block: "start", flash: m !== undefined });
    },
    [focusAfter],
  );

  const outbox = useOutbox(row.id, comments, forge);
  // My avatar comes from my own messages. Without one, the slug stands in.
  const mine = useMemo<Person>(
    () => threads.flatMap((t) => t.msgs).find((m) => m.who.me)?.who ?? { slug: me ?? "", name: me ?? "You", me: true },
    [threads, me],
  );
  const onReply = useCallback(
    (tid: number, msg: number | null) =>
      setTargets((m) => {
        const out = new Map(m);
        if (msg === null) out.delete(tid);
        else out.set(tid, { msg, n: (m.get(tid)?.n ?? 0) + 1 });
        return out;
      }),
    [],
  );
  const announce = useCallback((text: string) => setSaid((s) => ({ text, n: s.n + 1 })), []);
  // The review hook comes after the thread context, so the context reads its action through this ref.
  const draftReply = useRef((_: number) => {});
  // The diff view needs the drafts of the review hook. The thread context and the drafts read its action through this ref.
  const showDiff = useRef((_: Card) => {});

  const web = webLink(pr.webUrl);
  const ctx = useMemo<ThreadCtx>(
    () => ({
      pr: row.id,
      hints,
      now,
      forge,
      web,
      runner,
      me: mine,
      ackRef,
      onToggle: (tid) => {
        const t = latest.current.find((x) => x.id === tid);
        if (t) setOpen((o) => new Map(o).set(tid, !(o.get(tid) ?? t.open)));
        setCur(tid);
      },
      onFold: (tid, fold) => {
        if (fold.kind === "spine") setSpines((s) => toggled(s, tid));
        else setBranches((b) => toggled(b, fold.at));
        setCur(tid);
        // An opened fold row moves above its first message, so the button mounts again.
        focusAfter({ id: `fold-${fold.at}`, block: "nearest", flash: false });
      },
      onQuote: jump,
      announce,
      onReply,
      onDraftReply: (tid) => draftReply.current(tid),
      onShowInDiff: (tid) => showDiff.current({ kind: "thread", id: tid }),
      posts: outbox.ctx,
    }),
    [row.id, hints, now, forge, web, runner, mine, ackRef, focusAfter, jump, announce, onReply, outbox.ctx],
  );

  const review = useReview(pr, {
    commits: data?.commits,
    threads,
    hints,
    now,
    focusAfter,
    reveal: jump,
    announce,
    onSettings,
    onProfile,
    showInDiff: (id) => showDiff.current({ kind: "draft", id }),
  });
  draftReply.current = review.api.draftReply;
  const openFiles = useCallback(() => setSecs((s) => (s.has("files") ? s : new Set(s).add("files"))), []);
  const diff = useDiffView(row.id, { ...review.diff, threads, forge, openFold: openFiles, focusAfter });
  // The same query as Files, so the summary line and the head of Files show the same count.
  const files = fileCount(useDiffIndex(row.id, secs.has("files")).data, data?.files);
  showDiff.current = diff.show;
  const { openDraft } = review.api;
  const diffCtx = useMemo<DiffCtx | null>(
    () =>
      meta
        ? {
            pr: row.id,
            meta,
            hints,
            threads,
            ...review.diff,
            onThread: jump,
            onDraft: openDraft,
            focusAfter,
            announce,
          }
        : null,
    [row.id, meta, hints, threads, review.diff, jump, openDraft, focusAfter, announce],
  );
  const bar = usePostBar(pr, {
    comments,
    forge,
    announce: ctx.announce,
    onPosted: (rows) => rows[0] && focusAfter({ id: `p-${rows[0].id}`, block: "nearest", flash: false }),
  });

  // ---------- URL state (plan pr-view-v4 section 5) ----------
  const routeRef = useRef(onRoute);
  routeRef.current = onRoute;
  const body = useRef<HTMLDivElement>(null);
  const stopRestore = useRef(() => {});
  useEffect(() => () => stopRestore.current(), []);
  // The request waits for the data. This effect comes before the one that applies it.
  const want = useRef<DetailAt | null>(null);
  useLayoutEffect(() => {
    want.current = at;
  }, [at]);
  useLayoutEffect(() => {
    const a = want.current;
    if (!a || !data) return;
    want.current = null;
    if (bar.api.isOpen) bar.api.close();
    const l = review.api.layer(null);
    if (l) review.api.close(l);
    // Without a saved scroll position, as in a new tab, the file or else the thread gets the focus.
    const fresh = a.scroll === null;
    if (a.thread !== null) jump(a.thread, undefined, fresh && !a.file);
    if (a.close !== null) diff.closeFile(a.close);
    if (a.file) diff.goFile(a.file, fresh);
    const box = body.current?.closest<HTMLElement>("[data-scroll]");
    if (!fresh && box) {
      stopRestore.current();
      stopRestore.current = restoreScroll(box, a.scroll ?? 0);
    }
  });
  // Thread focus replaces the URL. The first value is the one of the route, so it is not sent.
  const sentCur = useRef(cur);
  useEffect(() => {
    if (cur === sentCur.current) return;
    sentCur.current = cur;
    routeRef.current({ thread: cur });
  }, [cur]);
  // A file that opens goes to the URL, and the shell pushes an entry. The close of that file clears it.
  const sentOpen = useRef(diff.open);
  useEffect(() => {
    const was = sentOpen.current;
    if (was === diff.open) return;
    sentOpen.current = diff.open;
    const added = [...diff.open].find((n) => !was.has(n));
    if (added !== undefined) {
      if (added !== file) routeRef.current({ file: { path: added, line: null, side: "new" } });
    } else if (file !== null && was.has(file) && !diff.open.has(file)) routeRef.current({ file: null });
  }, [diff.open, file]);

  const isOpen = (t: { id: number; open: boolean }) => open.get(t.id) ?? t.open;
  // The cause waits for the data. Cached data from an earlier visit can miss it, so the first fetch after mount must end too.
  const wantCause = useRef(false);
  const settled = q.isFetchedAfterMount || !q.isFetching;
  useLayoutEffect(() => {
    if (!wantCause.current || !data || !settled) return;
    wantCause.current = false;
    const c = data.pr.cause;
    if (c) jump(c.thread, c.msg);
  });

  // n and N wrap around. They start after the focused message.
  const nextNew = (d: 1 | -1) => {
    const list = newMessages(ordered(threads, needMe));
    if (!list.length) {
      toast.add({ title: "No new message is left in this view." });
      return;
    }
    const at = document.activeElement?.closest("[data-id]")?.getAttribute("data-id");
    const i = list.findIndex(([, id]) => String(id) === at);
    const hit = list[i < 0 ? (d > 0 ? 0 : list.length - 1) : (i + d + list.length) % list.length];
    if (hit) jump(hit[0], hit[1]);
  };
  // The q key and the Ask button.
  const openAsk = () => {
    if (!data) {
      toast.add({ title: "The pull request is still loading." });
      return;
    }
    setSecs((s) => new Set(s).add("ask"));
    focusAfter({ id: "ask-q", block: "center", flash: false });
  };
  const nextYour = () => {
    const ids = ordered(threads, needMe)
      .filter((t) => t.turn === "your")
      .map((t) => t.id);
    const id = ids[(cur === null ? 0 : ids.indexOf(cur) + 1) % ids.length];
    if (id === undefined) toast.add({ title: "No thread waits on you." });
    else jump(id);
  };
  // The threads part of the strip: the first open thread in screen order. With none open, the first resolved one.
  const goThreads = () => {
    const t = ordered(threads, false).find((x) => x.turn !== "resolved") ?? threads.find((x) => x.turn === "resolved");
    if (t) jump(t.id);
  };

  useImperativeHandle(ref, () => ({
    cause() {
      wantCause.current = true;
      rerender();
    },
    // Plan pr-view-v4 section 6: j and k also move over the rows of an open Files section, after the threads.
    step(d) {
      const ids = shownThreads(threads, needMe, showResolved).map((t) => t.id);
      const rows = [...document.querySelectorAll<HTMLElement>(FILE_ROWS)];
      const f = rows.indexOf(document.activeElement as HTMLElement);
      const toRow = (el: HTMLElement | undefined) => {
        el?.focus({ preventScroll: true });
        el?.scrollIntoView({ block: "nearest" });
      };
      if (f >= 0 && (d > 0 || f > 0 || !ids.length)) return toRow(rows[Math.max(0, Math.min(rows.length - 1, f + d))]);
      const i = f >= 0 ? ids.length : cur === null ? -1 : ids.indexOf(cur);
      if (d > 0 && rows.length && (i === ids.length - 1 || !ids.length)) return toRow(rows[0]);
      const id = ids[i < 0 ? (d > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, i + d))];
      if (id === undefined) return;
      setCur(id);
      focusAfter({ id: `t-${id}`, block: "nearest", flash: false });
    },
    toggle() {
      // o on a file row opens or closes its diff, like Enter.
      const row = document.activeElement;
      if (row instanceof HTMLElement && row.matches(FILE_ROWS)) return row.click();
      const at = document.activeElement?.closest("[data-thread]")?.getAttribute("data-thread");
      const id = cur ?? (at ? Number(at) : null);
      if (id === null) return;
      ctx.onToggle(id);
      focusAfter({ id: `th-${id}`, block: "nearest", flash: false });
    },
    nextNew,
    nextYour,
    post: bar.api.open,
    section(id) {
      // Plan r2 UI-DIFF: Files shows for every loaded PR. Without the code it offers the fetch.
      if (id === "files" ? !data : !data?.commits?.length) {
        toast.add({ title: id === "files" ? "The pull request is still loading." : "No commit list for this pull request yet." });
        return;
      }
      // Plan pr-view-v4 section 6: g f focuses the first file row. Without a file list, the focus goes to Get the code.
      if (id === "files") return diff.firstRow();
      setSecs((s) => new Set(s).add(id));
      focusAfter({ id: `s-${id}-sum`, block: "start", flash: false });
    },
    showInDiff() {
      const at = document.activeElement;
      const d = at?.closest("[data-draft]")?.getAttribute("data-draft");
      const t = at?.closest("[data-thread]")?.getAttribute("data-thread") ?? (cur === null ? null : String(cur));
      if (d) diff.show({ kind: "draft", id: Number(d) });
      else if (t) diff.show({ kind: "thread", id: Number(t) });
      else toast.add({ title: "Move to an inline thread or a draft first. Then g d shows its line in the diff." });
    },
    ask: openAsk,
    ...review.api,
    // prototype/v3 Esc order: an edit, the brief, the post confirm, the run log.
    layer(target) {
      const l = review.api.layer(target);
      return l === "brief" ? l : bar.api.isOpen ? "confirm" : l;
    },
    close(layer) {
      if (layer === "confirm") bar.api.close();
      else review.api.close(layer);
    },
  }));

  const openSec = (id: string) => (on: boolean) => setSecs((s) => (on === s.has(id) ? s : toggled(s, id)));
  const fresh = comments.filter((c) => next.has(c.id) && !c.deleted).length;
  const notFound = q.error instanceof ApiError && q.error.status === 404;
  const sum = summary(threads);
  return (
    <>
      <Header
        pr={pr}
        strip={
          data && diffCtx ? (
            <Strip
              your={sum.your}
              fresh={fresh}
              since={since}
              now={now}
              threads={threads.length}
              open={sum.unresolved}
              drafts={review.draftCount}
              files={files}
              onYour={nextYour}
              onNew={() => nextNew(1)}
              onThreads={goThreads}
              onDrafts={review.api.drafts}
              onFiles={diff.firstRow}
            />
          ) : null
        }
        onLeave={onLeave}
        onAsk={openAsk}
        onTaskIds={onTaskIds}
        announce={announce}
        action={review.action}
        brief={review.brief}
      />
      <div ref={body} data-mounting={!steady || undefined} className="px-6 pb-16 max-[759px]:px-4">
        {archived(pr) && <ArchiveNotice pr={pr} now={now} onRestore={() => onRestore(pr)} />}
        {data ? (
          <>
            {review.reviewed && review.run}
            <Description detail={data} me={me} />
            {!review.reviewed && review.run}
            <Threads
              threads={threads}
              needMe={needMe}
              showResolved={showResolved}
              isOpen={isOpen}
              cur={cur}
              spines={spines}
              branches={branches}
              ctx={ctx}
              posts={outbox.threads}
              targets={targets}
              cards={review.cards}
              outbox={<PostsGroup posts={outbox.rest} comments={comments} forge={forge} web={web} hints={hints} ctx={outbox.ctx} />}
              drafts={review.drafts}
              onNeedMe={setNeedMe}
              onShowResolved={() => {
                setShowResolved(true);
                const first = threads.find((t) => t.turn === "resolved");
                if (first) focusAfter({ id: `t-${first.id}`, block: "nearest", flash: false });
              }}
            />
            {diffCtx && (
              <DiffSection
                files={data.files}
                open={secs.has("files")}
                onOpen={openSec("files")}
                web={web}
                forge={forge}
                branches={pr.sourceBranch && pr.targetBranch ? [pr.sourceBranch, pr.targetBranch] : null}
                view={diff}
                ctx={diffCtx}
              />
            )}
            {data.commits?.length ? (
              <CommitsFold
                commits={data.commits}
                detail={data}
                me={me}
                open={secs.has("commits")}
                onOpen={openSec("commits")}
                now={now}
                hints={hints}
              />
            ) : null}
            {meta && (
              <AskPanel
                pr={pr}
                meta={meta}
                now={now}
                open={secs.has("ask")}
                onOpen={openSec("ask")}
                onLog={review.api.openRunLog}
                announce={announce}
              />
            )}
          </>
        ) : q.error ? (
          <Calm title={notFound ? "Cannot find this pull request" : "Cannot load this pull request"}>
            <p className="m-0">{notFound ? "Review Loop has no data for it. Select another pull request." : q.error.message}</p>
          </Calm>
        ) : (
          <div role="status" aria-busy="true" aria-label="Loading the pull request" className="grid max-w-[86ch] gap-3 pt-6">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
      </div>
      {/* The fix bar sits above the post bar. Both stay at the bottom of the pane. */}
      {data && (review.fix.bar || bar.node) && (
        <div className="sticky bottom-0 z-[2]">
          {review.fix.bar}
          {bar.node}
        </div>
      )}
      {review.fix.dialog}
      <SharedHint hints={hints} />
      <p role="status" className="sr-only">
        <span key={said.n}>{said.text}</span>
      </p>
      {review.sheet}
    </>
  );
}
