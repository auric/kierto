// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The fix card under a thread (plan r3 UI-FIX): the run state with its log, the note of the run for the thread, each proposed edit
// with a checkbox and its diff rows, and the commit with Undo. Dashed: a proposal. Solid: a commit holds the edits.
import { Check, CircleAlert, Copy, GitCommitHorizontal, LoaderCircle, ScrollText, Undo2 } from "lucide-react";
import { memo, type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import type { FixCommitDto, FixEditDto, MetaDto } from "../../shared/dto";
import { Rows } from "../diff/FileDiff";
import { AiAvatar, Inline } from "../review/Drafts";
import { plural, RUN_TEXT } from "../review/model";
import { type Hints, HintTrigger } from "../shell/Hint";
import { cardKey, commitText, type FixState, type FixTarget, fetchCommands } from "./model";

export type FixCtx = {
  meta: MetaDto;
  hints: Hints;
  announce: (text: string) => void;
  onLog: (run: number) => void;
  onTick: (edit: number, on: boolean) => void;
  // target: the card to focus after the undo. null: the focus stays.
  onUndo: (c: FixCommitDto, target: FixTarget | null) => void;
};

const icon = "size-[15px] shrink-0";
const box = "rl-enter mt-3.5 max-w-[72ch] scroll-mt-3 rounded-lg border border-dashed border-rule-strong px-2.5 pt-2 pb-2.5";
const linkish = "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded text-sm font-medium text-pen hover:underline";

function Err({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-start gap-1.5 text-destructive">
      <CircleAlert aria-hidden className={cn(icon, "mt-0.5")} />
      <span>{children}</span>
    </span>
  );
}

function LogButton({ run, ctx }: { run: number; ctx: FixCtx }) {
  return (
    <button type="button" className={linkish} onClick={() => ctx.onLog(run)}>
      <ScrollText aria-hidden className={icon} />
      Log
    </button>
  );
}

// One command with its copy button. The check shows for 1.5 s.
export function CopyLine({ text, label, ctx }: { text: string; label: string; ctx: Pick<FixCtx, "hints" | "announce"> }) {
  const [copied, setCopied] = useState(0);
  useEffect(() => {
    if (!copied) return;
    const h = setTimeout(() => setCopied(0), 1500);
    return () => clearTimeout(h);
  }, [copied]);
  const copy = () =>
    copyText(text).then((ok) => {
      if (!ok) return toast.add({ title: "The clipboard is blocked here. Select the command and press Ctrl+C." });
      setCopied((n) => n + 1);
      ctx.announce("Copied");
    });
  const name = copied ? "Copied" : label;
  return (
    <div className="flex min-w-0 items-center gap-1 rounded-md bg-sunken py-0.5 pr-0.5 pl-2.5">
      <code translate="no" className="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-pre">
        {text}
      </code>
      <HintTrigger hints={ctx.hints} label={name}>
        <Button variant="ghost" size="icon-sm" aria-label={name} onClick={copy} className="text-muted-foreground hover:text-foreground">
          {copied ? <Check key={copied} aria-hidden className="rl-pop" /> : <Copy aria-hidden />}
        </Button>
      </HintTrigger>
    </div>
  );
}

// Cache mode: two commands bring the app commit into the clone with its hash.
export function FetchCommands({ fetch, ctx }: { fetch: NonNullable<FixCommitDto["fetch"]>; ctx: Pick<FixCtx, "hints" | "announce"> }) {
  const [one, two] = fetchCommands(fetch);
  return (
    <div className="grid gap-1">
      <CopyLine text={one as string} label="Copy the fetch command" ctx={ctx} />
      <CopyLine text={two as string} label="Copy the merge command" ctx={ctx} />
      <p className="m-0 text-xs text-muted-foreground">
        Use the fast-forward merge. A cherry-pick makes a new hash, and the “Fixed in” reply then cannot post.
      </p>
    </div>
  );
}

function Edit({ e, ticked, free, ctx }: { e: FixEditDto; ticked: boolean; free: boolean; ctx: FixCtx }) {
  const counts = (
    <span className="ml-auto shrink-0 pl-2 text-xs whitespace-nowrap text-muted-foreground">
      +{e.added} −{e.removed}
    </span>
  );
  const path = (
    <span translate="no" className="min-w-0 font-mono [overflow-wrap:anywhere]">
      {e.path}
    </span>
  );
  return (
    <section data-edit={e.id} className="rl-indent mt-2 overflow-hidden rounded-md bg-sunken">
      {free ? (
        <label className="flex cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-0.5 border-b px-2.5 py-1.5 text-sm hover:bg-hover">
          <input
            type="checkbox"
            className="m-0 shrink-0 accent-foreground"
            checked={ticked}
            onChange={(ev) => ctx.onTick(e.id, ev.target.checked)}
          />
          <span className="shrink-0 font-medium whitespace-nowrap">Include in apply</span> {path} {counts}
        </label>
      ) : (
        <p className="m-0 flex items-center gap-2 border-b px-2.5 py-1.5 text-sm">
          <GitCommitHorizontal aria-hidden className={cn(icon, "text-muted-foreground")} />
          <span className="sr-only">Committed edit to </span>
          {path}
          {counts}
        </p>
      )}
      <div className={cn(free && !ticked && "opacity-55")}>
        <Rows rows={e.rows} label={`Proposed change in ${e.path}`} />
      </div>
    </section>
  );
}

function Commit({ c, target, busy, ctx }: { c: FixCommitDto; target: FixTarget; busy: boolean; ctx: FixCtx }) {
  const staged = c.state === "staged";
  const text = commitText(c);
  return (
    <div id={`fxc-${cardKey(target)}`} tabIndex={-1} className="rl-indent mt-2.5 grid scroll-mt-3 gap-1.5 rounded">
      <p key={`${c.id}:${c.state}`} className="rl-fade m-0 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm">
        {staged ? (
          <Err>{text}</Err>
        ) : (
          <span className="inline-flex items-start gap-1.5 text-ink-2">
            <GitCommitHorizontal aria-hidden className={cn(icon, "mt-0.5")} />
            <span>{text}</span>
          </span>
        )}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => ctx.onUndo(c, target)}>
          {busy ? (
            <LoaderCircle aria-hidden data-icon="inline-start" className="animate-spin" />
          ) : (
            <Undo2 aria-hidden data-icon="inline-start" />
          )}
          Undo
        </Button>
      </p>
      {c.fetch && <FetchCommands fetch={c.fetch} ctx={ctx} />}
    </div>
  );
}

// target: the thread or the finding of the card. ticks: the checkbox state of each free edit. busy: an undo of the commit of this card is out.
export const FixCard = memo(function FixCard(props: {
  state: FixState;
  target: FixTarget;
  ticks: ReadonlyMap<number, boolean>;
  busy: boolean;
  ctx: FixCtx;
}) {
  const { state: s, target, ctx } = props;
  const key = cardKey(target);
  const short = ctx.meta.runner.short;
  // The running card answers Propose, often from a key, so it does not move. A card that a run result brings plays rl-enter.
  if (s.kind === "running") {
    return (
      <p data-fix={key} className="mt-3.5 mb-0 flex items-center gap-2 text-sm text-ink-2">
        <AiAvatar meta={ctx.meta} />
        <LoaderCircle aria-hidden className={cn(icon, "animate-spin")} />
        {short} is proposing a fix…
      </p>
    );
  }
  if (s.kind === "failed" || s.kind === "none") {
    const why =
      s.kind === "none" ? (
        <span className="text-ink-2">
          {short} proposed no fix for this {target.kind === "thread" ? "comment" : "finding"}.
        </span>
      ) : s.run.status === "cancelled" ? (
        <span className="text-ink-2">You cancelled {RUN_TEXT.fix.cancelled}.</span>
      ) : (
        <Err>
          {RUN_TEXT.fix.failed} {s.run.errorText ?? ""}
        </Err>
      );
    return (
      <p data-fix={key} className="rl-enter mt-3.5 mb-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <AiAvatar meta={ctx.meta} />
        {why}
        <LogButton run={s.run.id} ctx={ctx} />
      </p>
    );
  }
  const { fix, note, edits, commit, newest } = s;
  const held = new Set(fix.commits.filter((c) => c.state !== "undone").flatMap((c) => c.edits));
  const fixed = edits.length > 0;
  return (
    <article
      id={`fx-${key}`}
      data-fix={key}
      tabIndex={-1}
      aria-label={`Proposed fix from ${short}: ${plural(edits.length, "edit")}.${commit ? ` ${commit.state === "staged" ? "Staged" : "Committed"}.` : ""}`}
      className={cn(box, commit && "border-solid")}
    >
      <div className="flex min-h-(--av) flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
        <AiAvatar meta={ctx.meta} />
        <b className="font-semibold text-foreground">{short}</b>
        <span>{fixed ? `Proposed fix, ${plural(edits.length, "edit")}` : "No fix proposed"}</span>
        {!newest && <span>from an earlier fix run</span>}
        <span className="ml-auto flex items-center">
          <LogButton run={fix.run.id} ctx={ctx} />
        </span>
      </div>
      {note && (
        <p className="rl-indent m-0 mt-px text-ink-2 [overflow-wrap:anywhere]">
          <Inline text={note.reason} />
        </p>
      )}
      {edits.map((e) => (
        <Edit key={e.id} e={e} free={!held.has(e.id)} ticked={props.ticks.get(e.id) ?? newest} ctx={ctx} />
      ))}
      {commit && <Commit c={commit} target={target} busy={props.busy} ctx={ctx} />}
    </article>
  );
});
