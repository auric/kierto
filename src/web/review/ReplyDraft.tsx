// Reply drafts (docs/plans/replies.md step 6): the Draft replies button and the draft card under each thread tree.
// A draft is a draft only. It posts after Accept and the post confirm, as one reply to the message it answers.
// Plan r3 UI-FIX: the judgement chip, Fix and the runner prompt on the own PR, and the wait for a "Fixed in" commit.
import {
  Check,
  CircleCheck,
  CircleHelp,
  CircleSlash,
  ClipboardCopy,
  Contrast,
  History,
  Hourglass,
  LoaderCircle,
  type LucideIcon,
  Wrench,
} from "lucide-react";
import { memo, type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MetaDto } from "../../shared/dto";
import type { Judgement } from "../../shared/review";
import { JUDGEMENT } from "../fix/model";
import { CopyButton, Text } from "../pr/Thread";
import { snippet } from "../pr/threads";
import type { Hints } from "../shell/Hint";
import { AiAvatar, Inline } from "./Drafts";
import { EVIDENCE, plural, type ReplyCard, repliesButton, replyOf } from "./model";
import { RunSplit } from "./RunSplit";
import { Acts, Editor, RestoreButton, type TriageCtx, type TriageMode } from "./Triage";

// profile: the brief profile. onRun: a run with the brief profile, or with the given profile only.
export function DraftRepliesButton(props: {
  your: number;
  meta: MetaDto;
  profile: { id: string; name: string };
  onRun: (profile?: string) => void;
}) {
  const s = repliesButton(props.your, props.profile.name);
  return (
    <RunSplit
      id="replies-btn"
      variant="outline"
      hint={s.hint}
      disabled={s.disabled}
      label={`Draft replies · ${props.profile.name}${s.disabled ? `. ${s.hint}` : `, ${plural(props.your, "thread")}`}`}
      menu="Draft replies with another profile"
      heading="Profile for these replies"
      profiles={props.meta.profiles}
      current={props.profile.id}
      onRun={props.onRun}
    >
      Draft replies
      <span aria-hidden className="rounded-[4px] bg-sel px-1 text-xs font-semibold text-ink-2">
        {props.your}
      </span>
    </RunSplit>
  );
}

export type ReplyCtx = {
  meta: MetaDto;
  hints: Hints;
  announce: (text: string) => void;
  triage: TriageCtx;
  // Draft again: a new reply run for this thread only.
  again: (thread: number) => void;
  // Plan r3: a fix run for this thread only.
  fix: (thread: number) => void;
  // Copies the runner prompt of the thread. Call it in the click handler. Resolves to the next step for the user, or null
  // when the clipboard is blocked.
  copyPrompt: (thread: number) => Promise<string | null>;
};

// Dashed: a draft that nobody accepted yet. Solid: accepted, so the post bar holds it.
const box = "rl-enter mt-3.5 max-w-[72ch] scroll-mt-3 rounded-lg border border-dashed border-rule-strong px-2.5 pt-2 pb-2.5";
const icon = "size-[15px] shrink-0";

const JUDGEMENT_ICON: Record<Judgement, LucideIcon> = { valid: CircleCheck, partly: Contrast, invalid: CircleSlash, question: CircleHelp };

// The judgement of the AI on the review point. The word carries the state, the icon only repeats it.
function JudgementChip({ j }: { j: Judgement }) {
  const Icon = JUDGEMENT_ICON[j];
  return (
    <Badge variant="outline" data-judgement={j}>
      <Icon aria-hidden data-icon="inline-start" />
      {JUDGEMENT[j]}
    </Badge>
  );
}

// The note stays after the copy, so the user can read the next step.
function PromptButton({ thread, ctx }: { thread: number; ctx: ReplyCtx }) {
  const [next, setNext] = useState<string | null>(null);
  const copy = () =>
    void ctx.copyPrompt(thread).then((text) => {
      if (text) setNext(text);
    });
  return (
    <>
      <Button size="sm" variant="ghost" className="text-ink-2" onClick={copy}>
        <ClipboardCopy aria-hidden data-icon="inline-start" />
        Copy prompt for {ctx.meta.runner.name}
      </Button>
      {next && (
        <p className="rl-fade m-0 w-full text-xs text-ink-2 [overflow-wrap:anywhere]">
          <Check aria-hidden className="mr-1 inline size-[13px] align-[-2px]" />
          {next}
        </p>
      )}
    </>
  );
}

// Plan r3 section 1: only valid and partly offer Fix, on the user's own pull request.
function FixActs({ thread, ctx }: { thread: number; ctx: ReplyCtx }) {
  return (
    <div className="rl-indent mt-1.5 flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="outline" aria-label="Fix the code for this comment" onClick={() => ctx.fix(thread)}>
        <Wrench aria-hidden data-icon="inline-start" />
        Fix
      </Button>
      <PromptButton thread={thread} ctx={ctx} />
    </div>
  );
}

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
// fixable: the draft offers Fix. waiting: the short hash of a "Fixed in" commit that the PR commits do not list yet.
export const ReplyDraftCard = memo(function ReplyDraftCard(props: {
  card: ReplyCard;
  thread: number;
  to: string | null;
  mode: TriageMode;
  busy: boolean;
  fixable: boolean;
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
        <p className="rl-fade m-0 min-w-0 flex-1 truncate text-sm text-muted-foreground">Discarded reply draft: {snippet(it.body, 140)}</p>
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
  const chip = j && <JudgementChip j={j} />;
  const judged = j ? ` ${JUDGEMENT[j]}.` : "";
  const fix = props.fixable && <FixActs thread={thread} ctx={ctx} />;
  // No data-item: there is nothing to accept, so the keys a, e, and d skip it. The reply box below takes your own reply.
  if (card.kind === "none") {
    return (
      <article
        id={id}
        data-reply-draft={thread}
        tabIndex={-1}
        aria-label={`${short}: no reply needed${judged && `.${judged}`}`}
        className={box}
      >
        <Head meta={ctx.meta}>{chip}</Head>
        <p className="rl-indent m-0 mt-px text-ink-2 [overflow-wrap:anywhere]">
          No reply needed: <Inline text={p.reason} />
        </p>
        {stale}
        {fix}
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
      aria-label={`Reply draft from ${short}${props.to ? ` to ${props.to}` : ""}.${judged}${accepted ? " Accepted." : ""}${card.stale ? " New messages since this draft." : ""}`}
      className={cn(box, accepted && "border-solid")}
    >
      <Head meta={ctx.meta}>
        <span>Reply draft{props.to && <> to {props.to}</>}</span>
        {chip}
        {accepted && (
          <span className="rl-fade inline-flex items-center gap-1 font-medium text-ink-2">
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
          {stale}
          <Acts it={it} busy={props.busy} ctx={ctx.triage} />
          {fix}
        </>
      )}
    </article>
  );
});
