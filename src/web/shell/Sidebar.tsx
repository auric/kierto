// Sidebar (prototype/v3 renderSide): inbox views, repositories, check status, theme, density, and settings.
import {
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
  RefreshCw,
  Rows3,
  Rows4,
  Settings2,
  Star,
  Sun,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
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

// The rail layout (760 to 1099 px) hides the words, so only then the tooltips show them.
const railQuery = window.matchMedia("(min-width: 760px) and (max-width: 1099px)");
const onRail = (fn: () => void) => {
  railQuery.addEventListener("change", fn);
  return () => railQuery.removeEventListener("change", fn);
};
const useRail = () => useSyncExternalStore(onRail, () => railQuery.matches);

const navItem =
  "rl-center rl-nav flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2 py-[5px] text-left text-ink-2 hover:bg-hover hover:text-foreground";
const current = "bg-pane font-semibold text-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:bg-pane";
const heading = "rl-lbl m-0 px-2 py-1 text-xs font-semibold text-muted-foreground";

export function Sidebar(props: {
  // null: a repository or the settings take the list or the detail.
  view: View | null;
  counts: Record<View, number>;
  repos: ProjectRepos[];
  repo: string | null;
  status: StatusInfo | null;
  checking: boolean;
  onView: (v: View) => void;
  onRepo: (r: string | null) => void;
  onCheck: () => void;
  onSettings: () => void;
  settingsOpen: boolean;
}) {
  const rail = useRail();
  return (
    <nav
      aria-label="Views"
      className="rl-pane rl-side grid grid-rows-[auto_minmax(0,1fr)_auto] border-r bg-sidebar text-sidebar-foreground"
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
        <span className="rl-lbl">Review Loop</span>
      </div>
      <div className="relative grid content-start gap-3.5 overflow-auto px-2 pt-1 pb-3">
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
                </button>
              </Hint>
            );
          })}
        </div>
        {props.repos.length > 0 && (
          <div className="rl-repos grid gap-px">
            <h2 className={heading}>Repositories</h2>
            {props.repos.map((g) => (
              <Fragment key={g.project}>
                <div translate="no" className="truncate px-2 pt-1.5 pb-0.5 text-xs font-semibold text-muted-foreground">
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
                      <span translate="no" className="min-w-0 truncate">
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
      <div className="grid gap-2 border-t px-3 pt-2.5 pb-3 text-xs text-ink-2">
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
          <IconButton label="Settings" pressed={props.settingsOpen} onClick={props.onSettings} side={rail ? "right" : "top"}>
            <Settings2 aria-hidden className="size-[15px]" />
          </IconButton>
        </div>
      </div>
    </nav>
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
