// PR detail (plan v3 WP5): header, then one column of Overview, Threads, Files, and Commits (prototype/v3 renderDetail).
import { useMutation } from "@tanstack/react-query";
import { type Ref, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import type { CommentDto, PrRow } from "../../shared/dto";
import type { Layer } from "../keys";
import { useMeta } from "../meta";
import { PostsGroup, useOutbox } from "../publish/Outbox";
import { usePostBar } from "../publish/PostBar";
import { type Focus, useReview } from "../review/useReview";
import { ApiError, sendSeen, usePr } from "../shell/data";
import { createHints, SharedHint } from "../shell/Hint";
import { useMinute } from "../shell/ListPane";
import { Calm } from "../states";
import { Header, webLink } from "./Header";
import type { ReplyTarget } from "./ReplyComposer";
import { CommitsFold, FilesFold, Overview } from "./Sections";
import type { ThreadCtx } from "./Thread";
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
  // Plan v3 WP11: r, Shift+R, 2, 3, and the Esc layers of the review.
  rerun(): void;
  brief(): void;
  drafts(): void;
  log(): void;
  // Plan v3 WP14a: a, e, d, and p.
  triage(key: "accept" | "edit" | "discard"): void;
  post(): void;
  layer(target: EventTarget | null): Layer;
  close(layer: Exclude<Layer, null>): void;
};

const NO_COMMENTS: CommentDto[] = [];
const NONE: ReadonlySet<number> = new Set();

const toggled = <T,>(s: ReadonlySet<T>, v: T) => {
  const out = new Set(s);
  if (!out.delete(v)) out.add(v);
  return out;
};

// A jump target shows a short highlight. Reduced motion keeps only the focus ring.
function flash(el: HTMLElement) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const css = getComputedStyle(el);
  const from = css.getPropertyValue("--sel").trim();
  el.animate([{ backgroundColor: from }, { backgroundColor: "transparent" }], {
    duration: 900,
    easing: css.getPropertyValue("--ease-out").trim(),
  });
}

// onLeave: the shell moves the selection away before the PR leaves the list. onSettings: the brief links to the task ID rules.
export function PrDetail({
  pr: row,
  me,
  onLeave,
  onSettings,
  ref,
}: {
  pr: PrRow;
  me: string | null;
  onLeave: () => void;
  onSettings: () => void;
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

  const jump = useCallback(
    (tid: number, msg?: number) => {
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
      focusAfter({ id: m === undefined ? `t-${tid}` : `c-${m}`, block: "start", flash: m !== undefined });
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

  const ctx = useMemo<ThreadCtx>(
    () => ({
      pr: row.id,
      hints,
      now,
      forge,
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
      announce: (text) => setSaid((s) => ({ text, n: s.n + 1 })),
      onReply,
      posts: outbox.ctx,
    }),
    [row.id, hints, now, forge, runner, mine, ackRef, focusAfter, jump, onReply, outbox.ctx],
  );

  const review = useReview(pr, { commits: data?.commits, hints, now, focusAfter, onSettings });
  const bar = usePostBar(pr, {
    comments,
    forge,
    announce: ctx.announce,
    onPosted: (rows) => rows[0] && focusAfter({ id: `p-${rows[0].id}`, block: "nearest", flash: false }),
  });

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
  const nextYour = () => {
    const ids = ordered(threads, needMe)
      .filter((t) => t.turn === "your")
      .map((t) => t.id);
    const id = ids[(cur === null ? 0 : ids.indexOf(cur) + 1) % ids.length];
    if (id === undefined) toast.add({ title: "No thread waits on you." });
    else jump(id);
  };

  useImperativeHandle(ref, () => ({
    cause() {
      wantCause.current = true;
      rerender();
    },
    step(d) {
      const ids = shownThreads(threads, needMe, showResolved).map((t) => t.id);
      const i = cur === null ? -1 : ids.indexOf(cur);
      const id = ids[i < 0 ? (d > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, i + d))];
      if (id === undefined) return;
      setCur(id);
      focusAfter({ id: `t-${id}`, block: "nearest", flash: false });
    },
    toggle() {
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
      if (!(id === "files" ? data?.files : data?.commits)?.length) {
        toast.add({ title: id === "files" ? "No file list for this pull request yet." : "No commit list for this pull request yet." });
        return;
      }
      setSecs((s) => new Set(s).add(id));
      focusAfter({ id: `s-${id}-sum`, block: "start", flash: false });
    },
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
  return (
    <>
      <Header
        pr={pr}
        since={since}
        now={now}
        fresh={fresh}
        sum={summary(threads)}
        onNextNew={() => nextNew(1)}
        onNextYour={nextYour}
        onLeave={onLeave}
        action={review.action}
        brief={review.brief}
        run={review.run}
      />
      <div className="px-6 pb-16 max-[759px]:px-4">
        {data ? (
          <>
            <Overview detail={data} me={me} forge={forge} diffLink={!data.files?.length} summary={review.summary} />
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
              outbox={<PostsGroup posts={outbox.rest} comments={comments} forge={forge} ctx={outbox.ctx} />}
              drafts={review.drafts}
              onNeedMe={setNeedMe}
              onShowResolved={() => {
                setShowResolved(true);
                const first = threads.find((t) => t.turn === "resolved");
                if (first) focusAfter({ id: `t-${first.id}`, block: "nearest", flash: false });
              }}
            />
            {data.files?.length ? (
              <FilesFold
                files={data.files}
                threads={threads}
                open={secs.has("files")}
                onOpen={openSec("files")}
                onFile={(path) => {
                  const t = ordered(threads, false).find((x) => x.anchor?.path === path);
                  if (t) jump(t.id);
                }}
                web={webLink(pr.webUrl)}
                forge={forge}
                hints={hints}
              />
            ) : null}
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
          </>
        ) : q.error ? (
          <Calm title={notFound ? "This pull request left the inbox" : "Cannot load this pull request"}>
            <p className="m-0">{notFound ? "It was archived or is no longer on your dashboard." : q.error.message}</p>
          </Calm>
        ) : (
          <div role="status" aria-busy="true" aria-label="Loading the pull request" className="grid max-w-[86ch] gap-3 pt-6">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
      </div>
      {data && bar.node}
      <SharedHint hints={hints} />
      <p role="status" className="sr-only">
        <span key={said.n}>{said.text}</span>
      </p>
      {review.sheet}
    </>
  );
}
