// List pane (prototype/v3 renderList): Needs you, Waiting on others, and a folded Done group.
import { BellOff, ChevronRight, CircleAlert, Hourglass, Menu, Plus, Reply, Search, User, X } from "lucide-react";
import { memo, type Ref, useEffect, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { PrRow } from "../../shared/dto";
import type { PrRef } from "../../shared/types";
import { createHints, Hint, type Hints, HintTrigger, SharedHint } from "./Hint";
import { ago, incompleteText, type ListGroup, prKey, taskHint, why } from "./model";

// prototype/v3 kbd: an outlined mono key.
const kbd = "border border-rule-strong bg-transparent font-mono text-[11px] text-ink-2";
const groupHead = "m-0 flex items-center gap-2 border-b bg-pane-2 px-4 pt-[9px] pb-1.5 text-xs font-semibold text-ink-2";

// The relative times in the rows change once a minute.
function useMinute() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function ListPane(props: {
  title: string;
  count: number;
  groups: ListGroup[];
  loading: boolean;
  repo: string | null;
  query: string;
  empty: string;
  selected: number | null;
  focused: boolean;
  doneOpen: boolean;
  forge: string;
  candidate: PrRef | null;
  following: boolean;
  followError: string | null;
  banner: React.ReactNode;
  filterRef: Ref<HTMLInputElement>;
  onQuery: (q: string) => void;
  onRepo: (r: string | null) => void;
  onDoneOpen: (open: boolean) => void;
  onSelect: (id: number) => void;
  onOpen: (id: number) => void;
  onFollow: () => void;
  onMenu: () => void;
  onFocus: () => void;
}) {
  const now = useMinute();
  const [hints] = useState(createHints);
  const rows = (g: ListGroup) => (
    <ul className="m-0 list-none p-0">
      {g.rows.map((p) => (
        <Row
          key={p.id}
          p={p}
          now={now}
          forge={props.forge}
          hints={hints}
          selected={p.id === props.selected}
          onSelect={props.onSelect}
          onOpen={props.onOpen}
        />
      ))}
    </ul>
  );
  return (
    <section
      aria-labelledby="view-name"
      onFocus={props.onFocus}
      className={cn("rl-pane rl-list grid grid-rows-[auto_auto_minmax(0,1fr)_auto] border-r bg-pane-2", props.focused && "pane-edge")}
    >
      <header className="grid gap-2.5 border-b px-4 pt-3.5 pb-3">
        <div className="flex items-baseline gap-2">
          <button
            type="button"
            className="rl-m-only size-[30px] cursor-pointer items-center justify-center self-center rounded-md text-ink-2 hover:bg-hover"
            aria-label="Open views"
            onClick={props.onMenu}
          >
            <Menu aria-hidden className="size-[15px]" />
          </button>
          <h2
            id="view-name"
            translate={props.repo ? "no" : undefined}
            className="m-0 min-w-0 truncate text-[16px] font-bold tracking-[-0.01em]"
          >
            {props.title}
          </h2>
          <span className="text-sm text-muted-foreground">
            {props.loading ? "" : props.count}
            <span className="sr-only"> pull requests</span>
          </span>
        </div>
        <div className="flex h-[34px] items-center gap-2 rounded-[7px] border bg-pane px-2.5 text-muted-foreground focus-within:border-pen focus-within:shadow-[0_0_0_1px_var(--pen)]">
          <Search aria-hidden className="size-[15px] shrink-0" />
          <input
            ref={props.filterRef}
            type="search"
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="Filter, or paste a pull request URL…"
            aria-label="Filter the list"
            autoComplete="off"
            spellCheck={false}
            value={props.query}
            onChange={(e) => props.onQuery(e.target.value)}
          />
          {props.repo && (
            <span className="inline-flex h-[22px] max-w-[60%] shrink-0 items-center gap-1 rounded-full bg-sel pr-1 pl-2 text-xs font-semibold text-foreground">
              <span translate="no" className="truncate">
                {props.repo}
              </span>
              <Hint label="Show all repositories">
                <button
                  type="button"
                  className="grid size-4 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-hover"
                  aria-label="Show all repositories"
                  onClick={() => props.onRepo(null)}
                >
                  <X aria-hidden className="size-3" />
                </button>
              </Hint>
            </span>
          )}
        </div>
      </header>
      <div>{props.banner}</div>
      <div className="relative overflow-auto overscroll-contain" id="rows" tabIndex={-1}>
        {props.candidate && (
          <div className="grid gap-1 border-b bg-pane px-4 py-2.5">
            <button
              type="button"
              className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-primary bg-primary px-3 py-1 font-semibold text-primary-foreground disabled:opacity-60"
              onClick={props.onFollow}
              disabled={props.following}
            >
              <Plus aria-hidden className="size-3.5" />
              {props.following ? "Following…" : "Follow this pull request"}
            </button>
            <span translate="no" className="font-mono text-xs text-muted-foreground">
              {props.candidate.project}/{props.candidate.repo} #{props.candidate.id}
            </span>
            {props.followError && (
              <span role="alert" className="text-sm text-destructive">
                {props.followError}
              </span>
            )}
          </div>
        )}
        {props.loading ? (
          <SkeletonRows />
        ) : props.groups.length ? (
          props.groups.map((g) =>
            g.id === "done" ? (
              <details key={g.id} open={props.doneOpen} onToggle={(e) => props.onDoneOpen(e.currentTarget.open)}>
                <summary className="sticky top-0 z-[1] focus-visible:outline-offset-[-2px] [&:hover_h3]:bg-hover">
                  <h3 id={`g-${g.id}`} className={groupHead}>
                    {g.label}
                    <span className="font-medium text-muted-foreground">{g.rows.length}</span>
                    <ChevronRight aria-hidden className="rl-chev ml-auto size-[15px] text-muted-foreground" />
                  </h3>
                </summary>
                {rows(g)}
              </details>
            ) : (
              <section key={g.id} aria-labelledby={`g-${g.id}`}>
                <h3 id={`g-${g.id}`} className={cn(groupHead, "sticky top-0 z-[1]")}>
                  {g.label}
                  <span className="font-medium text-muted-foreground">{g.rows.length}</span>
                </h3>
                {rows(g)}
              </section>
            ),
          )
        ) : (
          !props.candidate && (
            <p className="m-0 px-4 py-8 text-ink-2">{props.query.trim() ? "No pull requests match this filter." : props.empty}</p>
          )
        )}
      </div>
      <footer className="rl-wide-only flex flex-wrap gap-x-3 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Kbd className={kbd}>j</Kbd>
          <Kbd className={kbd}>k</Kbd> move
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd className={kbd}>Enter</Kbd> open
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd className={kbd}>/</Kbd> filter
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd className={kbd}>?</Kbd> all keys
        </span>
      </footer>
      <SharedHint hints={hints} />
    </section>
  );
}

const fullTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// An icon with words for screen readers and a tooltip with the same words.
function IconHint({ hints, label, icon: Icon }: { hints: Hints; label: string; icon: typeof User }) {
  return (
    <HintTrigger hints={hints} label={label}>
      <span role="img" aria-label={label} className="inline-flex shrink-0 text-muted-foreground">
        <Icon aria-hidden className="size-[15px]" />
      </span>
    </HintTrigger>
  );
}

// Memo: a key press renders the shell again, but a row changes only with its data or its selection.
const Row = memo(function Row({
  p,
  now,
  forge,
  hints,
  selected,
  onSelect,
  onOpen,
}: {
  p: PrRow;
  now: number;
  forge: string;
  hints: Hints;
  selected: boolean;
  onSelect: (id: number) => void;
  onOpen: (id: number) => void;
}) {
  const w = why(p, now);
  const task = p.tasks[0];
  const incomplete = incompleteText(p.checkpoint, forge);
  return (
    <li>
      <button
        type="button"
        id={`row-${p.id}`}
        data-row
        aria-current={selected ? "true" : undefined}
        className={cn(
          "grid w-full cursor-pointer gap-[3px] border-0 border-b bg-transparent px-4 py-(--row-y) text-left hover:bg-hover focus-visible:outline-offset-[-2px]",
          selected && "bg-sel hover:bg-sel",
        )}
        onClick={() => onSelect(p.id)}
        onDoubleClick={() => onOpen(p.id)}
      >
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span translate="no" className="min-w-0 truncate font-mono">
            {prKey(p)}
          </span>
          {task && (
            <HintTrigger hints={hints} label={taskHint(task)}>
              <span translate="no" className="shrink-0 font-mono text-ink-2">
                {task.key}
              </span>
            </HintTrigger>
          )}
          {p.role === "AUTHOR" && <IconHint hints={hints} label="Your pull request" icon={User} />}
          {!p.followed && <IconHint hints={hints} label="Not followed" icon={BellOff} />}
          {incomplete && (
            <HintTrigger hints={hints} label={incomplete}>
              <span className="inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap text-destructive">
                <CircleAlert aria-hidden className="size-[15px]" />
                Last check incomplete
              </span>
            </HintTrigger>
          )}
          <HintTrigger hints={hints} label={fullTime(p.lastActivity)}>
            <time dateTime={new Date(p.lastActivity).toISOString()} className="ml-auto shrink-0 whitespace-nowrap">
              {ago(p.lastActivity, now)}
            </time>
          </HintTrigger>
        </span>
        {p.title === null ? (
          <span className="min-w-0 truncate text-muted-foreground italic">Loading details…</span>
        ) : (
          <span className="min-w-0 truncate font-semibold">{p.title}</span>
        )}
        <span className="flex min-w-0 items-baseline gap-2 text-sm text-ink-2">
          {w.closed && <b className="shrink-0 font-semibold text-foreground">{w.closed}</b>}
          {w.turn?.kind === "your" && (
            <span className="inline-flex shrink-0 items-center gap-1.5 self-center font-semibold whitespace-nowrap text-turn">
              <Reply aria-hidden className="size-[15px]" />
              {w.turn.text}
            </span>
          )}
          {w.turn?.kind === "wait" && (
            <span className="inline-flex self-center">
              <IconHint hints={hints} label={w.turn.text} icon={Hourglass} />
            </span>
          )}
          {(w.lead || w.text) && (
            <span className="min-w-0 truncate">
              {w.lead && <b className="font-semibold text-foreground">{w.lead}</b>}
              {w.lead && w.text && " "}
              {w.text}
            </span>
          )}
          {p.unread > 0 && (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 self-center text-xs font-semibold whitespace-nowrap text-foreground">
              <span aria-hidden className="size-[7px] rounded-full bg-foreground" />
              {p.unread} new
            </span>
          )}
        </span>
      </button>
    </li>
  );
});

function SkeletonRows() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading pull requests">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="grid gap-2 border-b px-4 py-3">
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
      ))}
    </div>
  );
}
