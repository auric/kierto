import { CircleAlert, Menu, Plus, X } from "lucide-react";
import type { Ref } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { PrRow } from "../../shared/dto";
import type { PrRef } from "../../shared/types";
import { VIEW_LABEL, type View } from "../../shared/views";
import { ago, type BadgeInfo, badges, incompleteText, initials, prKey } from "./model";

const VARIANT: Record<BadgeInfo["tone"], "soft" | "quiet" | "warn"> = { new: "soft", reason: "soft", muted: "quiet", warn: "warn" };

const EMPTY: Record<View, string> = {
  needs: "Nothing needs you. New pull requests appear here after the next check.",
  reviewing: "No open pull requests to review.",
  mine: "You have no open pull requests.",
  following: "You follow no pull requests. Paste a pull request URL into the filter to follow it.",
};

export function ListPane(props: {
  view: View;
  rows: PrRow[];
  loading: boolean;
  repo: string | null;
  query: string;
  selected: number | null;
  focused: boolean;
  candidate: PrRef | null;
  following: boolean;
  followError: string | null;
  banner: React.ReactNode;
  filterRef: Ref<HTMLInputElement>;
  onQuery: (q: string) => void;
  onRepo: (r: string | null) => void;
  onSelect: (id: number) => void;
  onOpen: (id: number) => void;
  onFollow: () => void;
  onMenu: () => void;
  onFocus: () => void;
}) {
  const now = Date.now();
  return (
    <section
      aria-labelledby="view-name"
      onFocus={props.onFocus}
      className={cn("rl-pane rl-list grid grid-rows-[auto_auto_minmax(0,1fr)_auto] border-r bg-pane-2", props.focused && "pane-edge")}
    >
      <header className="flex flex-wrap items-center gap-2 border-b px-4 pt-3.5 pb-2.5">
        <button
          type="button"
          className="rl-m-only size-[30px] cursor-pointer place-items-center items-center justify-center rounded-md text-muted-foreground hover:bg-hover"
          aria-label="Open views"
          onClick={props.onMenu}
        >
          <Menu aria-hidden className="size-4" />
        </button>
        <h2 id="view-name" className="m-0 text-[15px] font-bold tracking-tight">
          {VIEW_LABEL[props.view]}
        </h2>
        <span className="text-[13px] text-muted-foreground">
          {props.loading ? "" : props.rows.length}
          <span className="sr-only"> pull requests</span>
        </span>
        <span className="flex-1" />
        {props.repo && (
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1 rounded-full border bg-pane py-px pr-1 pl-2 font-mono text-[11.5px] text-muted-foreground hover:text-foreground"
            title="Clear the repository filter"
            aria-label={`Clear the repository filter ${props.repo}`}
            onClick={() => props.onRepo(null)}
          >
            {props.repo}
            <X aria-hidden className="size-3" />
          </button>
        )}
        <input
          ref={props.filterRef}
          type="search"
          className="w-full basis-full rounded-md border bg-pane px-2.5 py-1.5 placeholder:text-muted-foreground"
          placeholder="Filter, or paste a pull request URL"
          aria-label="Filter the list"
          title="Filter (/)"
          autoComplete="off"
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
        />
      </header>
      <div>{props.banner}</div>
      <div className="overflow-auto overscroll-contain" id="rows">
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
            <span className="font-mono text-[11.5px] text-muted-foreground">
              {props.candidate.project}/{props.candidate.repo} #{props.candidate.id}
            </span>
            {props.followError && (
              <span role="alert" className="text-[12.5px] text-destructive">
                {props.followError}
              </span>
            )}
          </div>
        )}
        {props.loading ? (
          <SkeletonRows />
        ) : props.rows.length ? (
          props.rows.map((p) => (
            <Row key={p.id} p={p} now={now} selected={p.id === props.selected} onSelect={props.onSelect} onOpen={props.onOpen} />
          ))
        ) : (
          !props.candidate && (
            <p className="m-0 px-4 py-8 text-muted-foreground">
              {props.query.trim() || props.repo ? "No pull requests match this filter." : EMPTY[props.view]}
            </p>
          )
        )}
      </div>
      <p className="rl-wide-only m-0 truncate border-t px-4 py-[7px] text-[11.5px] text-muted-foreground">
        j k move · Enter open · / filter · ? all keys
      </p>
    </section>
  );
}

function Row({
  p,
  now,
  selected,
  onSelect,
  onOpen,
}: {
  p: PrRow;
  now: number;
  selected: boolean;
  onSelect: (id: number) => void;
  onOpen: (id: number) => void;
}) {
  const unread = p.unread > 0;
  const list = badges(p);
  const incomplete = incompleteText(p.checkpoint);
  return (
    <button
      type="button"
      id={`row-${p.id}`}
      data-row
      aria-current={selected ? "true" : undefined}
      className={cn(
        "grid w-full cursor-pointer gap-[3px] border-0 border-b bg-transparent py-[9px] pr-4 pl-3 text-left hover:bg-hover",
        selected && "bg-accent shadow-[inset_3px_0_0_var(--primary)] hover:bg-accent",
      )}
      onClick={() => onSelect(p.id)}
      onDoubleClick={() => onOpen(p.id)}
    >
      <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", unread && "bg-primary")} />
        {unread && <span className="sr-only">Unread.</span>}
        <span className="min-w-0 flex-auto truncate font-mono text-[11.5px]">{prKey(p)}</span>
        {incomplete && (
          <span className="inline-flex shrink-0 items-center gap-1 text-warn" title={incomplete}>
            <CircleAlert aria-hidden className="size-3.5" />
            <span className="text-[11px]">Incomplete</span>
            <span className="sr-only">{incomplete}</span>
          </span>
        )}
        <span className="shrink-0 text-[11.5px]">{ago(p.lastActivity, now)}</span>
      </span>
      <span className="flex min-w-0 items-center gap-2 pl-[15px]">
        {p.title === null ? (
          <span className="min-w-0 flex-1 truncate text-muted-foreground italic">Loading details</span>
        ) : (
          <span className={cn("min-w-0 flex-1 truncate", unread ? "font-bold" : "font-medium")}>{p.title}</span>
        )}
        {p.authorName && (
          <span
            className="inline-grid size-[22px] shrink-0 place-items-center rounded-full bg-muted text-[9.5px] font-bold text-muted-foreground"
            title={`${p.authorName}, author`}
          >
            {initials(p.authorName)}
          </span>
        )}
      </span>
      {list.length > 0 && (
        <span className="flex min-w-0 flex-wrap items-center gap-1 pl-[15px]">
          {list.map((b) => (
            <Badge key={b.text} variant={VARIANT[b.tone]} className={cn(selected && b.tone !== "muted" && "bg-pane")}>
              {b.text}
            </Badge>
          ))}
        </span>
      )}
    </button>
  );
}

function SkeletonRows() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading pull requests">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="grid gap-2 border-b py-3 pr-4 pl-[27px]">
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
      ))}
    </div>
  );
}
