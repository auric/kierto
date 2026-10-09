import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster, toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { VIEWS, type View } from "../shared/views";
import { type Effect, type KeyState, reduceKey } from "./keys";
import { useLive } from "./live";
import { useClaims } from "./notify";
import { jumpTo, PrDetail } from "./pr/PrDetail";
import { Settings } from "./settings/Settings";
import {
  claimEvents,
  isStale,
  isStopped,
  retry,
  type Status,
  useCheckNow,
  useFollowUrl,
  usePrs,
  useSettings,
  useStatus,
} from "./shell/data";
import { HelpSheet } from "./shell/HelpSheet";
import { ListPane } from "./shell/ListPane";
import { filterRows, followCandidate, incompleteText, repoCounts, statusInfo, unreadTotal, viewCounts } from "./shell/model";
import { Sidebar, useNow } from "./shell/Sidebar";

export function App() {
  const [stale, setStale] = useState(false);
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // A stopped server shows its state at once. The live channel refetches after it reconnects.
          queries: { retry },
        },
        mutationCache: new MutationCache({ onError: (e) => isStale(e) && setStale(true) }),
      }),
  );
  useLive(qc);
  return (
    <QueryClientProvider client={qc}>
      <Toaster>
        <Shell stale={stale} />
      </Toaster>
    </QueryClientProvider>
  );
}

const INITIAL: KeyState = { focus: "list", mobile: "list", selected: null, help: false, settings: false };

function Shell({ stale }: { stale: boolean }) {
  const prs = usePrs();
  const status = useStatus();
  const settings = useSettings();
  const checkNow = useCheckNow();
  const follow = useFollowUrl();
  const [view, setView] = useState<View>("needs");
  const [repo, setRepo] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [ks, setKs] = useState<KeyState>(INITIAL);
  const filterRef = useRef<HTMLInputElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const pending = useRef<Effect>(null);

  const s = settings.data;
  const locked = s ? s.baseUrl === null || (s.tokenStorage === "memory" && !s.tokenStored) : false;
  const showSettings = locked || ks.settings;
  const all = prs.data ?? [];
  const rows = filterRows(all, view, repo, query);
  const selected = rows.some((p) => p.id === ks.selected) ? ks.selected : (rows[0]?.id ?? null);
  const current = rows.find((p) => p.id === selected) ?? null;
  const candidate = followCandidate(query, s?.baseUrl ?? null);
  const unread = unreadTotal(all);
  const sync = status.data?.sync;
  const now = useNow(sync?.state === "offline");
  const info = sync ? statusInfo(sync, now) : null;
  const state: KeyState = { ...ks, selected };
  const mobile = showSettings && locked ? "detail" : ks.mobile;

  // A notification click opens its PR in a view that holds it. A digest opens Needs you.
  useClaims(claimEvents, !!s?.baseUrl, !!s?.notifications, (id) => {
    const pr = id === null ? undefined : all.find((p) => p.id === id);
    const v = pr ? ((Object.keys(VIEWS) as View[]).find((x) => VIEWS[x](pr)) ?? "following") : "needs";
    setView(v);
    setRepo(null);
    setQuery("");
    if (pr) go({ selected: pr.id, settings: locked, focus: "detail", mobile: "detail" }, "focus-detail");
    else go({ settings: locked, focus: "list", mobile: "list" }, "focus-list");
  });

  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) Review Loop` : "Review Loop";
  }, [unread]);

  // Runs the focus effect of the last key after the new state renders.
  useLayoutEffect(() => {
    const effect = pending.current;
    pending.current = null;
    if (effect === "focus-filter") filterRef.current?.focus();
    else if (effect === "focus-list") {
      const row = selected === null ? null : document.getElementById(`row-${selected}`);
      (row ?? document.getElementById("rows"))?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: "nearest" });
    } else if (effect === "focus-detail") detailRef.current?.focus({ preventScroll: true });
    else if (effect === "scroll-down" || effect === "scroll-up") {
      detailRef.current?.querySelector("[data-scroll]")?.scrollBy({ top: effect === "scroll-down" ? 80 : -80 });
    } else if (effect === "next-new") {
      const marks = [...(detailRef.current?.querySelectorAll<HTMLElement>("[data-new]") ?? [])];
      const at = document.activeElement;
      const next = marks.find(
        (el) => at instanceof Node && at !== el && !!(at.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
      );
      if (next) jumpTo(next);
      else {
        detailRef.current?.focus({ preventScroll: true });
        toast.add({ title: "No unread message left." });
      }
    } else if (effect === "tab-1") document.getElementById("tab-activity")?.focus();
    else if (effect === "tab-2" || effect === "tab-3") toast.add({ title: `${effect === "tab-2" ? "Review" : "Run log"} arrives in M2.` });
  });

  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    const onButton = (t.tagName === "BUTTON" && !t.hasAttribute("data-row")) || t.tagName === "A";
    const r = reduceKey(state, e.key, { ids: rows.map((p) => p.id), typing, onButton, settingsLocked: locked });
    if (!r.handled) return;
    e.preventDefault();
    if (e.key === "Escape" && typing) t.blur();
    pending.current = r.effect;
    setKs(r.state);
  };
  useEffect(() => {
    const fn = (e: KeyboardEvent) => onKey.current(e);
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, []);

  const go = (patch: Partial<KeyState>, effect: Effect = null) => {
    pending.current = effect;
    setKs((k) => ({ ...k, ...patch }));
  };

  if (isStopped(prs.error) || isStopped(status.error) || isStopped(settings.error)) return <Stopped />;

  return (
    <div className="rl-app" data-m={mobile}>
      <a
        href="#rows"
        className="sr-only rounded-md bg-pane text-primary focus:not-sr-only focus:fixed focus:px-3 focus:py-1.5 focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to the list
      </a>
      <Sidebar
        view={showSettings ? null : view}
        counts={viewCounts(all)}
        repos={repoCounts(all)}
        repo={repo}
        status={info}
        checking={checkNow.isPending || !!sync?.running}
        onView={(v) => {
          setView(v);
          go({ mobile: "list", settings: locked, focus: "list" });
        }}
        onRepo={(r) => {
          setRepo(r);
          go({ mobile: "list", settings: locked, focus: "list" });
        }}
        onCheck={() => checkNow.mutate()}
        onSettings={() => go({ settings: !ks.settings || locked, mobile: "detail", focus: "detail" })}
        settingsOpen={showSettings}
      />
      <ListPane
        view={view}
        rows={rows}
        loading={prs.isPending}
        repo={repo}
        query={query}
        selected={showSettings ? null : selected}
        focused={ks.focus === "list" && !showSettings}
        candidate={candidate}
        following={follow.isPending}
        followError={follow.error && !isStale(follow.error) ? follow.error.message : null}
        banner={<Banner stale={stale} status={status.data} now={now} onSettings={() => go({ settings: true, mobile: "detail" })} />}
        filterRef={filterRef}
        onQuery={(q) => {
          setQuery(q);
          if (follow.error) follow.reset();
        }}
        onRepo={setRepo}
        onSelect={(id) =>
          go({ selected: id, settings: locked, focus: "list", mobile: matchMedia("(max-width: 759px)").matches ? "detail" : ks.mobile })
        }
        onOpen={(id) => go({ selected: id, settings: locked, focus: "detail", mobile: "detail" }, "focus-detail")}
        onFollow={() =>
          follow.mutate(query.trim(), {
            onSuccess: () => {
              setQuery("");
              setView("following");
            },
          })
        }
        onMenu={() => go({ mobile: "side" })}
        onFocus={() => ks.focus !== "list" && setKs((k) => ({ ...k, focus: "list" }))}
      />
      <section
        ref={detailRef}
        tabIndex={-1}
        aria-label="Details"
        className={cn("rl-pane rl-detail flex flex-col bg-pane outline-none", ks.focus === "detail" && "pane-edge")}
        onFocus={() => ks.focus !== "detail" && setKs((k) => ({ ...k, focus: "detail" }))}
      >
        {showSettings && s ? (
          <Settings
            settings={s}
            required={locked}
            onBack={() => go({ settings: false, mobile: "list", focus: "list" }, "focus-list")}
            onSaved={() => go({ settings: false, mobile: "list" })}
          />
        ) : prs.isPending || settings.isPending ? (
          <DetailSkeleton />
        ) : current ? (
          <>
            <BackBar onBack={() => go({ mobile: "list", focus: "list" }, "focus-list")} />
            <div data-scroll className="flex-1 overflow-auto overscroll-contain">
              <PrDetail
                key={current.id}
                pr={current}
                me={s?.user ?? null}
                onLeave={() => {
                  const i = rows.indexOf(current);
                  setKs((k) => ({ ...k, selected: (rows[i + 1] ?? rows[i - 1])?.id ?? null }));
                }}
              />
            </div>
          </>
        ) : (
          <>
            <BackBar onBack={() => go({ mobile: "list", focus: "list" }, "focus-list")} />
            <div className="mx-auto my-10 grid max-w-[52ch] gap-3 px-6 text-muted-foreground">
              <p className="m-0">
                {all.length ? "Select a pull request in the list." : "Pull requests appear here after the first check."}
              </p>
            </div>
          </>
        )}
      </section>
      <HelpSheet open={ks.help} onOpenChange={(help) => setKs((k) => ({ ...k, help }))} />
    </div>
  );
}

function BackBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="rl-m-only border-b px-3 py-1.5">
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground hover:bg-hover hover:text-foreground"
        onClick={onBack}
      >
        <ArrowLeft aria-hidden className="size-4" />
        Back to the list
      </button>
    </div>
  );
}

function Banner({ stale, status, now, onSettings }: { stale: boolean; status: Status | undefined; now: number; onSettings: () => void }) {
  const box = "m-3 mb-0 w-auto";
  if (stale) {
    return (
      <Alert className={box}>
        <AlertTitle>The service restarted. Reload the page.</AlertTitle>
        <AlertAction>
          <Button size="sm" onClick={() => location.reload()}>
            Reload
          </Button>
        </AlertAction>
      </Alert>
    );
  }
  const sync = status?.sync;
  if (sync?.state === "auth") {
    return (
      <Alert variant="destructive" className={box}>
        <AlertTitle>Bitbucket rejected the token</AlertTitle>
        <AlertDescription>Checks are paused until you save a new token.</AlertDescription>
        <AlertAction>
          <Button size="sm" variant="outline" onClick={onSettings}>
            Open settings
          </Button>
        </AlertAction>
      </Alert>
    );
  }
  if (sync?.state === "offline") {
    return (
      <Alert className={box}>
        <AlertTitle>{statusInfo(sync, now).text}</AlertTitle>
        <AlertDescription>The list shows the data from the last check.</AlertDescription>
      </Alert>
    );
  }
  if (sync?.state === "error" && sync.error) {
    return (
      <Alert variant="destructive" className={box}>
        <AlertTitle>The last check failed</AlertTitle>
        <AlertDescription>{sync.error}</AlertDescription>
      </Alert>
    );
  }
  const dash = incompleteText(status?.dashboard ?? null);
  if (dash) {
    return (
      <Alert className={box}>
        <AlertTitle>The dashboard list is incomplete</AlertTitle>
        <AlertDescription>{dash}. The list can miss pull requests until the next check.</AlertDescription>
      </Alert>
    );
  }
  return null;
}

function DetailSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading details" className="grid gap-3 px-6 pt-5">
      <Skeleton className="h-5 w-3/5" />
      <Skeleton className="h-3 w-2/5" />
      <Skeleton className="mt-4 h-20 w-full max-w-[760px]" />
      <Skeleton className="h-20 w-full max-w-[760px]" />
    </div>
  );
}

function Stopped() {
  return (
    <main className="grid h-full place-items-center bg-background p-6">
      <div className="grid max-w-[52ch] gap-3">
        <h1 className="m-0 text-[19px] font-bold tracking-tight">Review Loop is not running</h1>
        <p className="m-0 text-muted-foreground">The local service does not answer. Start it again in a terminal:</p>
        <pre className="m-0 rounded-md border bg-card px-3 py-2 font-mono text-[12px]">bun run start</pre>
        <p className="m-0 text-muted-foreground">This page reconnects by itself when the service is back.</p>
      </div>
    </main>
  );
}
