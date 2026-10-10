// PR detail (plan G7): header, tabs, and the Activity timeline.
import { ExternalLink } from "lucide-react";
import { lazy, type MouseEvent, Suspense, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { CommentDto, PrDetail as Detail, PrRow } from "../../shared/dto";
import { isMe } from "../../shared/me";
import { ApiError, useArchive, useFollow, usePr } from "../shell/data";
import { ago, initials, prKey } from "../shell/model";
import { Calm, CheckBanner } from "../states";
import { anchorOf, buildThreads, type Msg, mergeHighlights, openThreads } from "./threads";
import { useAck } from "./useAck";

// The Markdown renderer loads on first use, so the main chunk stays small. Plain text shows until then.
const Markdown = lazy(() => import("./Markdown").then((m) => ({ default: m.Markdown })));

function Text({ text }: { text: string }) {
  return (
    <Suspense fallback={<p className="m-0 whitespace-pre-wrap">{text}</p>}>
      <Markdown text={text} />
    </Suspense>
  );
}

const STATUS_TEXT: Record<string, string> = { APPROVED: "Approved", NEEDS_WORK: "Needs work", UNAPPROVED: "Not reviewed" };

// Only http(s) links from the server reach an href.
function webLink(url: string | null): string | null {
  if (!url) return null;
  try {
    return /^https?:$/.test(new URL(url).protocol) ? url.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

// onLeave: the shell moves the selection away before the PR leaves the list.
export function PrDetail({ pr: row, me, onLeave }: { pr: PrRow; me: string | null; onLeave: () => void }) {
  const q = usePr(row.id);
  const pr = q.data?.pr ?? row;
  return (
    <>
      <Header pr={pr} me={me} onLeave={onLeave} />
      <div className="flex items-center gap-0.5 overflow-x-auto border-b px-6 max-[759px]:px-3" role="tablist" aria-label="Pull request">
        <button type="button" role="tab" id="tab-activity" aria-selected="true" aria-controls="panel-activity" className="rl-tab">
          Activity
        </button>
        {["Review", "Run log"].map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected="false"
            aria-disabled="true"
            aria-describedby="tabs-note"
            className="rl-tab"
          >
            {t}
          </button>
        ))}
        <span id="tabs-note" className="ml-auto pl-4 text-[11.5px] whitespace-nowrap text-muted-foreground">
          Review and Run log arrive in M2<span className="rl-wide-only"> · n next new · ? all keys</span>
        </span>
      </div>
      <div id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" className="grid gap-4 px-6 pt-[18px] pb-6 max-[759px]:px-4">
        <CheckBanner checkpoint={pr.checkpoint} />
        {q.data ? (
          <Activity key={pr.id} detail={q.data} me={me} />
        ) : q.error ? (
          <Calm
            title={
              q.error instanceof ApiError && q.error.status === 404 ? "This pull request left the inbox" : "Cannot load this pull request"
            }
          >
            <p className="m-0">
              {q.error instanceof ApiError && q.error.status === 404
                ? "It was archived or is no longer on your dashboard."
                : q.error.message}
            </p>
          </Calm>
        ) : (
          <div role="status" aria-busy="true" aria-label="Loading activity" className="grid max-w-[760px] gap-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
      </div>
    </>
  );
}

function Header({ pr, me, onLeave }: { pr: PrRow; me: string | null; onLeave: () => void }) {
  const follow = useFollow();
  const archive = useArchive();
  const key = prKey(pr);
  const web = webLink(pr.webUrl);

  const onArchive = () => {
    onLeave();
    archive.mutate({ id: pr.id, label: key });
  };

  return (
    <header className="grid gap-2 border-b px-6 pt-4 pb-3 max-[759px]:px-4">
      <div className="flex flex-wrap items-start gap-3">
        <h1 className="m-0 min-w-0 flex-1 text-[19px] leading-snug font-bold tracking-tight text-balance">{pr.title ?? key}</h1>
        <div className="flex items-center gap-2">
          <span id="review-note" className="text-[11.5px] text-muted-foreground">
            Arrives in M2
          </span>
          <Button size="sm" disabled aria-describedby="review-note">
            Review
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[12.5px] text-muted-foreground">
        <span translate="no" className="font-mono text-[11.5px] [overflow-wrap:anywhere]">
          {key}
        </span>
        {pr.sourceBranch && (
          <span translate="no" className="font-mono text-[11.5px] [overflow-wrap:anywhere]">
            {pr.sourceBranch} → {pr.targetBranch ?? "?"}
          </span>
        )}
        {web && (
          <>
            <a className="inline-flex items-center gap-1 text-primary hover:underline" href={web} target="_blank" rel="noopener noreferrer">
              Open in Bitbucket
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
            <a
              className="inline-flex items-center gap-1 text-primary hover:underline"
              href={`${web}/diff`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Diff
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-[12.5px] text-muted-foreground">
        {pr.authorSlug && (
          <span className="inline-flex items-center gap-1.5">
            <Avatar name={pr.authorName ?? pr.authorSlug} />
            {pr.authorName ?? pr.authorSlug}, author
          </span>
        )}
        {pr.reviewers.length > 0 && (
          <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            Reviewers
            {pr.reviewers.map((r) => (
              <span key={r.slug} className="inline-flex items-center gap-1.5">
                <Avatar name={r.name} ring={RING[r.status]} />
                <span>
                  {isMe(r, me) ? "You" : r.name}, {(STATUS_TEXT[r.status] ?? r.status).toLowerCase()}
                </span>
              </span>
            ))}
          </span>
        )}
        {!pr.followed && <span>Not followed</span>}
        <span className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={follow.isPending}
            onClick={() => follow.mutate({ id: pr.id, followed: !pr.followed })}
          >
            {pr.followed ? "Unfollow" : "Follow"}
          </Button>
          <Button size="sm" variant="outline" disabled={archive.isPending} onClick={onArchive}>
            Archive
          </Button>
        </span>
      </div>
    </header>
  );
}

// The ring repeats the status text in color (prototype/index.html:139).
const RING: Record<string, string> = { APPROVED: "ring-ok", NEEDS_WORK: "ring-warn" };

function Avatar({ name, ring }: { name: string; ring?: string | undefined }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[9.5px] font-semibold text-foreground",
        ring && "ring-2 ring-offset-1 ring-offset-pane",
        ring,
      )}
    >
      {initials(name)}
    </span>
  );
}

// Opens a collapsed thread, then scrolls to the message and focuses it.
export function jumpTo(el: HTMLElement) {
  const details = el.closest("details");
  if (details) details.open = true;
  el.scrollIntoView({ block: "center" });
  el.focus({ preventScroll: true });
}

function Activity({ detail, me }: { detail: Detail; me: string | null }) {
  const { comments } = detail;
  const [hl, setHl] = useState(() => mergeHighlights(new Set(), comments));
  const [atOpen] = useState(hl);
  const next = mergeHighlights(hl, comments);
  if (next !== hl) setHl(next);
  const threads = buildThreads(comments, next, atOpen);
  const mine = openThreads(comments, me);
  const ackRef = useAck(detail.pr.id, comments);
  const now = Date.now();

  const jump = (e: MouseEvent<HTMLAnchorElement>, id: number) => {
    const el = document.getElementById(`c-${id}`);
    if (!el) return;
    e.preventDefault();
    jumpTo(el);
  };

  return (
    <>
      {!detail.pr.followed && (
        <p className="m-0 text-muted-foreground">Not followed. Review Loop does not check this pull request for new comments.</p>
      )}
      {detail.description && (
        <section aria-label="Description" className="max-w-[760px] rounded-md border bg-card px-3 py-2.5 [overflow-wrap:anywhere]">
          <Text text={detail.description} />
        </section>
      )}
      {mine.length > 0 && (
        <section aria-labelledby="mine-title" className="grid max-w-[760px] gap-1.5">
          <h2 id="mine-title" className="m-0 text-[12.5px] font-semibold text-muted-foreground">
            Your open threads
          </h2>
          <ul className="m-0 grid list-none gap-1 p-0">
            {mine.map((c) => (
              <li key={c.id} className="min-w-0 truncate">
                <a href={`#c-${c.id}`} onClick={(e) => jump(e, c.id)} className="text-primary hover:underline">
                  {where(c) ?? firstLine(c.text)}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {threads.length ? (
        <ol className="m-0 max-w-[760px] list-none border-l p-0">
          {threads.map((t) => (
            <ThreadItem key={t.root.id} root={t.root} open={t.highlighted} divider={t.divider} hl={next} ackRef={ackRef} now={now} />
          ))}
        </ol>
      ) : (
        <p className="m-0 text-muted-foreground">No comments yet.</p>
      )}
    </>
  );
}

type Shared = { hl: ReadonlySet<number>; ackRef: (el: HTMLElement | null) => (() => void) | undefined; now: number };

function ThreadItem({ root, open, divider, ...shared }: { root: Msg; open: boolean; divider: boolean } & Shared) {
  const count = countReplies(root);
  return (
    <>
      {divider && (
        <li className="mb-4 ml-3.5 flex items-center gap-2 text-[12px] font-semibold text-primary after:h-px after:flex-1 after:bg-primary">
          New since you last looked
        </li>
      )}
      <li className="relative pb-4 pl-[18px] before:absolute before:top-1.5 before:-left-1 before:size-[7px] before:rounded-full before:bg-border">
        {open ? (
          <Tree m={root} {...shared} />
        ) : (
          <details className="group">
            <summary className="cursor-pointer text-[12.5px] text-muted-foreground marker:text-border">
              <b className="font-semibold text-foreground">{who(root)}</b> {firstLine(root.deleted ? "Deleted on Bitbucket" : root.text)}
              {count > 0 && ` · ${count} ${count === 1 ? "reply" : "replies"}`}
            </summary>
            <div className="mt-1.5">
              <Tree m={root} {...shared} />
            </div>
          </details>
        )}
      </li>
    </>
  );
}

function Tree({ m, ...shared }: { m: Msg } & Shared) {
  return (
    <>
      <Message m={m} {...shared} />
      {m.replies.length > 0 && (
        <div className="mt-2 ml-3 grid gap-2 border-l-2 pl-3">
          {m.replies.map((r) => (
            <Tree key={r.id} m={r} {...shared} />
          ))}
        </div>
      )}
    </>
  );
}

function Message({ m, hl, ackRef, now }: { m: Msg } & Shared) {
  const isNew = hl.has(m.id);
  const anchor = anchorOf(m);
  return (
    <article
      id={`c-${m.id}`}
      data-id={m.id}
      data-new={isNew || undefined}
      tabIndex={-1}
      ref={m.unread ? ackRef : undefined}
      aria-label={`${who(m)}${isNew ? ", new" : ""}`}
      className="scroll-my-6 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-muted-foreground">
        <b className="font-semibold text-foreground">{who(m)}</b>
        {m.parentId === null ? (anchor ? "commented on" : "commented") : "replied"}
        {m.parentId === null && anchor && (
          <span translate="no" className="font-mono text-[11.5px] [overflow-wrap:anywhere]">
            {where(m)}
          </span>
        )}
        <span title={new Date(m.createdAt).toLocaleString()}>· {ago(m.createdAt, now)}</span>
        {isNew && <Badge variant="soft">New</Badge>}
        {anchor?.orphaned && <Badge variant="quiet">outdated</Badge>}
      </div>
      <div
        className={cn(
          "mt-1.5 min-w-0 rounded-md border px-[11px] py-2 [overflow-wrap:anywhere]",
          isNew ? "border-transparent bg-accent" : "bg-card",
        )}
      >
        {m.deleted || m.text === null ? <p className="m-0 text-muted-foreground italic">Deleted on Bitbucket</p> : <Text text={m.text} />}
      </div>
    </article>
  );
}

const who = (c: CommentDto) => c.authorName ?? c.authorSlug;

function where(c: CommentDto): string | null {
  const a = anchorOf(c);
  return a ? (a.line === undefined ? a.path : `${a.path}:${a.line}`) : null;
}

function firstLine(text: string | null): string {
  const line = (text ?? "").split("\n").find((l) => l.trim()) ?? "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

const countReplies = (m: Msg): number => m.replies.reduce((n, r) => n + 1 + countReplies(r), 0);
