// One thread of the detail pane (prototype/v3 thread, threadBody, tree, msg). A collapsed thread renders no message, so it acks nothing.
import { Check, ChevronRight, Copy, CornerDownRight, History, Hourglass, MessageSquare, Reply, Square, SquareCheckBig } from "lucide-react";
import { lazy, memo, type ReactNode, Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import type { ExcerptLine, PostDto } from "../../shared/dto";
import { type PostCtx, ReplyPosts } from "../publish/Outbox";
import type { Hints } from "../shell/Hint";
import { HintTrigger } from "../shell/Hint";
import { ago, initials } from "../shell/model";
import { ReplyComposer, type ReplyTarget } from "./ReplyComposer";
import {
  agoLong,
  type FoldRow,
  firstName,
  hueOf,
  type Li,
  layout,
  type Node,
  names,
  type Person,
  snippet,
  splitExcerpt,
  type ThreadModel,
  turnText,
} from "./threads";

// The Markdown renderer loads on first use, so the main chunk stays small. Plain text shows until then.
const Markdown = lazy(() => import("./Markdown").then((m) => ({ default: m.Markdown })));

export function Text({ text }: { text: string }) {
  return (
    <Suspense fallback={<p className="m-0 whitespace-pre-wrap">{text}</p>}>
      <Markdown text={text} />
    </Suspense>
  );
}

export type ThreadCtx = {
  pr: number;
  hints: Hints;
  now: number;
  forge: string;
  // The runner name, for "Posted from a <runner> review".
  runner: string;
  // I, for the avatar of my replies on the way.
  me: Person;
  ackRef: (el: HTMLElement | null) => (() => void) | undefined;
  onToggle: (thread: number) => void;
  onFold: (thread: number, row: FoldRow) => void;
  onQuote: (thread: number, msg: number) => void;
  announce: (text: string) => void;
  // msg null: the reply box of the thread answers the newest live message again.
  onReply: (thread: number, msg: number | null) => void;
  posts: PostCtx;
};

export const fullTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const icon = "size-[15px] shrink-0";

export function Avatar({ p }: { p: Person }) {
  return (
    <span aria-hidden className="rl-av" data-h={p.me ? undefined : hueOf(p.slug)} data-me={p.me || undefined}>
      {initials(p.name)}
    </span>
  );
}

// An icon without visible words: the words go to screen readers and to the shared tooltip.
function IconHint({ hints, label, children }: { hints: Hints; label: string; children: ReactNode }) {
  return (
    <HintTrigger hints={hints} label={label}>
      <span role="img" aria-label={label} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-muted-foreground">
        {children}
      </span>
    </HintTrigger>
  );
}

// New: one filled dot plus the word.
export function NewMark({ text }: { text: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold whitespace-nowrap text-foreground">
      <span aria-hidden className="size-[7px] rounded-full bg-foreground" />
      {text}
    </span>
  );
}

function TaskMark({ hints, task }: { hints: Hints; task: "open" | "done" }) {
  return task === "done" ? (
    <IconHint hints={hints} label="Task done">
      <SquareCheckBig aria-hidden className={icon} />
    </IconHint>
  ) : (
    <IconHint hints={hints} label="Open task">
      <Square aria-hidden className={icon} />
    </IconHint>
  );
}

const placeOf = (t: ThreadModel) =>
  t.anchor ? `${t.anchor.path}${t.anchor.line === undefined ? "" : `:${t.anchor.line}`}` : "General comment";

// A collapsed thread is one line that sums it up. An open thread shows the same facts in its messages, so the line drops them.
// posts: my replies on the way. target: the message that the reply box answers. draft: the AI reply draft card (WP18).
export const Thread = memo(function Thread({
  t,
  open,
  cur,
  spine,
  branches,
  posts,
  target,
  draft,
  ctx,
}: {
  t: ThreadModel;
  open: boolean;
  cur: boolean;
  spine: boolean;
  branches: ReadonlySet<number>;
  posts?: readonly PostDto[];
  target?: ReplyTarget;
  draft?: ReactNode;
  ctx: ThreadCtx;
}) {
  const a = t.anchor;
  const base = a ? a.path.slice(a.path.lastIndexOf("/") + 1) : null;
  const replies = t.msgs.length - 1;
  const last = t.last;
  return (
    <article
      id={`t-${t.id}`}
      data-thread={t.id}
      tabIndex={-1}
      aria-label={`${turnText(t)}. ${placeOf(t)}.${t.fresh ? ` ${t.fresh} new.` : ""}`}
      className="scroll-mt-3 border-b"
    >
      <div className="flex items-center gap-0.5">
        <button
          id={`th-${t.id}`}
          type="button"
          aria-expanded={open}
          aria-controls={`tb-${t.id}`}
          onClick={() => ctx.onToggle(t.id)}
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded px-1.5 py-2 text-left text-sm text-muted-foreground hover:bg-hover",
            cur && "bg-sel hover:bg-sel",
          )}
        >
          {a ? (
            <HintTrigger hints={ctx.hints} label={a.path}>
              <span translate="no" className="min-w-0 shrink truncate font-mono text-foreground">
                {base}
                {a.line !== undefined && <span className="text-muted-foreground">:{a.line}</span>}
              </span>
            </HintTrigger>
          ) : (
            <span className="shrink-0 text-foreground">General comment</span>
          )}
          {!open && (
            <>
              {a?.orphaned && (
                <IconHint hints={ctx.hints} label="Outdated. The code changed after this comment.">
                  <History aria-hidden className={icon} />
                </IconHint>
              )}
              {t.task && <TaskMark hints={ctx.hints} task={t.task} />}
              <span className="rl-wide-pane min-w-0 flex-1 truncate text-ink-2">
                {last ? `${last.who.me ? "You" : firstName(last.who)}: ${snippet(last.text, 160)}` : `Deleted on ${ctx.forge}`}
              </span>
              {replies > 0 && (
                <IconHint hints={ctx.hints} label={`${replies} ${replies === 1 ? "reply" : "replies"}`}>
                  <MessageSquare aria-hidden className={icon} />
                  {replies}
                </IconHint>
              )}
              {t.fresh > 0 && <NewMark text={`${t.fresh} new`} />}
            </>
          )}
          <HintTrigger hints={ctx.hints} label={fullTime(t.newest)}>
            <time dateTime={new Date(t.newest).toISOString()} className="ml-auto shrink-0 whitespace-nowrap">
              {ago(t.newest, ctx.now)}
            </time>
          </HintTrigger>
          <ChevronRight aria-hidden className={cn("rl-chev", icon)} />
        </button>
        {/* The link column keeps every chevron in one line. A comment link needs the Gate A suffix (plan v3 section 2). */}
        <span className="w-[30px] flex-none" />
      </div>
      <div id={`tb-${t.id}`} hidden={!open} className="px-1.5 pt-0.5 pb-4">
        {open && (
          <Body
            t={t}
            spine={spine}
            branches={branches}
            ctx={ctx}
            after={
              <>
                {posts && <ReplyPosts posts={posts} avatar={<Avatar p={ctx.me} />} forge={ctx.forge} ctx={ctx.posts} />}
                {draft}
                <ReplyComposer t={t} target={target} ctx={ctx} />
              </>
            }
          />
        )}
      </div>
    </article>
  );
});

const SIGN = { add: "+", del: "−", ctx: " " } as const;

function Lines({ lines }: { lines: ExcerptLine[] }) {
  return lines.map((l) => (
    <span key={`${l.kind}${l.n}`} className="rl-cl" data-k={l.kind} data-hit={l.hit || undefined}>
      <span className="rl-no">{l.n}</span>
      <span className="rl-sg">{SIGN[l.kind]}</span>
      <span>
        {l.text}
        {l.hit && <span className="sr-only"> (commented line)</span>}
      </span>
    </span>
  ));
}

// An inline thread splits its excerpt after the commented line. The discussion sits in the gap.
// after: my replies on the way, the draft card, and the reply box, under the tree.
function Body(props: { t: ThreadModel; spine: boolean; branches: ReadonlySet<number>; ctx: ThreadCtx; after: ReactNode }) {
  const { t, spine, branches, ctx } = props;
  const tree = (
    <>
      <ol className="rl-tree">
        {layout(t, { spine, branches }).map((li) => (
          <Item key={li.msg?.id ?? `f${li.fold?.at}`} li={li} t={t} ctx={ctx} />
        ))}
      </ol>
      {props.after}
    </>
  );
  const a = t.anchor;
  const lines = t.root.excerpt;
  if (!a || !lines?.length) {
    return (
      <>
        {a?.orphaned && <p className="m-0 mb-1 text-xs text-muted-foreground">The code changed after this comment.</p>}
        <div className="rl-disc">{tree}</div>
      </>
    );
  }
  const { head, tail } = splitExcerpt(lines);
  const at = a.line === undefined ? a.path : `${a.path} line ${a.line}`;
  return (
    <>
      <figure
        className={cn("rl-code m-0", tail.length > 0 && "rl-head")}
        aria-label={`Code at ${at}${a.orphaned ? ", as it was when the comment was written" : ""}`}
      >
        {a.orphaned && (
          <p className="m-0 px-2.5 pt-1.5 text-xs text-muted-foreground">
            Code as it was when the comment was written. The file changed after that.
          </p>
        )}
        <pre className="rl-pre">
          <Lines lines={head} />
        </pre>
      </figure>
      <div className="rl-disc rl-anchored">{tree}</div>
      {tail.length > 0 && (
        <figure className="rl-code rl-tail m-0" aria-label={`Code after line ${a.line ?? ""}`.trim()}>
          <pre className="rl-pre">
            <Lines lines={tail} />
          </pre>
        </figure>
      )}
    </>
  );
}

function Item({ li, t, ctx }: { li: Li; t: ThreadModel; ctx: ThreadCtx }) {
  const kids = li.kids.length > 0;
  return (
    <li className={cn(li.fold?.open && li.msg && "rl-opened", (kids || li.foot) && "rl-kids", li.foot && "rl-has-foot")}>
      {li.fold && <FoldButton row={li.fold} tid={t.id} ctx={ctx} />}
      {li.msg && <Message m={li.msg} quote={li.quote} tid={t.id} ctx={ctx} />}
      {kids && (
        <ol>
          {li.kids.map((k) => (
            <Item key={k.msg?.id ?? `f${k.fold?.at}`} li={k} t={t} ctx={ctx} />
          ))}
        </ol>
      )}
      {li.foot && (
        <p className="rl-foot m-0">
          {t.turn === "your" ? (
            <span className="inline-flex h-(--av) items-center gap-1.5 font-semibold text-turn">
              <Reply aria-hidden className={icon} />
              Your turn
            </span>
          ) : (
            <span className="inline-flex h-(--av) items-center gap-1.5 font-medium text-ink-2">
              <Hourglass aria-hidden className={icon} />
              {turnText(t)}
            </span>
          )}
        </p>
      )}
    </li>
  );
}

// Fold row: the chevron takes the avatar slot, so the tree line ends on it.
function FoldButton({ row, tid, ctx }: { row: FoldRow; tid: number; ctx: ThreadCtx }) {
  return (
    <button
      id={`fold-${row.at}`}
      type="button"
      aria-expanded={row.open}
      onClick={() => ctx.onFold(tid, row)}
      className="rl-fold-b relative flex min-h-(--av) max-w-full cursor-pointer items-center gap-1.5 rounded text-sm text-ink-2 hover:text-foreground hover:[&>.rl-fold-t]:underline"
    >
      {/* The chevron takes the avatar slot, so the tree line ends on it. */}
      <ChevronRight aria-hidden className={cn("rl-chev mx-[calc((var(--av)-15px)/2)] text-muted-foreground", icon)} />
      {row.kind === "branch" && (
        <span className="rl-stack inline-flex flex-none">
          {row.people.slice(0, 3).map((p) => (
            <Avatar key={p.slug} p={p} />
          ))}
        </span>
      )}
      <span className="rl-fold-t min-w-0 truncate">
        {row.kind === "spine"
          ? `${row.open ? "Hide" : "Show"} ${row.n} earlier ${row.n === 1 ? "reply" : "replies"}`
          : `${names(row.people)}, ${row.count} replies · ${ago(row.newest, ctx.now)}`}
      </span>
    </button>
  );
}

const msgBtn = "-my-1 text-muted-foreground hover:bg-hover hover:text-foreground";

function CopyButton({ text, ctx }: { text: string; ctx: ThreadCtx }) {
  // A count, so a second copy within 1.5 s starts the time again.
  const [copied, setCopied] = useState(0);
  useEffect(() => {
    if (!copied) return;
    const h = setTimeout(() => setCopied(0), 1500);
    return () => clearTimeout(h);
  }, [copied]);
  const label = copied ? "Copied" : "Copy Markdown";
  const copy = () =>
    copyText(text).then((ok) => {
      if (!ok) return toast.add({ title: "The clipboard is blocked here. Select the text and press Ctrl+C." });
      setCopied((n) => n + 1);
      ctx.announce("Copied");
    });
  return (
    <HintTrigger hints={ctx.hints} label={label}>
      <Button variant="ghost" size="icon-sm" aria-label={label} onClick={copy} className={msgBtn}>
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </Button>
    </HintTrigger>
  );
}

const Message = memo(function Message({ m, quote, tid, ctx }: { m: Node; quote: boolean; tid: number; ctx: ThreadCtx }) {
  const p = m.parent;
  const name = m.who.me ? "You" : m.who.name;
  return (
    <article
      id={`c-${m.id}`}
      data-id={m.id}
      data-new={m.isNew || undefined}
      tabIndex={-1}
      ref={m.unread ? ctx.ackRef : undefined}
      aria-label={`${name}${p ? `, reply to ${firstName(p.who)}` : ""}, ${agoLong(m.createdAt, ctx.now)}${m.isNew ? ", new" : ""}`}
      className="rl-msg"
    >
      <div className="flex min-h-(--av) flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
        <Avatar p={m.who} />
        <b className="font-semibold text-foreground">{name}</b>
        <HintTrigger hints={ctx.hints} label={fullTime(m.createdAt)}>
          <time dateTime={new Date(m.createdAt).toISOString()}>{ago(m.createdAt, ctx.now)}</time>
        </HintTrigger>
        {m.task && <TaskMark hints={ctx.hints} task={m.task} />}
        {m.isNew && <NewMark text="new" />}
        {m.posted === "run" && <span>Posted from a {ctx.runner} review</span>}
        {!m.deleted && m.text !== null && (
          <span className="ml-auto flex items-center gap-0.5">
            <HintTrigger hints={ctx.hints} label={`Reply to ${m.who.me ? "your message" : m.who.name}`}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Reply to ${m.who.me ? "your message" : m.who.name}`}
                onClick={() => ctx.onReply(tid, m.id)}
                className={msgBtn}
              >
                <Reply aria-hidden />
              </Button>
            </HintTrigger>
            <CopyButton text={m.text} ctx={ctx} />
          </span>
        )}
      </div>
      {quote && p && (
        <button
          type="button"
          onClick={() => ctx.onQuote(tid, p.id)}
          className="rl-indent mt-px flex max-w-[calc(100%-var(--av)-8px)] cursor-pointer items-center gap-1 rounded text-xs text-muted-foreground hover:text-ink-2 hover:[&>span]:underline"
        >
          <CornerDownRight aria-hidden className="size-[13px] shrink-0" />
          <span className="min-w-0 truncate">
            <span className="sr-only">Replies to </span>
            {p.who.me ? "You" : firstName(p.who)}: {p.deleted ? `Deleted on ${ctx.forge}` : snippet(p.text, 64)}
          </span>
        </button>
      )}
      <div className="rl-indent mt-px max-w-[72ch] [overflow-wrap:anywhere]">
        {m.deleted || m.text === null ? <p className="m-0 text-muted-foreground italic">Deleted on {ctx.forge}</p> : <Text text={m.text} />}
      </div>
    </article>
  );
});
