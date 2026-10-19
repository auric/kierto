// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The confirm step (prototype/v3 postBar confirm): the destination and the exact text of each comment. Nothing posts without it.
import { CircleAlert, CircleCheck, LoaderCircle, Send } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Text } from "../pr/Thread";

// resolve: the resolve step of the post, as words. null: none.
export type ConfirmEntry = { key: string; code: string | null; dest: string; body: string; warning: string | null; resolve: string | null };

// entries: null while the plan loads. error: the answer of the last post, shown in the dialog.
export function Confirm(props: {
  id: string;
  title: string;
  note: ReactNode;
  entries: ConfirmEntry[] | null;
  posting: boolean;
  error: string | null;
  // canPost: false keeps Post off, for example while the plan loads.
  canPost: boolean;
  onPost: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const post = useRef<HTMLButtonElement>(null);
  const ready = props.entries !== null;
  // prototype/v3 openConfirm: focus goes to Post once the list shows. Posting removes the button, so a post that ends
  // with the dialog still open (an error, a new plan) puts the focus back on it.
  useLayoutEffect(() => {
    if (ready && !props.posting) post.current?.focus({ preventScroll: true });
  }, [ready, props.posting]);
  return (
    <section
      id={props.id}
      role="dialog"
      aria-labelledby={`${props.id}-t`}
      aria-describedby={`${props.id}-n`}
      className={cn("flex min-h-0 flex-col gap-2", props.className)}
    >
      <h2 id={`${props.id}-t`} className="m-0 text-[15px] font-bold [overflow-wrap:anywhere]">
        {props.title}
      </h2>
      <p id={`${props.id}-n`} className="m-0 text-sm text-ink-2">
        {props.note}
      </p>
      {props.entries ? (
        <ol aria-label="Comments to post" className="m-0 min-h-0 flex-[0_1_auto] list-none overflow-auto border-t p-0">
          {props.entries.map((e) => (
            <li
              key={e.key}
              className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-0.5 border-b py-2 @min-[560px]/detail:grid-cols-[24ch_minmax(0,1fr)]"
            >
              <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {e.code && (
                  <>
                    <code translate="no" className="font-mono text-foreground">
                      {e.code}
                    </code>
                    <br />
                  </>
                )}
                {e.dest}
              </span>
              <div className="max-w-[72ch] text-sm [overflow-wrap:anywhere]">
                {e.body && <Text text={e.body} />}
                {e.resolve && (
                  <p data-resolve className="m-0 mt-1 flex items-center gap-1.5 text-xs font-medium text-ink-2">
                    <CircleCheck aria-hidden className="size-[13px] shrink-0" />
                    {e.resolve}
                  </p>
                )}
              </div>
              {e.warning && (
                <p className="m-0 text-xs text-ink-2 @min-[560px]/detail:col-start-2">
                  <CircleAlert aria-hidden className="mr-1 inline size-[13px] align-[-2px]" />
                  {e.warning}
                </p>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div role="status" aria-busy="true" aria-label="Loading the comments" className="grid gap-2 border-t pt-2">
          <Skeleton className="h-10 w-full" />
        </div>
      )}
      {props.error && (
        <p role="alert" className="m-0 flex items-start gap-1.5 text-sm text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-[15px] shrink-0" />
          {props.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {props.posting ? (
          <span role="status" className="inline-flex items-center gap-1.5 text-sm text-ink-2">
            <LoaderCircle aria-hidden className="size-[15px] animate-spin motion-reduce:animate-none" />
            Posting…
          </span>
        ) : (
          <>
            <Button ref={post} size="sm" disabled={!props.canPost} onClick={props.onPost}>
              <Send aria-hidden data-icon="inline-start" />
              Post
            </Button>
            <Button size="sm" variant="outline" title="Key: Esc" onClick={props.onCancel}>
              Cancel
            </Button>
            <span className="ml-1 text-xs text-muted-foreground">Esc cancels.</span>
          </>
        )}
      </div>
    </section>
  );
}
