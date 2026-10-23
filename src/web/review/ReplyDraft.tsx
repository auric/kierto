// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Reply drafts (docs/plans/replies.md step 6): the Draft replies button and the draft card under each thread tree.
// A draft is a draft only. It posts after Accept and the post confirm, as one reply to the message it answers.
// Plan r3 UI-FIX: the judgement chip and the wait for a "Fixed in" commit. Fix sits in the thread footer (plan pr-view-v4 2.8).
// "Resolve after posting": the tick and the proof of a resolve proposal. A ticked draft resolves its thread after the post.
// docs/plans/thread-outcome.md: the outcome line on top of the AI area of a thread, and the note when the reply and the fix disagree.
import {
  Ban,
  Check,
  CheckCheck,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleHelp,
  CircleSlash,
  Contrast,
  FileCode,
  FileDiff,
  GitCommitHorizontal,
  History,
  Hourglass,
  LoaderCircle,
  type LucideIcon,
  MessageCircleQuestionMark,
  MessageSquareReply,
  NotebookPen,
  PenLine,
  Reply,
  RotateCcw,
  Signpost,
  Split,
  Undo2,
  Wrench,
} from "lucide-react";
import { type FocusEvent, Fragment, memo, type ReactNode, useCallback, useId, useLayoutEffect, useRef } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { MetaDto, NoteDto, ReviewItemDto } from "../../shared/dto";
import type { Judgement, ReplyOrigin, ReplyPayload } from "../../shared/review";
import type { Turn } from "../../shared/turn";
import { askerSide, JUDGEMENT } from "../fix/model";
import { type DiffLine, wordDiff } from "../lib/textdiff";
import { CopyButton, Text } from "../pr/Thread";
import { snippet } from "../pr/threads";
import { Hint, type Hints } from "../shell/Hint";
import { AiAvatar, Inline } from "./Drafts";
import { type CardState, cardFocus, EVIDENCE, plural, type ReplyCard, repliesButton, replyOf, touchedDraft, turnedStale } from "./model";
import { asksFix, type ConflictText, MARKER, type Outcome, type OutcomeKind } from "./outcome";
import { Acts, Editor, RestoreButton, type TriageCtx, type TriageMode } from "./Triage";

// Plan pr-view-v4 2.2: it shows when the PR has threads. turns: the turn of each thread. need: the threads whose outcome needs a reply.
// onRun: a run with the brief profile. A click that starts no run opens a popover with the reason. The button is never disabled.
export function DraftRepliesButton({ turns, need, onRun }: { turns: readonly Turn[]; need: number; onRun: () => void }) {
  if (!turns.length) return null;
  const s = repliesButton(turns, need);
  const button = (
    <Button
      id="replies-btn"
      size="sm"
      variant="outline"
      aria-label={s.need ? `Draft replies, ${plural(s.need, "thread")}` : "Draft replies"}
      onClick={s.why ? undefined : onRun}
    >
      <Reply aria-hidden data-icon="inline-start" />
      {/* A pane of 520 px or less gets the short word. */}
      <span className="@max-[520px]/detail:hidden">Draft replies</span>
      <span className="hidden @max-[520px]/detail:inline">Replies</span>
      {s.need > 0 && (
        <span aria-hidden className="rounded-[4px] bg-sel px-1 text-xs font-semibold text-ink-2">
          {s.need}
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
  // Draft again: a new reply run for this thread only. For a draft that you edited or accepted, the run revises it (jobs.ts).
  again: (thread: number) => void;
  // "Post as plain reply": drops the commit link of a "Fixed in" draft and accepts it (item action plain).
  plain: (it: ReviewItemDto) => void;
  // docs/plans/thread-outcome.md. take: the revision rev replaces your draft it. keep: rev goes. newest: it answers the newest message.
  revision: { take: (rev: ReviewItemDto, it: ReviewItemDto) => void; keep: (rev: ReviewItemDto) => void };
  newest: (it: ReviewItemDto) => void;
  // Focuses the line of this thread in the diff.
  diff: (thread: number) => void;
  // The user's own pull request: the judgement sets the default tick of the Fix list.
  author: boolean;
  // docs/plans/review-v2/spec.md section 2.7: Keep and Dismiss of a note suggestion on the card, and the threads that cites name.
  // card: the ID of the card element, for the focus after the choice. name: the starter of a thread, null when it is gone.
  notes: { choose: (n: NoteDto, state: "kept" | "dismissed", card: string) => void; busy: ReadonlySet<number> };
  cite: { name: (thread: number) => string | null; go: (thread: number) => void };
};

// Dashed: a draft that nobody accepted yet. Solid: accepted, so the post bar holds it.
const box = "rl-enter mt-3.5 max-w-[72ch] scroll-mt-3 rounded-lg border border-dashed border-rule-strong px-2.5 pt-2 pb-2.5";
const icon = "size-[15px] shrink-0";
const CODE_CHANGED = "The code at this comment changed after this draft.";
// A text button in a line of small text. The target is 24 px high (WCAG 2.5.8). The negative margins keep the line as it was.
const linkButton =
  "-mx-1 -my-1 inline-flex min-h-6 cursor-pointer items-center rounded px-1 font-medium text-pen hover:underline disabled:cursor-default disabled:opacity-50";

// A sync, a run, or an action can remove the focused control of a card: Accept on a draft that goes out of date, Draft again, or
// Use revision. The focus then goes to the card, or to Draft again (model.ts cardFocus). say: the words when the card goes out of date.
function useCardFocus(now: CardState, say: string, announce: (text: string) => void) {
  const root = useRef<HTMLElement | null>(null);
  const last = useRef<HTMLElement | null>(null);
  const was = useRef<CardState | null>(null);
  useLayoutEffect(() => {
    const before = was.current;
    was.current = now;
    const el = root.current;
    if (!el) return;
    const a = document.activeElement;
    const to = cardFocus({ before, now, lost: !a || a === document.body, gone: !!last.current && !last.current.isConnected });
    if (to) {
      last.current = null;
      ((to === "again" && el.querySelector<HTMLElement>("[data-again]:enabled")) || el).focus({ preventScroll: true });
    }
    if (turnedStale(before, now) && el.contains(document.activeElement)) announce(say);
  });
  const ref = useCallback((el: HTMLElement | null) => {
    root.current = el;
  }, []);
  const onFocus = (e: FocusEvent<HTMLElement>) => {
    last.current = e.target;
  };
  return { ref, onFocus };
}

const JUDGEMENT_ICON: Record<Judgement, LucideIcon> = {
  valid: CircleCheck,
  partly: Contrast,
  invalid: CircleSlash,
  question: CircleHelp,
  settled: CheckCheck,
  unsettled: CircleDashed,
  followup: MessageCircleQuestionMark,
};

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

// who: "Your session" for a draft from an imported session answer (session-consult.md part C), else the runner.
function Head({ meta, who, children }: { meta: MetaDto; who: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-(--av) flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
      <AiAvatar meta={meta} />
      <b className="font-semibold text-foreground">{who}</b>
      {children}
    </div>
  );
}

// The writer of a draft (shared/review.ts replyOrigins). A session draft names it in the head instead. A discuss draft names the
// runner (docs/plans/review-v2/spec.md section 2.1).
const ORIGIN: Record<Exclude<ReplyOrigin, "discuss">, string> = {
  review: "from the review",
  reply: "from the reply run",
  fix: "from your fix commit",
  nofix: "from the fix run",
  session: "from your session",
  resolve: "from the re-review",
  user: "written by you",
};
// thread-outcome.md section 4: a draft stored before origin existed is "Fixed in" with fix, else a reply run.
const originOf = (p: ReplyPayload): ReplyOrigin => p.origin ?? (p.fix ? "fix" : "reply");

function Origin({ p, runner }: { p: ReplyPayload; runner: string }) {
  const o = originOf(p);
  return <span data-origin={o}>{o === "discuss" ? `from your talk with ${runner}` : ORIGIN[o]}</span>;
}

// The look of each outcome. The words carry the state. The icon and the color only repeat it.
const OUTCOME: Record<OutcomeKind, { icon: LucideIcon; tone: string }> = {
  open: { icon: CircleDot, tone: "text-ink-2" },
  answered: { icon: MessageSquareReply, tone: "text-foreground" },
  "to-fix": { icon: Wrench, tone: "text-turn" },
  proposed: { icon: FileDiff, tone: "text-turn" },
  fixed: { icon: GitCommitHorizontal, tone: "text-ok" },
  partly: { icon: GitCommitHorizontal, tone: "text-warn" },
  already: { icon: CheckCheck, tone: "text-ok" },
  wont: { icon: Ban, tone: "text-foreground" },
  decide: { icon: Signpost, tone: "text-warn" },
  followup: { icon: MessageCircleQuestionMark, tone: "text-foreground" },
  settled: { icon: CheckCheck, tone: "text-ok" },
  waiting: { icon: Hourglass, tone: "text-ink-2" },
  resolved: { icon: CircleCheck, tone: "text-ok" },
};

// docs/plans/thread-outcome.md section 3: one line on top of the AI area. A new outcome fades in, so a change after an action shows.
export const OutcomeLine = memo(function OutcomeLine({ o }: { o: Outcome }) {
  const { icon: Icon, tone } = OUTCOME[o.kind];
  return (
    <p data-outcome={o.kind} className="mt-3.5 mb-0 flex max-w-[72ch] flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span key={`${o.kind}:${o.label}`} className={cn("rl-fade inline-flex items-center gap-1.5 font-semibold", tone)}>
        <Icon aria-hidden className={icon} />
        <span className="sr-only">Outcome: </span>
        {o.label}
        {/* A flex box drops the space between its items from the layout, but the text keeps it for copy and for screen readers. */}
        {o.commit && (
          <>
            {" "}
            <code translate="no" className="font-mono">
              {o.commit}
            </code>
          </>
        )}
        {o.detail && ":"}
      </span>
      {o.detail && (
        <>
          {" "}
          <span className="min-w-0 text-ink-2 [overflow-wrap:anywhere]">{o.detail}</span>
        </>
      )}
      {o.markers.map((m) => (
        <Fragment key={m}>
          {" "}
          <Badge data-marker={m} variant={m === "push" || m === "revision" ? "quiet" : "warn"}>
            {MARKER[m]}
          </Badge>
        </Fragment>
      ))}
    </p>
  );
});

// The note when the reply and the fix disagree. Each button keeps one side. busy: a request of the note is out.
export function ConflictNote({ c, busy, onKeep, onFix }: { c: ConflictText; busy: boolean; onKeep: () => void; onFix: () => void }) {
  const id = useId();
  // The wrapper keeps the width of the cards: 72ch of the body font, not of the smaller alert font.
  return (
    <div data-conflict className="rl-enter mt-2 max-w-[72ch]">
      <Alert role="note" aria-labelledby={`${id}-t`} className="border-warn/40">
        <Split aria-hidden className="text-warn" />
        <AlertTitle id={`${id}-t`}>{c.title}</AlertTitle>
        <AlertDescription className="text-ink-2">{c.text}</AlertDescription>
        <div className="col-start-2 mt-1 grid gap-2">
          <p id={`${id}-d`} className="m-0 text-xs text-muted-foreground">
            {c.keep.label} {c.keep.does}. {c.fix.label} {c.fix.does}.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" disabled={busy} aria-describedby={`${id}-d`} onClick={onKeep}>
              {c.keep.label}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} aria-describedby={`${id}-d`} onClick={onFix}>
              {c.fix.label}
            </Button>
          </div>
        </div>
      </Alert>
    </div>
  );
}

// thread: the root comment ID. mine: the user started the thread. to: the author of the message that the draft answers.
// mode: the open editor of this draft. busy: a triage request of this draft is out.
// waiting: the short hash of a "Fixed in" commit that the PR commits do not list yet. gone: the post plan says that the clone branch
// no longer holds that commit (commit-gone), so the card offers "Post as plain reply".
// resolved: the thread is resolved now. since: it was open when the app stored the draft. null: the thread is open.
// code: the code at the comment changed after the draft (outcome marker "Code changed").
export const ReplyDraftCard = memo(function ReplyDraftCard(props: {
  card: ReplyCard;
  thread: number;
  mine: boolean;
  to: string | null;
  mode: TriageMode;
  busy: boolean;
  waiting: string | null;
  gone: boolean;
  resolved: "since" | "now" | null;
  code: boolean;
  ctx: ReplyCtx;
}) {
  const { card, thread, ctx } = props;
  const short = ctx.meta.runner.short;
  // docs/plans/thread-outcome.md: a reply run revises a draft that you edited or accepted, so the button says what it does.
  // Reply to the newest keeps the text. A thread resolved after the draft must open again first, so that choice waits.
  const mineText = card.kind !== "pending" && touchedDraft(card.it);
  const asIs = card.kind === "draft" && card.it.body.trim() !== "" && props.resolved !== "since";
  const focus = useCardFocus(
    { kind: card.kind, stale: card.kind !== "pending" && card.kind !== "discarded" && card.stale },
    `New messages arrived after this draft. ${mineText ? "Revise your reply" : "Draft it again"}${asIs ? ", or reply to the newest as is" : ""}.`,
    ctx.announce,
  );
  if (card.kind === "pending") {
    return (
      <p
        ref={focus.ref}
        id={card.id === null ? undefined : `rd-${card.id}`}
        role="status"
        tabIndex={-1}
        data-reply-draft={thread}
        onFocus={focus.onFocus}
        className="rl-enter mt-3.5 mb-0 flex scroll-mt-3 items-center gap-2 text-sm text-ink-2"
      >
        <AiAvatar meta={ctx.meta} />
        <LoaderCircle aria-hidden className={cn(icon, "animate-spin")} />
        {short} is {card.revise ? "revising your reply" : "drafting a reply"}…
      </p>
    );
  }
  const it = card.it;
  const p = replyOf(it);
  const id = `rd-${it.id}`;
  const session = !!it.payload.session;
  const who = session ? "Your session" : short;
  if (card.kind === "discarded") {
    const line = it.body.trim() ? `Discarded reply draft: ${snippet(it.body, 140)}` : "Discarded resolve proposal";
    return (
      <article
        ref={focus.ref}
        id={id}
        data-item={it.id}
        data-reply-draft={thread}
        tabIndex={-1}
        aria-label="Discarded reply draft"
        onFocus={focus.onFocus}
        className="mt-3.5 flex max-w-[72ch] scroll-mt-3 items-center gap-2"
      >
        <p title={line} className="rl-fade m-0 min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {line}
        </p>
        <RestoreButton it={it} busy={props.busy} ctx={ctx.triage} />
      </article>
    );
  }
  const stale = card.stale && (
    <p className="rl-indent m-0 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
      <History aria-hidden className="size-[13px] shrink-0" />
      New messages since this draft.
      <button type="button" data-again disabled={props.busy} className={linkButton} onClick={() => ctx.again(thread)}>
        {mineText ? "Revise my reply" : "Draft again"}
      </button>
      {asIs && (
        <button type="button" disabled={props.busy} className={linkButton} onClick={() => ctx.newest(it)}>
          Reply to the newest as is
        </button>
      )}
    </p>
  );
  // docs/plans/thread-outcome.md section 11: a touched draft keeps your text, so the line only points to the code. The out-of-date
  // line offers Draft again already.
  const code = props.code && (
    <p data-code-changed className="rl-indent m-0 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
      <FileCode aria-hidden className="size-[13px] shrink-0" />
      {CODE_CHANGED}
      {mineText ? (
        <button type="button" title="Key: g d" aria-keyshortcuts="g d" className={linkButton} onClick={() => ctx.diff(thread)}>
          Show in diff
        </button>
      ) : (
        !card.stale && (
          <button type="button" disabled={props.busy} className={linkButton} onClick={() => ctx.again(thread)}>
            Draft again
          </button>
        )
      )}
    </p>
  );
  const j = p.judgement ?? null;
  const chip =
    j &&
    (ctx.author && !askerSide(j) ? (
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
  // P8 (docs/plans/thread-outcome.md): a session accept without a reply asks for a fix, so it says "To fix".
  if (card.kind === "none") {
    const lead = asksFix(it, ctx.author) ? "To fix" : "No reply needed";
    return (
      <article
        ref={focus.ref}
        id={id}
        data-reply-draft={thread}
        tabIndex={-1}
        aria-label={`${who}: ${lead.toLowerCase()}${judged && `.${judged}`}${props.code ? ` ${CODE_CHANGED}` : ""}`}
        onFocus={focus.onFocus}
        className={box}
      >
        <Head meta={ctx.meta} who={who}>
          {!session && <Origin p={p} runner={short} />}
          {chip}
        </Head>
        <p className="rl-indent m-0 mt-px text-ink-2 [overflow-wrap:anywhere]">
          {lead}: <Inline text={p.reason} />
        </p>
        <Cites cites={p.cites} ctx={ctx} />
        <Suggestions notes={it.notes} card={id} ctx={ctx} />
        {stale}
        {code}
      </article>
    );
  }
  const accepted = it.status === "accepted";
  const text = it.body.trim() !== "";
  const resolves = p.resolveTick === true;
  // The forge takes no reply in a resolved thread, so the post reopens it first. A draft without text posts no reply.
  // A thread resolved after the draft keeps the draft out of the post (docs/plans/thread-outcome.md).
  const reopen =
    text && props.resolved
      ? props.resolved === "since"
        ? "Resolved since the draft. Reopen the thread to post this reply."
        : "The thread is resolved. The post reopens it first."
      : null;
  return (
    <article
      ref={focus.ref}
      id={id}
      data-item={it.id}
      data-reply-draft={thread}
      tabIndex={-1}
      onFocus={focus.onFocus}
      aria-label={`${text ? "Reply draft" : "Resolve proposal"} from ${session ? "your session" : short}${text && props.to ? ` to ${props.to}` : ""}.${judged}${reopen ? ` ${reopen}` : ""}${resolves ? " Resolves the thread after the post." : ""}${accepted ? " Accepted." : ""}${card.stale ? " New messages since this draft." : ""}${props.code ? ` ${CODE_CHANGED}` : ""}${it.revised ? " A revision waits." : ""}`}
      className={cn(box, accepted && "border-solid")}
    >
      <Head meta={ctx.meta} who={who}>
        <span>{text ? <>Reply draft{props.to && <> to {props.to}</>}</> : "Resolve proposal"}</span>
        {!session && <Origin p={p} runner={short} />}
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
            {/* The head names the fix-run writer. A fix-run note has no evidence status of its own. */}
            {session ? "From your session. " : p.origin === "nofix" ? "" : `${EVIDENCE[p.evidenceStatus]}. `}
            {/* A session draft without reply text holds the reason as its body. */}
            {!(session && p.reason.trim() === it.body.trim()) && <Inline text={p.reason} />}
          </p>
          <Cites cites={p.cites} ctx={ctx} />
          <Suggestions notes={it.notes} card={id} ctx={ctx} />
          {props.waiting && (
            <p className="rl-indent m-0 mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-2">
              <Hourglass aria-hidden className="size-[13px] shrink-0" />
              {props.gone ? (
                <>
                  <span>
                    The commit{" "}
                    <code translate="no" className="font-mono">
                      {props.waiting}
                    </code>{" "}
                    is not on the branch of your clone. A rebase or a squash can do that.
                  </span>
                  <button type="button" disabled={props.busy} className={linkButton} onClick={() => ctx.plain(it)}>
                    Post as plain reply
                  </button>
                </>
              ) : (
                <span>
                  Waiting for{" "}
                  <code translate="no" className="font-mono">
                    {props.waiting}
                  </code>{" "}
                  on the PR branch. Push it. The next sync finds it.
                </span>
              )}
            </p>
          )}
          {reopen && (
            <p data-reopen className="rl-indent m-0 mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-2">
              <RotateCcw aria-hidden className="size-[13px] shrink-0" />
              {reopen}
            </p>
          )}
          <ResolveTick it={it} p={p} mine={props.mine} who={who} busy={props.busy} ctx={ctx} />
          {stale}
          {code}
          <Acts it={it} busy={props.busy} stale={card.stale} ctx={ctx.triage} />
          {it.revised && <Revision it={it} rev={it.revised} who={who} busy={props.busy} ctx={ctx} />}
        </>
      )}
    </article>
  );
});

// docs/plans/review-v2/spec.md section 2.7: the note suggestions of the run that made this draft or answer, the same rows as in the
// Notes block. card: the ID of the element that keeps the focus after the choice. flush: no indent under an avatar.
// Keep and Dismiss wrap as one unit, so a wrap never puts them on two lines.
export function Suggestions(props: {
  notes: readonly NoteDto[] | undefined;
  card: string;
  flush?: boolean;
  ctx: Pick<ReplyCtx, "meta" | "notes">;
}) {
  const { card, ctx } = props;
  const short = ctx.meta.runner.short;
  return (props.notes ?? []).map((n) => (
    <p
      key={n.id}
      data-note-suggestion={n.id}
      className={cn("m-0 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2", !props.flush && "rl-indent")}
    >
      <NotebookPen aria-hidden className="size-[13px] shrink-0" />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {short} suggests a note: {n.text}
      </span>
      <span className="inline-flex items-center gap-x-2 whitespace-nowrap">
        <button type="button" disabled={ctx.notes.busy.has(n.id)} className={linkButton} onClick={() => ctx.notes.choose(n, "kept", card)}>
          Keep
        </button>
        <button
          type="button"
          disabled={ctx.notes.busy.has(n.id)}
          className={linkButton}
          onClick={() => ctx.notes.choose(n, "dismissed", card)}
        >
          Dismiss
        </button>
      </span>
    </p>
  ));
}

// "Based on the thread of Bob": one link per thread that the reply or the answer relies on (cites). flush: no indent under an avatar.
export function Cites(props: { cites: readonly number[] | undefined; flush?: boolean; ctx: Pick<ReplyCtx, "cite"> }) {
  const { ctx } = props;
  const cites = props.cites ?? [];
  if (!cites.length) return null;
  return (
    <p data-cites className={cn("m-0 mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-ink-2", !props.flush && "rl-indent")}>
      <Signpost aria-hidden className="mr-1 size-[13px] shrink-0" />
      Based on the {cites.length === 1 ? "thread" : "threads"} of
      {cites.map((t, i) => (
        <Fragment key={t}>
          {i > 0 && (i === cites.length - 1 ? " and" : ",")}
          <button type="button" className={linkButton} onClick={() => ctx.cite.go(t)}>
            {ctx.cite.name(t) ?? `thread ${t}`}
          </button>
        </Fragment>
      ))}
    </p>
  );
}

// A word diff. Struck text leaves, underlined text comes in, so the state never rests on color alone.
// The screen reader words sit outside the marks: inside, they make an empty marked line fragment at a wrap.
export function DiffText({ parts }: { parts: readonly DiffLine[] }) {
  return parts.map((d, k) => (
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
            <ins className="rounded-[3px] bg-(--add) box-decoration-clone px-0.5 underline decoration-1 underline-offset-2">{d.text}</ins>
          )}
          <span className="sr-only">]</span>
        </>
      )}
    </Fragment>
  ));
}

// docs/plans/thread-outcome.md: the revision of your draft as a word diff against your text. A revision without text and without a
// resolve says that no reply is needed.
function Revision(props: { it: ReviewItemDto; rev: ReviewItemDto; who: string; busy: boolean; ctx: ReplyCtx }) {
  const { it, rev, ctx } = props;
  const id = useId();
  const r = replyOf(rev);
  const none = !rev.body.trim() && !r.resolve;
  const parts = none ? [] : wordDiff(it.body.trim(), rev.body.trim());
  return (
    <section aria-labelledby={`${id}-t`} data-revision={rev.id} className="rl-enter rl-indent mt-3 border-l-2 border-pen/60 pl-2.5">
      <p id={`${id}-t`} className="m-0 flex flex-wrap items-center gap-x-1.5 text-sm font-semibold">
        <PenLine aria-hidden className="size-[13px] shrink-0 text-pen" />
        {none ? `${props.who} finds that no reply is needed now` : `${props.who} revised your reply`}
      </p>
      {!none && (
        <p data-diff className="m-0 mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
          <DiffText parts={parts} />
        </p>
      )}
      <p className="m-0 mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
        <Inline text={r.reason} />
      </p>
      <p id={`${id}-d`} className="m-0 mt-1.5 text-xs text-muted-foreground">
        {none
          ? "Use revision discards your draft. Keep mine drops the revision."
          : "Struck text leaves your reply, underlined text comes in. Use revision makes it your draft, not accepted. Keep mine drops it."}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="outline" disabled={props.busy} aria-describedby={`${id}-d`} onClick={() => ctx.revision.take(rev, it)}>
          <Check aria-hidden data-icon="inline-start" />
          Use revision
        </Button>
        <Button size="sm" variant="outline" disabled={props.busy} aria-describedby={`${id}-d`} onClick={() => ctx.revision.keep(rev)}>
          <Undo2 aria-hidden data-icon="inline-start" />
          Keep mine
        </Button>
      </div>
    </section>
  );
}

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
