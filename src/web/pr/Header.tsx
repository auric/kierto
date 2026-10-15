// Detail header (prototype/v3 renderDetail .dh, pr-view-v4 2.3): key, branches, task IDs, title, the action bar, and the status strip.
// The action bar sticks to the top of the pane. When the title leaves the view, the bar shows the key and the title.
import { Archive, Check, Copy, ExternalLink, FileDiff, MessageCircleQuestionMark, MessageSquare, Reply, Star } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import type { PrRow } from "../../shared/dto";
import { archived } from "../../shared/views";
import { useMeta } from "../meta";
import { useArchive, useFollow } from "../shell/data";
import { Hint } from "../shell/Hint";
import { prKey, taskHint } from "../shell/model";
import { NewMark } from "./Thread";
import { visitText } from "./threads";

// Only http(s) links from the server reach an href.
export function webLink(url: string | null): string | null {
  if (!url) return null;
  try {
    return /^https?:$/.test(new URL(url).protocol) ? url.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

const iconBtn = "text-ink-2 hover:bg-hover hover:text-foreground";

// The branch name links to its page on the forge. The copy button shows on hover and on focus, and always on a touch screen.
function BranchRef({ name, url, forge, announce }: { name: string; url: string | null; forge: string; announce: (text: string) => void }) {
  // A count, so a second copy within 1.5 s starts the time again.
  const [copied, setCopied] = useState(0);
  useEffect(() => {
    if (!copied) return;
    const h = setTimeout(() => setCopied(0), 1500);
    return () => clearTimeout(h);
  }, [copied]);
  const href = webLink(url);
  const copy = () =>
    copyText(name).then((ok) => {
      if (!ok) return toast.add({ title: "The clipboard is blocked here. Select the branch name and press Ctrl+C." });
      setCopied((n) => n + 1);
      announce(`Copied ${name}.`);
    });
  const text = "min-w-0 font-mono text-ink-2 [overflow-wrap:anywhere]";
  return (
    <span data-branch={name} className="group/br inline-flex min-w-0 items-center">
      {href ? (
        <Hint label={`Open the branch in ${forge}`}>
          <a href={href} target="_blank" rel="noopener noreferrer" className={cn(text, "rounded hover:text-pen hover:underline")}>
            {name}
          </a>
        </Hint>
      ) : (
        <code className={text}>{name}</code>
      )}
      <Hint label={copied ? "Copied" : "Copy the branch name"}>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Copy ${name}`}
          className="ml-0.5 text-muted-foreground opacity-0 group-focus-within/br:opacity-100 group-hover/br:opacity-100 hover:text-foreground pointer-coarse:opacity-100"
          onClick={() => void copy()}
        >
          {copied ? <Check key={copied} aria-hidden className="rl-pop" /> : <Copy aria-hidden />}
        </Button>
      </Hint>
    </span>
  );
}

// The bar sticks once the header part above it leaves the view. Then it shows the key and the title.
// It sets the scroll padding of the pane to its height, so a scroll target stops below it.
function ActionBar({
  top,
  label,
  title,
  children,
}: {
  top: RefObject<HTMLElement | null>;
  label: string;
  title: string;
  children: ReactNode;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = top.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e && setStuck(!e.isIntersecting && e.boundingClientRect.top < (e.rootBounds?.top ?? 0)), {
      root: bar.current?.closest<HTMLElement>("[data-scroll]") ?? null,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [top]);
  useLayoutEffect(() => {
    const el = bar.current;
    const pane = el?.closest<HTMLElement>("[data-scroll]");
    if (!el || !pane) return;
    const ro = new ResizeObserver(() => {
      pane.style.scrollPaddingTop = `${el.offsetHeight}px`;
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      pane.style.scrollPaddingTop = "";
    };
  }, []);
  return (
    <div
      ref={bar}
      data-actionbar
      data-stuck={stuck || undefined}
      className="sticky top-0 z-[3] flex items-center gap-3 border-b border-transparent bg-pane px-6 py-2 max-[759px]:px-4 data-stuck:border-border"
    >
      {stuck && (
        // The h1 above holds the same words for a screen reader. A narrow pane gives the width to the buttons.
        <p aria-hidden className="rl-fade rl-wide-pane m-0 flex min-w-0 flex-[1_1_0] items-baseline gap-2 overflow-hidden">
          <span translate="no" className="max-w-[40%] shrink-0 truncate font-mono text-xs text-muted-foreground">
            {label}
          </span>
          <span className="truncate text-sm font-semibold">{title}</span>
        </p>
      )}
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}

const jump = "inline-flex cursor-pointer items-center gap-1.5 rounded underline-offset-3 hover:text-foreground hover:underline";

// Status strip (plan pr-view-v4 2.3): one line of jumps. Each part is a button. Only "No comments yet" is text.
// since: the last visit before this one. fresh: the new messages. open: the threads that are not resolved.
// files: the count of Files, null while no list is known.
export function Strip(p: {
  your: number;
  fresh: number;
  since: number | null;
  now: number;
  threads: number;
  open: number;
  drafts: number;
  files: number | null;
  onYour: () => void;
  onNew: () => void;
  onThreads: () => void;
  onDrafts: () => void;
  onFiles: () => void;
}) {
  return (
    <>
      {p.your > 0 && (
        <Hint label="Next thread where it is your turn. Key: y">
          <button type="button" aria-keyshortcuts="y" onClick={p.onYour} className={cn(jump, "font-semibold text-turn hover:text-turn")}>
            <Reply aria-hidden className="size-[15px]" />
            Your turn in {p.your} {p.your === 1 ? "thread" : "threads"}
          </button>
        </Hint>
      )}
      {p.fresh > 0 && (
        <Hint label="Next new message. Key: n">
          <button type="button" aria-keyshortcuts="n" onClick={p.onNew} className={jump}>
            <NewMark text={`${p.fresh} new`} />
            {/* A flex box drops the space from the layout, but the name keeps it: "2 new since yesterday". */}
            {p.since !== null && (
              <>
                {" "}
                <span>since {visitText(p.since, p.now)}</span>
              </>
            )}
          </button>
        </Hint>
      )}
      {p.threads > 0 ? (
        <Hint label={p.open ? "Go to the first open thread" : "Show the resolved threads"}>
          <button type="button" onClick={p.onThreads} className={jump}>
            <MessageSquare aria-hidden className="size-[15px]" />
            {p.open ? `${p.open} open ${p.open === 1 ? "thread" : "threads"}` : "No open thread"}
          </button>
        </Hint>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <MessageSquare aria-hidden className="size-[15px]" />
          No comments yet
        </span>
      )}
      {p.drafts > 0 && (
        <Hint label="Go to the drafts. Key: 2">
          <button type="button" aria-keyshortcuts="2" onClick={p.onDrafts} className={jump}>
            {p.drafts} {p.drafts === 1 ? "draft" : "drafts"}
          </button>
        </Hint>
      )}
      <Hint label="Go to Files. Keys: g, then f">
        <button type="button" onClick={p.onFiles} className={jump}>
          <FileDiff aria-hidden className="size-[15px]" />
          {p.files === null ? "Files" : `${p.files} ${p.files === 1 ? "file" : "files"}`}
        </button>
      </Hint>
    </>
  );
}

// action, brief: the run buttons and the review brief under the strip (plan v3 WP11). strip: the parts of the status strip, null
// while the PR loads. onAsk: the q key (plan r2 UI-ASK).
export function Header(props: {
  pr: PrRow;
  strip: ReactNode;
  onLeave: () => void;
  onAsk: () => void;
  announce: (text: string) => void;
  action: ReactNode;
  brief: ReactNode;
}) {
  const { pr, announce } = props;
  const follow = useFollow();
  const archive = useArchive();
  const meta = useMeta().data;
  const forge = meta?.forge.name ?? "";
  const runner = meta?.runner.short ?? "";
  const top = useRef<HTMLElement>(null);
  const key = prKey(pr);
  const title = pr.title ?? key;
  const web = webLink(pr.webUrl);
  const onArchive = () => {
    props.onLeave();
    archive.mutate({ id: pr.id, label: key });
  };
  const following = pr.followed ? "Following. Select to stop." : "Follow";
  // The archive notice of the detail holds the one action for an archived PR.
  const listed = !archived(pr);
  const pad = "px-6 max-[759px]:px-4";
  return (
    <>
      <header ref={top} className={cn("grid gap-1.5 pt-3 max-[759px]:pt-2", pad)}>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
          <span translate="no" className="font-mono [overflow-wrap:anywhere]">
            {key}
          </span>
          {pr.sourceBranch && (
            <span translate="no" className="flex min-w-0 flex-wrap items-center gap-x-1 max-[759px]:order-3 max-[759px]:basis-full">
              <BranchRef name={pr.sourceBranch} url={pr.sourceBranchUrl} forge={forge} announce={announce} />
              into
              {pr.targetBranch ? (
                <BranchRef name={pr.targetBranch} url={pr.targetBranchUrl} forge={forge} announce={announce} />
              ) : (
                <code className="font-mono text-ink-2">?</code>
              )}
            </span>
          )}
          {pr.tasks.map((t) => {
            const url = webLink(t.url);
            const chip =
              "inline-flex items-baseline rounded-[5px] border px-2 py-0.5 font-mono text-xs whitespace-nowrap max-[759px]:order-4";
            return (
              <Hint key={t.key} label={taskHint(t)}>
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    translate="no"
                    className={cn(chip, "text-pen hover:border-rule-strong hover:underline")}
                  >
                    {t.key}
                  </a>
                ) : (
                  <span translate="no" className={cn(chip, "text-ink-2")}>
                    {t.key}
                  </span>
                )}
              </Hint>
            );
          })}
          <span className="ml-auto flex items-center gap-0.5">
            {web && (
              <Hint label={`Open in ${forge}`}>
                <a
                  href={web}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open in ${forge}`}
                  className={buttonVariants({ variant: "ghost", size: "icon-sm", className: iconBtn })}
                >
                  <ExternalLink aria-hidden />
                </a>
              </Hint>
            )}
            {listed && (
              <>
                <Hint label={following}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={iconBtn}
                    aria-label="Follow"
                    aria-pressed={pr.followed}
                    disabled={follow.isPending}
                    onClick={() => {
                      // Off the dashboard, an unfollowed PR leaves every list but Archive.
                      if (pr.followed && !pr.onDashboard) props.onLeave();
                      follow.mutate({ pr, followed: !pr.followed });
                    }}
                  >
                    <Star aria-hidden className={cn(pr.followed && "fill-current")} />
                  </Button>
                </Hint>
                <Hint label="Archive">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={iconBtn}
                    aria-label="Archive"
                    disabled={archive.isPending}
                    onClick={onArchive}
                  >
                    <Archive aria-hidden />
                  </Button>
                </Hint>
              </>
            )}
          </span>
        </div>
        <h1 className="m-0 min-w-0 text-(length:--fs-title) leading-tight font-bold tracking-[-0.015em] text-balance [overflow-wrap:anywhere]">
          {title}
        </h1>
      </header>
      <ActionBar top={top} label={key} title={title}>
        <Hint label={`Ask ${runner} a question about this pull request. Key: q`}>
          <Button
            id="ask-btn"
            size="sm"
            variant="outline"
            aria-label={`Ask ${runner}`}
            aria-keyshortcuts="q"
            className="@max-[560px]/detail:pr-1.5"
            onClick={props.onAsk}
          >
            <MessageCircleQuestionMark aria-hidden data-icon="inline-start" />
            {/* A narrow pane keeps the bar on one line where it can. */}
            <span className="@max-[560px]/detail:sr-only">Ask</span>
          </Button>
        </Hint>
        {props.action}
      </ActionBar>
      <nav
        aria-label="Pull request summary"
        className={cn("flex min-h-[29px] flex-wrap items-center gap-x-4 gap-y-1 border-b pt-0.5 pb-3 text-sm text-ink-2", pad)}
      >
        {props.strip}
      </nav>
      {/* The panel slot. The task chips show here while the brief is closed. */}
      <div className={cn("pt-3 empty:hidden", pad)}>{props.brief}</div>
    </>
  );
}
