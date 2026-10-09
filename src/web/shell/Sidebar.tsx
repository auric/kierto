import { Bell, ChevronDown, Eye, Folder, GitPullRequest, Moon, RefreshCw, Settings, Star, Sun } from "lucide-react";
import { type ComponentType, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { VIEW_LABEL, type View } from "../../shared/views";
import { toggleTheme, useDark } from "../theme";
import type { RepoCount, StatusInfo } from "./model";

const ICONS: Record<View, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  needs: Bell,
  reviewing: Eye,
  mine: GitPullRequest,
  following: Star,
};

const DOT: Record<StatusInfo["tone"], string> = {
  ok: "bg-ok",
  busy: "bg-primary animate-pulse",
  warn: "bg-warn",
  error: "bg-destructive",
  idle: "bg-muted-foreground",
};

const item =
  "relative flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2 py-1.5 text-left hover:bg-hover rl-center";
const active = "bg-pane font-semibold shadow-[0_0_0_1px_var(--border)] hover:bg-pane";

// Rail label: the initials of the repository slug, plus a trailing number, so sample-repo-2 gives SR2.
const abbr = (repo: string) => {
  const words = (repo.split("/")[1] ?? repo).split(/[-_.]/).filter(Boolean);
  const num = words.at(-1)?.match(/^\d+$/) ? words.pop() : "";
  return `${words
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()}${num}`;
};

export function Sidebar(props: {
  view: View | null;
  counts: Record<View, number>;
  repos: RepoCount[];
  repo: string | null;
  status: StatusInfo | null;
  checking: boolean;
  onView: (v: View) => void;
  onRepo: (r: string | null) => void;
  onCheck: () => void;
  onSettings: () => void;
  settingsOpen: boolean;
}) {
  const [reposOpen, setReposOpen] = useState(true);
  return (
    <nav aria-label="Views" className="rl-pane rl-side flex flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="rl-center flex items-center gap-2.5 px-4 pt-4 pb-2.5 text-[15px] font-bold tracking-tight">
        <span aria-hidden className="size-3.5 shrink-0 -rotate-45 rounded-full border-2 border-primary border-r-transparent" />
        <span className="rl-lbl">Review Loop</span>
      </div>
      <div className="flex flex-1 flex-col gap-3.5 overflow-auto px-2 pt-1.5 pb-3">
        <div className="grid gap-px">
          <div className="rl-lbl px-2 py-1 text-[11.5px] font-semibold text-muted-foreground">Inbox</div>
          {(Object.keys(VIEW_LABEL) as View[]).map((v) => {
            const Icon = ICONS[v];
            const n = props.counts[v];
            const on = props.view === v;
            return (
              <button
                key={v}
                type="button"
                id={`nav-${v}`}
                className={cn(item, on && active, n > 0 && "rl-has-count")}
                aria-current={on ? "page" : undefined}
                title={`${VIEW_LABEL[v]}${n ? `: ${n}` : ""}`}
                onClick={() => props.onView(v)}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                <span className="rl-lbl truncate">{VIEW_LABEL[v]}</span>
                <span className="rl-lbl ml-auto text-xs font-medium text-muted-foreground">{n || ""}</span>
              </button>
            );
          })}
        </div>
        <div className="grid gap-px">
          <button type="button" className={item} aria-expanded={reposOpen} onClick={() => setReposOpen(!reposOpen)} title="Repositories">
            <Folder aria-hidden className="size-4 shrink-0" />
            <span className="rl-lbl truncate">Repositories</span>
            <ChevronDown aria-hidden className={cn("rl-lbl ml-auto size-4 transition-transform", !reposOpen && "-rotate-90")} />
          </button>
          {reposOpen &&
            props.repos.map((r) => {
              const on = props.repo === r.repo;
              return (
                <button
                  key={r.repo}
                  type="button"
                  className={cn(item, on && active, r.unread > 0 && "rl-has-count")}
                  aria-pressed={on}
                  title={`Show only ${r.repo}${r.unread ? `: ${r.unread} unread` : ""}`}
                  onClick={() => props.onRepo(on ? null : r.repo)}
                >
                  <span className="rl-abbr w-[22px] text-center font-mono text-[11px] font-bold">{abbr(r.repo)}</span>
                  <span className="rl-lbl truncate font-mono text-[11.5px]">{r.repo}</span>
                  <span className={cn("rl-lbl ml-auto text-xs", r.unread ? "font-bold text-primary" : "text-muted-foreground")}>
                    {r.unread ? (
                      <>
                        {r.unread}
                        <span className="sr-only"> unread</span>
                      </>
                    ) : (
                      ""
                    )}
                  </span>
                </button>
              );
            })}
        </div>
      </div>
      <div className="rl-stack flex flex-wrap items-center gap-1.5 border-t px-3 py-2.5">
        {props.status && <SyncLine status={props.status} />}
        <button
          type="button"
          className="rl-check rl-center mr-auto inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-md border bg-card px-2.5 text-[12.5px] hover:border-muted-foreground disabled:cursor-default disabled:opacity-60"
          onClick={props.onCheck}
          disabled={props.checking}
          title="Check Bitbucket now"
          aria-label={props.checking ? "Checking now" : "Check now"}
        >
          <RefreshCw aria-hidden className={cn("size-3.5", props.checking && "animate-spin")} />
          <span className="rl-lbl">Check now</span>
        </button>
        <ThemeButton />
        <IconButton label="Settings" onClick={props.onSettings} pressed={props.settingsOpen}>
          <Settings aria-hidden className="size-4" />
        </IconButton>
      </div>
    </nav>
  );
}

function SyncLine({ status }: { status: StatusInfo }) {
  return (
    <div
      className="rl-center flex min-w-0 basis-full items-center gap-1.5 px-0.5 pb-1 text-[11.5px] text-muted-foreground"
      title={status.text}
    >
      <span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", DOT[status.tone])} />
      <span className="rl-lbl">{status.text}</span>
    </div>
  );
}

function IconButton(props: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="inline-grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-60"
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.pressed}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

function ThemeButton() {
  const dark = useDark();
  const label = dark ? "Use light theme" : "Use dark theme";
  return (
    <IconButton label={label} onClick={toggleTheme}>
      {dark ? <Sun aria-hidden className="size-4" /> : <Moon aria-hidden className="size-4" />}
    </IconButton>
  );
}

// The offline text counts down to the next try.
export function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}
