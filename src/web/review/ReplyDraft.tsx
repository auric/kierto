// Reply drafts (docs/plans/replies.md step 6): the Draft replies button and the draft card under each thread tree.
// A draft is a draft only. It posts after Accept and the post confirm, as one reply to the message it answers.
import { Check, History, LoaderCircle } from "lucide-react";
import { memo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MetaDto } from "../../shared/dto";
import { CopyButton, Text } from "../pr/Thread";
import { snippet } from "../pr/threads";
import { Hint, type Hints } from "../shell/Hint";
import { AiAvatar, Inline } from "./Drafts";
import { EVIDENCE, plural, type ReplyCard, repliesButton, replyOf } from "./model";
import { Acts, Editor, RestoreButton, type TriageCtx, type TriageMode } from "./Triage";

// A disabled button stays focusable, so the tooltip and the screen reader can give the reason.
export function DraftRepliesButton(props: { your: number; profile: string; onClick: () => void }) {
  const s = repliesButton(props.your, props.profile);
  return (
    <Hint label={s.hint}>
      <Button
        id="replies-btn"
        size="sm"
        variant="outline"
        disabled={s.disabled}
        focusableWhenDisabled
        aria-label={`Draft replies · ${props.profile}${s.disabled ? `. ${s.hint}` : `, ${plural(props.your, "thread")}`}`}
        className="aria-disabled:cursor-default aria-disabled:opacity-50"
        onClick={props.onClick}
      >
        Draft replies · {props.profile}
        <span aria-hidden className="rounded-[4px] bg-sel px-1 text-xs font-semibold text-ink-2">
          {props.your}
        </span>
      </Button>
    </Hint>
  );
}

export type ReplyCtx = {
  meta: MetaDto;
  hints: Hints;
  announce: (text: string) => void;
  triage: TriageCtx;
  // Draft again: a new reply run for this thread only.
  again: (thread: number) => void;
};

// Dashed: a draft that nobody accepted yet. Solid: accepted, so the post bar holds it.
const box = "mt-3.5 max-w-[72ch] scroll-mt-3 rounded-lg border border-dashed border-rule-strong px-2.5 pt-2 pb-2.5";
const icon = "size-[15px] shrink-0";

function Head({ meta, children }: { meta: MetaDto; children?: ReactNode }) {
  return (
    <div className="flex min-h-(--av) flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
      <AiAvatar meta={meta} />
      <b className="font-semibold text-foreground">{meta.runner.short}</b>
      {children}
    </div>
  );
}

// thread: the root comment ID. to: the author of the message that the draft answers.
// mode: the open editor of this draft. busy: a triage request of this draft is out.
export const ReplyDraftCard = memo(function ReplyDraftCard(props: {
  card: ReplyCard;
  thread: number;
  to: string | null;
  mode: TriageMode;
  busy: boolean;
  ctx: ReplyCtx;
}) {
  const { card, thread, ctx } = props;
  const short = ctx.meta.runner.short;
  if (card.kind === "pending") {
    return (
      <p data-reply-draft={thread} className="mt-3.5 mb-0 flex items-center gap-2 text-sm text-ink-2">
        <AiAvatar meta={ctx.meta} />
        <LoaderCircle aria-hidden className={cn(icon, "animate-spin")} />
        {short} is drafting a reply…
      </p>
    );
  }
  const it = card.it;
  const p = replyOf(it);
  const id = `rd-${it.id}`;
  if (card.kind === "discarded") {
    return (
      <article
        id={id}
        data-item={it.id}
        data-reply-draft={thread}
        tabIndex={-1}
        aria-label="Discarded reply draft"
        className="mt-3.5 flex max-w-[72ch] scroll-mt-3 items-center gap-2"
      >
        <p className="m-0 min-w-0 flex-1 truncate text-sm text-muted-foreground">Discarded reply draft: {snippet(it.body, 140)}</p>
        <RestoreButton it={it} busy={props.busy} ctx={ctx.triage} />
      </article>
    );
  }
  const stale = card.stale && (
    <p className="rl-indent m-0 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
      <History aria-hidden className="size-[13px] shrink-0" />
      New messages since this draft.
      <button type="button" className="cursor-pointer rounded font-medium text-pen hover:underline" onClick={() => ctx.again(thread)}>
        Draft again
      </button>
    </p>
  );
  // No data-item: there is nothing to accept, so the keys a, e, and d skip it. The reply box below takes your own reply.
  if (card.kind === "none") {
    return (
      <article id={id} data-reply-draft={thread} tabIndex={-1} aria-label={`${short}: no reply needed`} className={box}>
        <Head meta={ctx.meta} />
        <p className="rl-indent m-0 mt-px text-ink-2 [overflow-wrap:anywhere]">
          No reply needed: <Inline text={p.reason} />
        </p>
        {stale}
      </article>
    );
  }
  const accepted = it.status === "accepted";
  return (
    <article
      id={id}
      data-item={it.id}
      data-reply-draft={thread}
      tabIndex={-1}
      aria-label={`Reply draft from ${short}${props.to ? ` to ${props.to}` : ""}.${accepted ? " Accepted." : ""}${card.stale ? " New messages since this draft." : ""}`}
      className={cn(box, accepted && "border-solid")}
    >
      <Head meta={ctx.meta}>
        <span>Reply draft{props.to && <> to {props.to}</>}</span>
        {accepted && (
          <span className="inline-flex items-center gap-1 font-medium text-ink-2">
            <Check aria-hidden className={icon} />
            Accepted
          </span>
        )}
        {it.edited && <span>edited by you</span>}
        <span className="ml-auto flex items-center">
          <CopyButton text={it.body} ctx={ctx} />
        </span>
      </Head>
      {props.mode === "edit" ? (
        <Editor it={it} busy={props.busy} ctx={ctx.triage} />
      ) : (
        <>
          <div className="rl-indent mt-px [overflow-wrap:anywhere]">
            <Text text={it.body} />
          </div>
          <p className="rl-indent m-0 mt-1.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {EVIDENCE[p.evidenceStatus]}. <Inline text={p.reason} />
          </p>
          {stale}
          <Acts it={it} busy={props.busy} ctx={ctx.triage} />
        </>
      )}
    </article>
  );
});
