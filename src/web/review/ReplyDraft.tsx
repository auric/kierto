// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Reply drafts (docs/plans/replies.md step 6): the Draft replies button and the draft card under each thread tree.
// A draft is a draft only. It posts after Accept and the post confirm, as one reply to the message it answers.
// Plan r3 UI-FIX: the judgement chip and the wait for a "Fixed in" commit. Fix sits in the thread footer (plan pr-view-v4 2.8).
// "Resolve after posting": the tick and the proof of a resolve proposal. A ticked draft resolves its thread after the post.
import {
  Check,
  CircleCheck,
  CircleHelp,
  CircleSlash,
  Contrast,
  History,
  Hourglass,
  LoaderCircle,
  type LucideIcon,
  Reply,
} from "lucide-react";
import { memo, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { MetaDto, ReviewItemDto } from "../../shared/dto";
import type { Judgement, ReplyPayload } from "../../shared/review";
import type { Turn } from "../../shared/turn";
import { JUDGEMENT } from "../fix/model";
import { CopyButton, Text } from "../pr/Thread";
import { snippet } from "../pr/threads";
import { Hint, type Hints } from "../shell/Hint";
import { AiAvatar, Inline } from "./Drafts";
import { EVIDENCE, plural, type ReplyCard, repliesButton, replyOf } from "./model";
import { Acts, Editor, RestoreButton, type TriageCtx, type TriageMode } from "./Triage";

// Plan pr-view-v4 2.2: it shows when the PR has threads. turns: the turn of each thread. onRun: a run with the brief profile.
// A click that starts no run opens a popover with the reason. The button is never disabled.
export function DraftRepliesButton({ turns, onRun }: { turns: readonly Turn[]; onRun: () => void }) {
  if (!turns.length) return null;
  const s = repliesButton(turns);
  const button = (
    <Button
      id="replies-btn"
      size="sm"
      variant="outline"
      aria-label={s.your ? `Draft replies, ${plural(s.your, "thread")}` : "Draft replies"}
      onClick={s.why ? undefined : onRun}
    >
      <Reply aria-hidden data-icon="inline-start" />
      {/* A pane of 520 px or less gets the short word. */}
      <span className="@max-[520px]/detail:hidden">Draft replies</span>
      <span className="hidden @max-[520px]/detail:inline">Replies</span>
      {s.your > 0 && (
        <span aria-hidden className="rounded-[4px] bg-sel px-1 text-xs font-semibold text-ink-2">
          {s.your}
        </span>
      )}
    </Button>
  );
  if (!s.why) return <Hint label={s.hint}>{button}</Hint>;
  return (
    <Popover>
      <PopoverTrigger render={button} />
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>{s.why.title}</PopoverTitle>
          <PopoverDescription>{s.why.text}</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  );
}

export type ReplyCtx = {
  meta: MetaDto;
  hints: Hints;
  announce: (text: string) => void;
  triage: TriageCtx;
  // Draft again: a new reply run for this thread only.
  again: (thread: number) => void;
  // The user's own pull request: the judgement sets the default tick of the Fix list.
  author: boolean;
};

// Dashed: a draft that nobody accepted yet. Solid: accepted, so the post bar holds it.
const box = "rl-enter mt-3.5 max-w-[72ch] scroll-mt-3 rounded-lg border border-dashed border-rule-strong px-2.5 pt-2 pb-2.5";
const icon = "size-[15px] shrink-0";

const JUDGEMENT_ICON: Record<Judgement, LucideIcon> = { valid: CircleCheck, partly: Contrast, invalid: CircleSlash, question: CircleHelp };

// The judgement of the AI on the review point. The word carries the state, the icon only repeats it.
export function JudgementChip({ j }: { j: Judgement }) {
  const Icon = JUDGEMENT_ICON[j];
  return (
    <Badge variant="outline" data-judgement={j}>
      <Icon aria-hidden data-icon="inline-start" />
      {JUDGEMENT[j]}
    </Badge>
  );
}

// who: "Your session" for a draft from a pasted session answer (session-consult.md part B), else the runner.
function Head({ meta, who, children }: { meta: MetaDto; who: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-(--av) flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
      <AiAvatar meta={meta} />
      <b className="font-semibold text-foreground">{who}</b>
      {children}
    </div>
  );
}

// thread: the root comment ID. mine: the user started the thread. to: the author of the message that the draft answers.
// mode: the open editor of this draft. busy: a triage request of this draft is out.
// waiting: the short hash of a "Fixed in" commit that the PR commits do not list yet.
export const ReplyDraftCard = memo(function ReplyDraftCard(props: {
  card: ReplyCard;
  thread: number;
  mine: boolean;
  to: string | null;
  mode: TriageMode;
  busy: boolean;
  waiting: string | null;
  ctx: ReplyCtx;
}) {
  const { card, thread, ctx } = props;
  const short = ctx.meta.runner.short;
  if (card.kind === "pending") {
    return (
      <p data-reply-draft={thread} className="rl-enter mt-3.5 mb-0 flex items-center gap-2 text-sm text-ink-2">
        <AiAvatar meta={ctx.meta} />
        <LoaderCircle aria-hidden className={cn(icon, "animate-spin")} />
        {short} is drafting a reply…
      </p>
    );
  }
  const it = card.it;
  const p = replyOf(it);
  const id = `rd-${it.id}`;
  const session = !!it.payload.session;
  const who = session ? "Your session" : short;
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
        <p className="rl-fade m-0 min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {it.body.trim() ? `Discarded reply draft: ${snippet(it.body, 140)}` : "Discarded resolve proposal"}
        </p>
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
  const j = p.judgement ?? null;
  const chip =
    j &&
    (ctx.author ? (
      <Hint label="The judgement sets the default tick in the Fix list.">
        <span className="inline-flex">
          <JudgementChip j={j} />
        </span>
      </Hint>
    ) : (
      <JudgementChip j={j} />
    ));
  const judged = j ? ` ${JUDGEMENT[j]}.` : "";
  // No data-item: there is nothing to accept, so the keys a, e, and d skip it. The reply box below takes your own reply.
  if (card.kind === "none") {
    return (
      <article
        id={id}
        data-reply-draft={thread}
        tabIndex={-1}
        aria-label={`${who}: no reply needed${judged && `.${judged}`}`}
        className={box}
      >
        <Head meta={ctx.meta} who={who}>
          {chip}
        </Head>
        <p className="rl-indent m-0 mt-px text-ink-2 [overflow-wrap:anywhere]">
          No reply needed: <Inline text={p.reason} />
        </p>
        {stale}
      </article>
    );
  }
  const accepted = it.status === "accepted";
  const text = it.body.trim() !== "";
  const resolves = p.resolveTick === true;
  return (
    <article
      id={id}
      data-item={it.id}
      data-reply-draft={thread}
      tabIndex={-1}
      aria-label={`${text ? "Reply draft" : "Resolve proposal"} from ${session ? "your session" : short}${text && props.to ? ` to ${props.to}` : ""}.${judged}${resolves ? " Resolves the thread after the post." : ""}${accepted ? " Accepted." : ""}${card.stale ? " New messages since this draft." : ""}`}
      className={cn(box, accepted && "border-solid")}
    >
      <Head meta={ctx.meta} who={who}>
        <span>{text ? <>Reply draft{props.to && <> to {props.to}</>}</> : "Resolve proposal"}</span>
        {chip}
        {accepted && (
          <span className="rl-fade inline-flex items-center gap-1 font-medium text-ink-2">
            <Check aria-hidden className={icon} />
            Accepted
          </span>
        )}
        {it.edited && <span>edited by you</span>}
        <span className="ml-auto flex items-center">{text && <CopyButton text={it.body} ctx={ctx} />}</span>
      </Head>
      {props.mode === "edit" ? (
        <Editor it={it} busy={props.busy} ctx={ctx.triage} />
      ) : (
        <>
          {text ? (
            <div className="rl-indent mt-px [overflow-wrap:anywhere]">
              <Text text={it.body} />
            </div>
          ) : (
            <p className="rl-indent m-0 mt-px text-ink-2">
              {resolves ? "No reply. The thread resolves after the post." : "No reply. Tick the box to resolve the thread without one."}
            </p>
          )}
          <p className="rl-indent m-0 mt-1.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {session ? "From your session." : `${EVIDENCE[p.evidenceStatus]}.`}{" "}
            {/* A session draft without reply text holds the reason as its body. */}
            {!(session && p.reason.trim() === it.body.trim()) && <Inline text={p.reason} />}
          </p>
          {props.waiting && (
            <p className="rl-indent m-0 mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-2">
              <Hourglass aria-hidden className="size-[13px] shrink-0" />
              <span>
                Waiting for{" "}
                <code translate="no" className="font-mono">
                  {props.waiting}
                </code>{" "}
                on the PR branch. Push it. The next sync finds it.
              </span>
            </p>
          )}
          <ResolveTick it={it} p={p} mine={props.mine} who={who} busy={props.busy} ctx={ctx} />
          {stale}
          <Acts it={it} busy={props.busy} ctx={ctx.triage} />
        </>
      )}
    </article>
  );
});

// The tick shows on every open draft, so a plain reply can resolve too. The proof shows only for a proposal.
// A thread that another person started never gets the tick by default (jobs.ts, validate.ts).
function ResolveTick(props: { it: ReviewItemDto; p: ReplyPayload; mine: boolean; who: string; busy: boolean; ctx: ReplyCtx }) {
  const { it, p } = props;
  const proof = p.resolve && p.resolveEvidence ? p.resolveEvidence : null;
  return (
    <div className="rl-indent mt-2 text-sm">
      <label className="inline-flex cursor-pointer items-center gap-2 font-medium">
        <input
          type="checkbox"
          className="m-0 shrink-0 accent-foreground"
          checked={p.resolveTick === true}
          disabled={props.busy}
          onChange={(e) => props.ctx.triage.tick(it, e.target.checked)}
        />
        <CircleCheck aria-hidden className="size-[13px] shrink-0 text-ink-2" />
        Resolve after posting
      </label>
      {(proof || (!props.mine && (p.resolve || p.resolveTick))) && (
        <p className="m-0 mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {proof && (
            <>
              {props.who} proposes it: <Inline text={proof} />{" "}
            </>
          )}
          {!props.mine && "Another person started this thread."}
        </p>
      )}
    </div>
  );
}
