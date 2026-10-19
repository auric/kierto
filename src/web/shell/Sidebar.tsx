// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Sidebar (prototype/v3 renderSide): inbox views, Archive, the AI review view, repositories, check status, theme, density, and settings.
import {
  Archive,
  Bell,
  Circle,
  CircleAlert,
  CircleCheck,
  CloudOff,
  Eye,
  GitPullRequest,
  LoaderCircle,
  type LucideIcon,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Rows3,
  Rows4,
  Send,
  Settings2,
  Star,
  Sun,
  Terminal,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { VIEW_LABEL, type View } from "../../shared/views";
import { cycleTheme, NEXT_THEME, type Theme, toggleDensity, useCompact, useTheme } from "../theme";
import { Hint } from "./Hint";
import type { ProjectRepos, StatusInfo } from "./model";

const ICONS: Record<View, LucideIcon> = { needs: Bell, reviewing: Eye, mine: GitPullRequest, following: Star };

const STATUS_ICON: Record<StatusInfo["tone"], { icon: LucideIcon; className?: string }> = {
  ok: { icon: CircleCheck },
  busy: { icon: LoaderCircle, className: "animate-spin" },
  warn: { icon: CloudOff },
  error: { icon: CircleAlert, className: "text-destructive" },
  idle: { icon: Circle },
};

const THEME_ICON: Record<Theme, LucideIcon> = { system: Monitor, light: Sun, dark: Moon };

// The count on the rail. The button name holds the count, so a screen reader skips the badge.
const Badge = ({ n }: { n: number }) =>
  n > 0 ? (
    <span aria-hidden className="rl-badge">
      {n > 99 ? "99+" : n}
    </span>
  ) : null;

const navItem =
  "rl-center rl-nav relative flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2 py-[5px] text-left text-ink-2 hover:bg-hover hover:text-foreground";
const current = "bg-pane font-semibold text-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:bg-pane";
const heading = "rl-lbl m-0 px-2 py-1 text-xs font-semibold text-muted-foreground";

export function Sidebar(props: {
  // null: a repository or the settings take the list or the detail. "runs" and "post": the AI review views.
  view: View | "runs" | "post" | "archive" | null;
  counts: Record<View, number>;
  // The PRs with a review run, and whether a review runs now.
  runs: { count: number; running: boolean };
  // The PRs with accepted items (prototype/v3 AIVIEWS.post).
  post: number;
  repos: ProjectRepos[];
  repo: string | null;
  status: StatusInfo | null;
  checking: boolean;
  onView: (v: View | "runs" | "post" | "archive") => void;
  onRepo: (r: string | null) => void;
  onCheck: () => void;
  onSettings: () => void;
  settingsOpen: boolean;
  // The rail hides the words, so only then the tooltips show them. onRail: collapse to the rail or expand (plan pr-view-v4 4.3).
  rail: boolean;
  onRail: () => void;
}) {
  const { rail } = props;
  return (
    <nav
      aria-label="Views"
      className="rl-pane rl-side grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] border-r bg-sidebar text-sidebar-foreground"
    >
      <div className="rl-center flex items-center gap-[9px] px-4 pt-4 pb-2.5 text-[15px] font-bold tracking-[-0.01em]">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          className="size-[18px]"
        >
          <path d="M20 12a8 8 0 1 1-3.2-6.4" />
          <path d="M20 4v5h-5" />
        </svg>
        <span className="rl-lbl">Kierto</span>
      </div>
      <div className="relative grid grid-cols-[minmax(0,1fr)] content-start gap-3.5 overflow-auto px-2 pt-1 pb-3">
        <div className="grid gap-px">
          <h2 className={heading}>Inbox</h2>
          {(Object.keys(VIEW_LABEL) as View[]).map((v) => {
            const Icon = ICONS[v];
            const n = props.counts[v];
            const label = `${VIEW_LABEL[v]}: ${n}`;
            return (
              <Hint key={v} label={label} disabled={!rail} side="right">
                <button
                  type="button"
                  id={`nav-${v}`}
                  className={cn(navItem, props.view === v && current)}
                  aria-current={props.view === v ? "page" : undefined}
                  aria-label={label}
                  onClick={() => props.onView(v)}
                >
                  <Icon aria-hidden className="size-[15px] shrink-0" />
                  <span className="rl-lbl truncate">{VIEW_LABEL[v]}</span>
                  <span className="rl-lbl ml-auto text-xs font-medium text-muted-foreground">{n || ""}</span>
                  <Badge n={n} />
                </button>
              </Hint>
            );
          })}
          {/* No count: the archive only grows, and nothing in it waits on the user. */}
          <Hint label="Archive" disabled={!rail} side="right">
            <button
              type="button"
              id="nav-archive"
              className={cn(navItem, "mt-1", props.view === "archive" && current)}
              aria-current={props.view === "archive" ? "page" : undefined}
              aria-label="Archive"
              onClick={() => props.onView("archive")}
            >
              <Archive aria-hidden className="size-[15px] shrink-0" />
              <span className="rl-lbl truncate">Archive</span>
            </button>
          </Hint>
        </div>
        <div className="grid gap-px">
          <h2 className={heading}>AI review</h2>
          <RunsItem {...props.runs} rail={rail} current={props.view === "runs"} onClick={() => props.onView("runs")} />
          <Hint label={`Ready to post: ${props.post}`} disabled={!rail} side="right">
            <button
              type="button"
              id="nav-post"
              className={cn(navItem, props.view === "post" && current)}
              aria-current={props.view === "post" ? "page" : undefined}
              aria-label={`Ready to post: ${props.post}`}
              onClick={() => props.onView("post")}
            >
              <Send aria-hidden className="size-[15px] shrink-0" />
              <span className="rl-lbl truncate">Ready to post</span>
              <span className="rl-lbl ml-auto text-xs font-medium text-muted-foreground">{props.post || ""}</span>
              <Badge n={props.post} />
            </button>
          </Hint>
        </div>
        {props.repos.length > 0 && (
          <div className="rl-repos grid gap-px">
            <h2 className={heading}>Repositories</h2>
            {props.repos.map((g) => (
              <Fragment key={g.project}>
                <div translate="no" title={g.project} className="truncate px-2 pt-1.5 pb-0.5 text-xs font-semibold text-muted-foreground">
                  {g.project}
                </div>
                {g.repos.map((r) => {
                  const on = props.repo === r.key;
                  return (
                    <button
                      key={r.key}
                      type="button"
                      className={cn(
                        "rl-repo flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent py-1 pr-2 pl-[18px] text-left text-sm text-ink-2 hover:bg-hover",
                        on && "bg-sel font-semibold text-foreground hover:bg-sel",
                      )}
                      aria-pressed={on}
                      onClick={() => props.onRepo(on ? null : r.key)}
                    >
                      <span translate="no" title={r.repo} className="min-w-0 truncate">
                        {r.repo}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {r.unread > 0 && (
                          <>
                            {r.unread}
                            <span className="sr-only"> new</span>
                          </>
                        )}
                      </span>
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </div>
        )}
      </div>
      <div className="grid gap-2 border-t px-3 pt-2 pb-3 text-xs text-ink-2">
        <Hint label="Settings" disabled={!rail} side="right">
          <button
            type="button"
            id="nav-settings"
            className={cn(navItem, "-mx-1 w-auto text-base", props.settingsOpen && current)}
            aria-current={props.settingsOpen ? "page" : undefined}
            aria-label="Settings"
            onClick={props.onSettings}
          >
            <Settings2 aria-hidden className="size-[15px] shrink-0" />
            <span className="rl-lbl truncate">Settings</span>
          </button>
        </Hint>
        {props.status && <SyncLine status={props.status} rail={rail} />}
        <div className="rl-stack flex items-center gap-0.5">
          <Hint label={props.checking ? "Checking now" : "Check now"} disabled={!rail} side="right">
            <button
              type="button"
              className="rl-check mr-1.5 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border bg-pane px-2.5 text-sm font-medium whitespace-nowrap text-foreground hover:border-rule-strong disabled:cursor-default disabled:opacity-60"
              onClick={props.onCheck}
              disabled={props.checking}
              aria-label={props.checking ? "Checking now" : "Check now"}
            >
              <RefreshCw aria-hidden className={cn("size-[15px]", props.checking && "animate-spin")} />
              <span className="rl-lbl">Check now</span>
            </button>
          </Hint>
          <span className="rl-grow flex-1" />
          <ThemeButton rail={rail} />
          <DensityButton rail={rail} />
        </div>
        <RailButton rail={rail} onClick={props.onRail} />
      </div>
    </nav>
  );
}

// prototype/v3 navBtn for AIVIEWS.runs: a spinner replaces the icon while a review runs.
function RunsItem(props: { count: number; running: boolean; rail: boolean; current: boolean; onClick: () => void }) {
  const label = `Review runs: ${props.count}${props.running ? ", 1 running" : ""}`;
  const Icon = props.running ? LoaderCircle : Terminal;
  return (
    <Hint label={label} disabled={!props.rail} side="right">
      <button
        type="button"
        id="nav-runs"
        className={cn(navItem, props.current && current)}
        aria-current={props.current ? "page" : undefined}
        aria-label={label}
        onClick={props.onClick}
      >
        <Icon aria-hidden className={cn("size-[15px] shrink-0", props.running && "animate-spin")} />
        <span className="rl-lbl truncate">Review runs</span>
        <span className="rl-lbl ml-auto text-xs font-medium text-muted-foreground">{props.count || ""}</span>
        <Badge n={props.count} />
      </button>
    </Hint>
  );
}

// The one pane layout below 760 px has no rail, so the button hides there.
function RailButton({ rail, onClick }: { rail: boolean; onClick: () => void }) {
  const label = rail ? "Expand sidebar" : "Collapse sidebar";
  const Icon = rail ? PanelLeftOpen : PanelLeftClose;
  return (
    <Hint label={label} disabled={!rail} side="right">
      <button
        type="button"
        id="nav-rail"
        className={cn(navItem, "rl-wide-only -mx-1 w-auto text-base")}
        aria-label={label}
        onClick={onClick}
      >
        <Icon aria-hidden className="size-[15px] shrink-0" />
        <span className="rl-lbl truncate">{label}</span>
      </button>
    </Hint>
  );
}

function SyncLine({ status, rail }: { status: StatusInfo; rail: boolean }) {
  const { icon: Icon, className } = STATUS_ICON[status.tone];
  return (
    <div className="rl-center flex min-w-0 items-center gap-[7px]">
      <Hint label={status.text} disabled={!rail} side="right">
        <span className="inline-flex shrink-0 text-muted-foreground">
          <Icon aria-hidden className={cn("size-[15px]", className)} />
        </span>
      </Hint>
      <span className="rl-lbl-sr min-w-0 truncate">{status.text}</span>
    </div>
  );
}

function IconButton(props: { label: string; pressed?: boolean; onClick: () => void; side: "top" | "right"; children: ReactNode }) {
  return (
    <Hint label={props.label} side={props.side}>
      <button
        type="button"
        className="inline-grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-ink-2 hover:bg-hover hover:text-foreground aria-pressed:text-foreground [&[aria-pressed=true]_svg]:fill-current"
        aria-label={props.label}
        aria-pressed={props.pressed}
        onClick={props.onClick}
      >
        {props.children}
      </button>
    </Hint>
  );
}

function ThemeButton({ rail }: { rail: boolean }) {
  const theme = useTheme();
  const Icon = THEME_ICON[theme];
  return (
    <IconButton label={`Theme: ${theme}. Switch to ${NEXT_THEME[theme]}.`} onClick={cycleTheme} side={rail ? "right" : "top"}>
      <Icon aria-hidden className="size-[15px]" />
    </IconButton>
  );
}

function DensityButton({ rail }: { rail: boolean }) {
  const compact = useCompact();
  const Icon = compact ? Rows4 : Rows3;
  return (
    <IconButton label="Compact rows" pressed={compact} onClick={toggleDensity} side={rail ? "right" : "top"}>
      <Icon aria-hidden className="size-[15px]" />
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
