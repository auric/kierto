// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The "Thread history" section under the thread footer (docs/plans/thread-outcome.md section 10), in the prototype timeline style:
// a left rule, one dot per line, a muted head with a bold actor. The query key sits under ["pr", pr], so a live change refreshes it.
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, ScrollText } from "lucide-react";
import { Fragment, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ThreadHistoryDto } from "../../shared/dto";
import { api } from "../api";
import { wordDiff } from "../lib/textdiff";
import { useMeta } from "../meta";
import { read } from "../shell/data";
import { HintTrigger } from "../shell/Hint";
import { ago } from "../shell/model";
import { HISTORY_NOTE, type HistoryLine, historyLines } from "./history";
import { fullTime, type ThreadCtx } from "./Thread";
import type { ThreadModel } from "./threads";

const linkish = "inline-flex cursor-pointer items-center gap-1 rounded text-xs font-medium text-pen hover:underline";

const useThreadHistory = (pr: number, thread: number) =>
  useQuery({
    queryKey: ["pr", pr, "history", thread],
    queryFn: async () =>
      read<ThreadHistoryDto>(
        await api.api.prs[":id"].threads[":thread"].history.$get({ param: { id: String(pr), thread: String(thread) } }),
      ),
  });

// The heading takes the focus when the section opens. onClose: Hide history and Esc inside the section. The footer then focuses More.
export function ThreadHistory({ t, ctx, onClose }: { t: ThreadModel; ctx: ThreadCtx; onClose: () => void }) {
  const id = `hist-${t.id}`;
  const q = useThreadHistory(ctx.pr, t.id);
  const ai = useMeta().data?.runner.short ?? ctx.runner;
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    head.current?.focus({ preventScroll: true });
    head.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const lines = useMemo(() => (q.data ? historyLines(q.data, t, { ai, forge: ctx.forge }) : null), [q.data, t, ai, ctx.forge]);
  // As the reply box: Esc closes only this section. The shell key handler never sees it.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };
  return (
    <section id={id} aria-labelledby={`${id}-h`} data-history onKeyDown={onKeyDown} className="rl-fade mt-4 max-w-[72ch]">
      <div className="flex items-center gap-2">
        {/* ThreadList.tsx: the turn groups are h3. */}
        <h4 id={`${id}-h`} ref={head} tabIndex={-1} className="m-0 text-sm font-semibold">
          Thread history
        </h4>
        <Button size="sm" variant="ghost" className="ml-auto text-ink-2" onClick={onClose}>
          Hide history
        </Button>
      </div>
      {lines ? (
        <ol className="m-0 mt-2 list-none border-l border-border p-0">
          {lines.map((l) => (
            <Line key={l.key} l={l} id={`${id}-${l.key}`} ctx={ctx} />
          ))}
        </ol>
      ) : q.error ? (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-destructive">
          <CircleAlert aria-hidden className="size-[15px] shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">Cannot load the history. {q.error.message}</span>
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <div role="status" aria-busy="true" aria-label="Loading the history" className="mt-2 grid gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
      <p className="m-0 mt-1 text-xs text-muted-foreground">{HISTORY_NOTE(ctx.forge)}</p>
    </section>
  );
}

function Line({ l, id, ctx }: { l: HistoryLine; id: string; ctx: ThreadCtx }) {
  const [shown, setShown] = useState(false);
  return (
    <li
      data-history-line={l.key}
      className={cn(
        "relative pb-3 pl-[18px] before:absolute before:top-[7px] before:-left-1 before:size-[7px] before:rounded-full",
        l.error ? "before:bg-destructive" : "before:bg-rule-strong",
      )}
    >
      <p id={id} className="m-0 text-[13px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
        {l.actor && <b className="font-semibold text-foreground">{l.actor} </b>}
        {l.text}
        {l.tags.map((tag) => (
          <Badge key={tag} variant="quiet" className="ml-1.5 align-[1px]">
            {tag}
          </Badge>
        ))}
        <span aria-hidden="true"> · </span>
        {l.exact && l.at !== null ? (
          <HintTrigger hints={ctx.hints} label={fullTime(l.at)}>
            <time dateTime={new Date(l.at).toISOString()}>{ago(l.at, ctx.now)}</time>
          </HintTrigger>
        ) : (
          <span className="italic">time not kept</span>
        )}
      </p>
      {l.detail && (
        <p className={cn("m-0 mt-0.5 text-xs [overflow-wrap:anywhere]", l.error ? "text-destructive" : "text-ink-2")}>{l.detail}</p>
      )}
      {(l.diff || l.run !== undefined) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {l.diff && (
            <button
              type="button"
              className={linkish}
              aria-expanded={shown}
              aria-controls={`${id}-diff`}
              aria-describedby={id}
              onClick={() => setShown((s) => !s)}
            >
              {shown ? "Hide changes" : "Show changes"}
            </button>
          )}
          {l.run !== undefined && (
            <button type="button" className={linkish} aria-describedby={id} onClick={() => ctx.onLog(l.run as number)}>
              <ScrollText aria-hidden className="size-[13px] shrink-0" />
              Run log
            </button>
          )}
        </div>
      )}
      {l.diff && shown && <Changes id={`${id}-diff`} before={l.diff.before} after={l.diff.after} />}
    </li>
  );
}

// The word diff of your edit, as the revision card shows it: struck text leaves, underlined text comes in. Never color alone.
function Changes({ id, before, after }: { id: string; before: string; after: string }) {
  return (
    <div id={id} className="rl-fade mt-1.5 rounded-md border bg-pane px-2.5 py-1.5">
      <p className="m-0 text-[13px] whitespace-pre-wrap [overflow-wrap:anywhere]">
        {wordDiff(before, after).map((d, k) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts have no ID, and the list never reorders.
          <Fragment key={k}>
            {d.kind === "same" ? (
              d.text
            ) : (
              <>
                <span className="sr-only">{d.kind === "del" ? "[removed: " : "[added: "}</span>
                {d.kind === "del" ? (
                  <del className="rounded-[3px] bg-(--del) box-decoration-clone px-0.5 text-ink-2 decoration-1">{d.text}</del>
                ) : (
                  <ins className="rounded-[3px] bg-(--add) box-decoration-clone px-0.5 underline decoration-1 underline-offset-2">
                    {d.text}
                  </ins>
                )}
                <span className="sr-only">]</span>
              </>
            )}
          </Fragment>
        ))}
      </p>
      <p className="m-0 mt-1 text-xs text-muted-foreground">Struck text left the draft. Underlined text came in with your edit.</p>
    </div>
  );
}
