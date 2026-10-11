// Diff viewer (plan r2 UI-DIFF): the Files section with the git file list, a paged view of each file, and the threads and drafts on
// their lines. Cards take no ackRef, so the diff marks nothing read. Only a click on "Get the code" fetches from the forge.
import { useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  FileDiff as FileChanged,
  FileMinus,
  FilePlus,
  FileSymlink,
  LoaderCircle,
  type LucideIcon,
  MessageSquare,
} from "lucide-react";
import { type CSSProperties, Fragment, memo, type ReactNode, useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  type ChangedFile,
  DIFF_PAGE_ROWS,
  type DiffFileDto,
  type DiffIndexDto,
  type DiffRowDto,
  type MetaDto,
  type ReviewItemDto,
} from "../../shared/dto";
import type { AnchoredFinding } from "../../shared/review";
import { FilesFold, ForgeFiles } from "../pr/Sections";
import { Avatar, NewMark } from "../pr/Thread";
import { firstName, snippet, type ThreadModel } from "../pr/threads";
import { AiAvatar, Severity } from "../review/Drafts";
import { plural } from "../review/model";
import type { Focus } from "../review/useReview";
import { type Hints, HintTrigger } from "../shell/Hint";
import { cachedIndex, type DiffIndex, loadUntil, useDiffIndex, useDiffPages, useGetCode } from "./data";
import {
  type Card,
  cardKey,
  draftItem,
  fileName,
  fileOf,
  hidden,
  type Item,
  lineIndex,
  offId,
  type Placement,
  place,
  rowId,
  targetOf,
  threadItem,
} from "./model";

const icon = "size-[15px] shrink-0";
const linkish = "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded text-sm font-medium text-pen hover:underline";

function Err({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-start gap-1.5 text-destructive">
      <CircleAlert aria-hidden className={cn(icon, "mt-0.5")} />
      <span>{children}</span>
    </span>
  );
}

export type DiffCtx = {
  pr: number;
  meta: MetaDto;
  hints: Hints;
  threads: ThreadModel[];
  // The finding drafts of the newest review run, and its source head.
  drafts: ReviewItemDto[];
  head: string | null;
  // The reply draft of each thread, keyed by thread ID.
  replies: ReadonlyMap<number, ReviewItemDto>;
  onThread: (id: number) => void;
  onDraft: (id: number) => void;
  // The first thread in screen order of these IDs.
  onThreads: (ids: ReadonlySet<number>) => void;
  focusAfter: (f: Focus) => void;
  announce: (text: string) => void;
};

// ---------- State and "Show in diff" ----------

// Keys of open and pages: the file name in the index (fileName).
export type DiffView = {
  open: ReadonlySet<string>;
  pages: ReadonlyMap<string, number>;
  toggle: (name: string) => void;
  more: (name: string) => void;
  // Opens Files and the file, loads the pages up to the line, then focuses its row.
  show: (card: Card) => void;
};

export function useDiffView(
  pr: number,
  o: {
    threads: ThreadModel[];
    drafts: ReviewItemDto[];
    head: string | null;
    forge: string;
    openFold: () => void;
    focusAfter: (f: Focus) => void;
  },
): DiffView {
  const qc = useQueryClient();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [pages, setPages] = useState<ReadonlyMap<string, number>>(new Map());
  const toggle = useCallback(
    (name: string) =>
      setOpen((s) => {
        const out = new Set(s);
        if (!out.delete(name)) out.add(name);
        return out;
      }),
    [],
  );
  const more = useCallback((name: string) => setPages((m) => new Map(m).set(name, (m.get(name) ?? 1) + 1)), []);

  const show = async (card: Card) => {
    const t = card.kind === "thread" ? o.threads.find((x) => x.id === card.id) : undefined;
    const d = card.kind === "draft" ? o.drafts.find((x) => x.id === card.id) : undefined;
    if (!(t ? threadItem(t) : d && draftItem(d, null, ""))) {
      toast.add({
        title: card.kind === "thread" ? "A general comment has no line in the diff." : "A discarded draft does not show in the diff.",
      });
      return;
    }
    o.openFold();
    let index: DiffIndex;
    try {
      index = await cachedIndex(qc, pr);
    } catch (e) {
      toast.add({ title: "Cannot show the diff", description: (e as Error).message });
      return;
    }
    if ("fetch" in index) {
      toast.add({ title: `Get the code from ${o.forge} first. Then the diff shows.` });
      o.focusAfter({ id: "diff-get", block: "center", flash: true });
      return;
    }
    const item = (t ? threadItem(t) : d && draftItem(d, o.head, index.sourceHead)) as Item;
    const i = fileOf(index.files, item.spot.path);
    const f = index.files[i];
    if (!f) {
      toast.add({ title: `${item.spot.path} is not in the diff.` });
      return;
    }
    const name = fileName(f);
    const { line, side } = item.spot;
    let got: Awaited<ReturnType<typeof loadUntil>>;
    try {
      got = await loadUntil(qc, pr, name, f.rows, (rows) => !!item.stale || line === null || lineIndex(rows)[side].has(line));
    } catch (e) {
      toast.add({ title: "Cannot show the diff", description: (e as Error).message });
      return;
    }
    const id = targetOf(i, got.rows, place(got.rows, got.complete, [item]), card);
    setOpen((s) => (s.has(name) ? s : new Set(s).add(name)));
    setPages((m) => ((m.get(name) ?? 1) >= got.pages ? m : new Map(m).set(name, got.pages)));
    o.focusAfter({ id: id ?? `df-${i}`, block: "center", flash: true });
  };

  return { open, pages, toggle, more, show: (card) => void show(card) };
}

// ---------- Files section ----------

// files: the forge file list. It shows until the git index loads.
export function DiffSection(props: {
  files: ChangedFile[] | undefined;
  open: boolean;
  onOpen: (open: boolean) => void;
  web: string | null;
  forge: string;
  view: DiffView;
  ctx: DiffCtx;
}) {
  const { ctx, forge } = props;
  const q = useDiffIndex(ctx.pr, props.open);
  const index = q.data && !("fetch" in q.data) ? q.data : null;
  const n = index ? index.files.length : props.files?.length || null;
  let state: ReactNode = null;
  if (q.error)
    state = (
      <p className="m-0 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <Err>Cannot show the diff. {q.error.message}</Err>
        <button type="button" className={linkish} onClick={() => void q.refetch()}>
          Try again
        </button>
      </p>
    );
  else if (q.data && "fetch" in q.data) state = <GetCode ctx={ctx} forge={forge} />;
  else if (q.isFetching) state = <Skeleton className="mt-2 h-7 w-56" />;
  return (
    <FilesFold n={n} open={props.open} onOpen={props.onOpen} web={props.web} forge={forge}>
      {index ? (
        <DiffFiles index={index} view={props.view} ctx={ctx} />
      ) : (
        <>
          {props.files?.length ? (
            <ForgeFiles
              files={props.files}
              threads={ctx.threads}
              hints={ctx.hints}
              onFile={(path) => ctx.onThreads(new Set(ctx.threads.filter((t) => t.anchor?.path === path).map((t) => t.id)))}
            />
          ) : null}
          {state}
        </>
      )}
    </FilesFold>
  );
}

function GetCode({ ctx, forge }: { ctx: DiffCtx; forge: string }) {
  const get = useGetCode(ctx.pr, (index) => {
    ctx.announce(`Got the code. ${plural(index.files.length, "changed file")}.`);
    if (index.files.length) ctx.focusAfter({ id: "df-0", block: "nearest", flash: false });
  });
  return (
    <div className="mt-2.5 mb-1 grid gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button id="diff-get" size="sm" variant="outline" disabled={get.isPending} onClick={() => get.mutate()}>
          {get.isPending ? (
            <LoaderCircle aria-hidden data-icon="inline-start" className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Download aria-hidden data-icon="inline-start" />
          )}
          Get the code from {forge}
        </Button>
        <span role="status" className="text-xs text-muted-foreground">
          {get.isPending
            ? "Fetching the two branches…"
            : "The diff needs the code of both branches. Review Loop keeps it in a local cache."}
        </span>
      </div>
      {get.error && (
        <p className="m-0 text-sm">
          <Err>{get.error.message}</Err>
        </p>
      )}
    </div>
  );
}

function changeOf(f: DiffFileDto): [LucideIcon, string] {
  if (f.oldPath === null) return [FilePlus, "Added"];
  if (f.path === null) return [FileMinus, "Deleted"];
  if (f.path !== f.oldPath) return [FileSymlink, `Moved from ${f.oldPath}`];
  return [FileChanged, "Modified"];
}

function DiffFiles({ index, view, ctx }: { index: DiffIndexDto; view: DiffView; ctx: DiffCtx }) {
  const { threads, drafts, head } = ctx;
  // The items of each file, by file index. A thread or draft on a path outside the diff shows in no file.
  const items = useMemo(() => {
    const out = new Map<number, Item[]>();
    const add = (it: Item | null) => {
      const i = it ? fileOf(index.files, it.spot.path) : -1;
      if (!it || i < 0) return;
      const list = out.get(i);
      if (list) list.push(it);
      else out.set(i, [it]);
    };
    for (const t of threads) add(threadItem(t));
    for (const d of drafts) add(draftItem(d, head, index.sourceHead));
    return out;
  }, [index, threads, drafts, head]);
  if (!index.files.length) return <p className="m-0 mt-1 mb-2.5 text-muted-foreground">No file changed between the two branches.</p>;
  return (
    <ul className="m-0 mb-2.5 list-none p-0">
      {index.files.map((f, i) => {
        const name = fileName(f);
        return (
          <FileRow
            key={name}
            i={i}
            f={f}
            open={view.open.has(name)}
            pages={view.pages.get(name) ?? 1}
            items={items.get(i) ?? NO_ITEMS}
            toggle={view.toggle}
            more={view.more}
            ctx={ctx}
          />
        );
      })}
    </ul>
  );
}

const NO_ITEMS: Item[] = [];

const FileRow = memo(function FileRow(props: {
  i: number;
  f: DiffFileDto;
  open: boolean;
  pages: number;
  items: Item[];
  toggle: (name: string) => void;
  more: (name: string) => void;
  ctx: DiffCtx;
}) {
  const { i, f, open, items, ctx } = props;
  const name = fileName(f);
  const [Icon, word] = changeOf(f);
  const cut = name.lastIndexOf("/") + 1;
  const ids = new Set(items.flatMap((x) => (x.card.kind === "thread" ? [x.card.id] : [])));
  const go = `Go to ${ids.size === 1 ? "the thread" : `the first of ${ids.size} threads`} on this file`;
  return (
    <li className="border-b">
      <div className="flex items-center gap-0.5">
        <button
          id={`df-${i}`}
          type="button"
          aria-expanded={open}
          aria-controls={`dfb-${i}`}
          onClick={() => props.toggle(name)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded px-1.5 py-1.5 text-left text-sm hover:bg-hover"
        >
          <ChevronRight aria-hidden className={cn("rl-chev text-muted-foreground", icon)} />
          <HintTrigger hints={ctx.hints} label={word}>
            <span className="inline-flex text-muted-foreground">
              <Icon aria-hidden className={icon} />
            </span>
          </HintTrigger>
          <span translate="no" className="min-w-0 font-mono [overflow-wrap:anywhere]">
            <span className="text-muted-foreground">{name.slice(0, cut)}</span>
            {name.slice(cut)}
          </span>
          <span className="sr-only">. {word}.</span>
          <span className="ml-auto shrink-0 pl-2 text-xs whitespace-nowrap text-muted-foreground">
            {f.binary ? "Binary" : `+${f.added} −${f.removed}`}
          </span>
        </button>
        <span className="flex w-[44px] flex-none justify-end">
          {ids.size > 0 && (
            <HintTrigger hints={ctx.hints} label={go}>
              <button
                type="button"
                aria-label={go}
                onClick={() => ctx.onThreads(ids)}
                className="inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-sm font-medium text-ink-2 hover:underline"
              >
                <MessageSquare aria-hidden className={icon} />
                {ids.size}
              </button>
            </HintTrigger>
          )}
        </span>
      </div>
      <div id={`dfb-${i}`} hidden={!open}>
        {open && <FileBody i={i} f={f} pages={props.pages} items={items} more={props.more} ctx={ctx} />}
      </div>
    </li>
  );
});

// ---------- One file ----------

const SIGN = { add: "+", del: "−", ctx: " " } as const;
const SR = { add: "Added: ", del: "Removed: ", ctx: "" } as const;

// id: a focus target for "Show in diff".
const Line = memo(function Line({ id, kind, old, nu, text, marked }: Row & { id?: string; marked: boolean }) {
  return (
    <div id={id} tabIndex={id ? -1 : undefined} className="rl-dr" data-k={kind} data-mark={marked || undefined}>
      <span className="rl-no">{kind === "add" ? "" : old}</span>
      <span className="rl-no">{kind === "del" ? "" : nu}</span>
      <span aria-hidden className="rl-sg">
        {SIGN[kind]}
      </span>
      <span>
        {kind !== "ctx" && <span className="sr-only">{SR[kind]}</span>}
        {text}
        {marked && <span className="sr-only"> (commented line)</span>}
      </span>
    </div>
  );
});
type Row = { kind: "add" | "del" | "ctx"; old: number; nu: number; text: string };

// Diff rows with a gap row for each run of unchanged lines. idOf: the DOM ID of a row. after: the content under the row at index k.
export function Rows(props: {
  rows: DiffRowDto[];
  label: string;
  idOf?: (r: DiffRowDto) => string;
  marked?: ReadonlySet<number>;
  after?: (k: number) => ReactNode;
}) {
  const { rows } = props;
  const last = rows.at(-1);
  // Wide enough for the largest line number of either side.
  const nw = `${String(Math.max(99, last?.old ?? 0, last?.new ?? 0)).length + 1}ch`;
  return (
    <div translate="no" className="rl-dv" style={{ "--nw": nw } as CSSProperties}>
      <figure aria-label={props.label} className="rl-dvi m-0">
        {rows.map((r, k) => {
          const gap = hidden(rows[k - 1], r);
          const id = props.idOf?.(r);
          return (
            <Fragment key={id ?? `${r.kind}${r.old}:${r.new}`}>
              {gap > 0 && <div className="rl-dgap">{plural(gap, "unchanged line")}</div>}
              <Line id={id} kind={r.kind} old={r.old} nu={r.new} text={r.text} marked={!!props.marked?.has(k)} />
              {props.after?.(k)}
            </Fragment>
          );
        })}
      </figure>
    </div>
  );
}

function FileBody(props: { i: number; f: DiffFileDto; pages: number; items: Item[]; more: (name: string) => void; ctx: DiffCtx }) {
  const { i, f, items, ctx } = props;
  const name = fileName(f);
  const p = useDiffPages(ctx.pr, name, props.pages);
  const placement = useMemo(() => place(p.rows, p.complete, items), [p.rows, p.complete, items]);
  const left = f.rows - p.rows.length;
  return (
    <div className="rl-df">
      {placement.off.length > 0 && <OffList i={i} p={placement} ctx={ctx} />}
      {f.binary ? (
        <p className="m-0 px-2.5 py-2 text-sm text-muted-foreground">Binary file. The diff has no lines to show.</p>
      ) : (
        <Rows
          rows={p.rows}
          label={`Changes in ${name}`}
          idOf={(r) => rowId(i, r)}
          marked={placement.marked}
          after={(k) => {
            const cards = placement.at.get(k);
            return (
              cards && (
                <div className="rl-dcard">
                  {cards.map((c) => (
                    <CardView key={cardKey(c)} c={c} ctx={ctx} />
                  ))}
                </div>
              )
            );
          }}
        />
      )}
      {p.loading && (
        <div className="grid gap-1.5 px-2.5 py-2" role="status" aria-label="Loading the lines">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
      {p.error && (
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-2 text-sm">
          <Err>Cannot load the lines. {p.error.message}</Err>
          {p.retry && (
            <button type="button" className={linkish} onClick={p.retry}>
              Try again
            </button>
          )}
        </p>
      )}
      {!p.complete && !p.loading && !p.error && p.rows.length > 0 && left > 0 && (
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-2 text-sm">
          <button type="button" className={linkish} onClick={() => props.more(name)}>
            Show {Math.min(DIFF_PAGE_ROWS, left).toLocaleString()} more lines
          </button>
          <span className="text-xs text-muted-foreground">
            {p.rows.length.toLocaleString()} of {f.rows.toLocaleString()} lines shown
          </span>
        </p>
      )}
    </div>
  );
}

function OffList({ i, p, ctx }: { i: number; p: Placement; ctx: DiffCtx }) {
  return (
    <div className="rl-doff">
      <p className="m-0 mb-1.5 text-xs font-semibold text-muted-foreground">Not on the lines shown</p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {p.off.map((c) => (
          <li key={cardKey(c)} id={offId(i, c)} tabIndex={-1} className="rounded-md">
            <CardView c={c} ctx={ctx} />
            <p className="m-0 mt-0.5 pl-2 text-xs text-muted-foreground">{c.why}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// A compact card. It renders the newest message as a snippet only, so it acknowledges nothing.
function CardView({ c, ctx }: { c: Card; ctx: DiffCtx }) {
  const text = `dc-${cardKey(c)}`;
  if (c.kind === "thread") {
    const t = ctx.threads.find((x) => x.id === c.id);
    if (!t) return null;
    const last = t.last;
    const reply = ctx.replies.get(t.id);
    const drafted = !!reply?.body.trim() && reply.status !== "discarded";
    return (
      <div className="rl-dc">
        {last ? <Avatar p={last.who} /> : <MessageSquare aria-hidden className={cn(icon, "text-muted-foreground")} />}
        <span id={text} className="min-w-0 flex-1 truncate text-ink-2">
          <b className="font-semibold text-foreground">{last ? (last.who.me ? "You" : firstName(last.who)) : "Thread"}</b>:{" "}
          {last ? snippet(last.text, 160) : `Deleted on ${ctx.meta.forge.name}`}
        </span>
        {t.turn === "resolved" && <span className="shrink-0 text-muted-foreground">Resolved</span>}
        {drafted && (
          <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
            <Bot aria-hidden className={icon} />
            Reply draft
          </span>
        )}
        {t.fresh > 0 && <NewMark text={`${t.fresh} new`} />}
        <button type="button" className={linkish} aria-describedby={text} onClick={() => ctx.onThread(t.id)}>
          Go to thread
        </button>
      </div>
    );
  }
  const it = ctx.drafts.find((x) => x.id === c.id);
  if (!it) return null;
  const f = it.payload as AnchoredFinding;
  return (
    <div className="rl-dc">
      <AiAvatar meta={ctx.meta} />
      <Severity s={f.severity} />
      <span id={text} className="min-w-0 flex-1 truncate text-ink-2">
        <span className="sr-only">Draft from {ctx.meta.runner.short}: </span>
        {snippet(it.body, 160)}
      </span>
      {it.status === "accepted" && (
        <span className="inline-flex shrink-0 items-center gap-1 font-medium text-ink-2">
          <Check aria-hidden className={icon} />
          Accepted
        </span>
      )}
      <button type="button" className={linkish} aria-describedby={text} onClick={() => ctx.onDraft(it.id)}>
        Go to draft
      </button>
    </div>
  );
}
