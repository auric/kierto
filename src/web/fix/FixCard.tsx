// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The fix card under a thread (plan r3 UI-FIX, docs/plans/thread-outcome.md): the run state with its log, the note of the run for the
// thread with its outcome, each proposed edit with a checkbox and its diff rows, the commit with Undo, and "Don't fix" with Undo.
// Dashed: a proposal. Solid: a commit holds the edits.
import {
  Ban,
  Check,
  CircleAlert,
  ClipboardCopy,
  Copy,
  GitCommitHorizontal,
  LoaderCircle,
  MessageSquareReply,
  ScrollText,
  Undo2,
  Wrench,
} from "lucide-react";
import { memo, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { type FixCommitDto, type FixEditDto, MAX_NOTE, type MetaDto, type ReviewItemDto } from "../../shared/dto";
import { Rows } from "../diff/FileDiff";
import { type PromptCopy, PromptNote, Text } from "../pr/Thread";
import { AiAvatar, Inline } from "../review/Drafts";
import { RUN_TEXT } from "../review/model";
import { type Hints, HintTrigger } from "../shell/Hint";
import { cardHead, cardKey, commitText, type FixState, type FixTarget, fetchCommands } from "./model";

export type FixCtx = {
  meta: MetaDto;
  hints: Hints;
  announce: (text: string) => void;
  onLog: (run: number) => void;
  onTick: (edit: number, on: boolean) => void;
  // target: the card to focus after the undo. null: the focus stays.
  onUndo: (c: FixCommitDto, target: FixTarget | null) => void;
  // "Don't fix": resolves to true when the server stored the decline.
  onDecline: (target: FixTarget, run: number, reason: string) => Promise<boolean>;
  onUndecline: (target: FixTarget, run: number) => void;
  // Fix again and Fix anyway: a new fix run for this target only. anyway: the run asks for edits despite the earlier note.
  onAgain: (target: FixTarget, anyway?: boolean) => void;
  // Copies the runner prompt of the thread. Resolves to the next step, or null.
  onPrompt: (thread: number) => Promise<PromptCopy | null>;
  // Moves the focus to the reply draft card of this review item.
  onDraft: (item: number) => void;
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

// The body of the "Won't fix" draft is this prefix and the reason. A draft body holds at most MAX_NOTE characters.
const WONT_FIX = "Won't fix: ";

// "Don't fix": the reason field. Ctrl+Enter declines. Esc closes the field.
function DeclineField(props: { id: string; finding: boolean; busy: boolean; onCancel: () => void; onSubmit: (reason: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [empty, setEmpty] = useState(false);
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const submit = () => {
    const reason = ref.current?.value.trim() ?? "";
    setEmpty(!reason);
    if (!reason) return ref.current?.focus();
    props.onSubmit(reason);
  };
  return (
    <Field data-invalid={empty || undefined} className="rl-indent mt-2.5 max-w-[60ch] gap-1.5">
      <FieldLabel htmlFor={props.id}>Why not fix it?</FieldLabel>
      <Textarea
        ref={ref}
        id={props.id}
        rows={2}
        aria-invalid={empty || undefined}
        onChange={() => empty && setEmpty(false)}
        maxLength={MAX_NOTE - WONT_FIX.length}
        spellCheck
        className="field-sizing-fixed min-h-[4.5em] resize-y bg-pane leading-normal"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            props.onCancel();
          } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <FieldDescription className="text-xs">
        {props.finding
          ? "The finding is discarded with this reason."
          : "Your reason becomes a “Won't fix” reply draft. It posts only after your Accept."}
      </FieldDescription>
      {empty && <FieldError className="text-xs">Type the reason first.</FieldError>}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" disabled={props.busy} aria-keyshortcuts="Control+Enter" title="Key: Ctrl+Enter" onClick={submit}>
          {props.busy ? (
            <LoaderCircle aria-hidden data-icon="inline-start" className="animate-spin" />
          ) : (
            <Ban aria-hidden data-icon="inline-start" />
          )}
          Don't fix
        </Button>
        <Button size="sm" variant="outline" title="Key: Esc" onClick={props.onCancel}>
          Cancel
        </Button>
        <span className="ml-1 text-xs text-muted-foreground">Ctrl+Enter declines. Esc cancels.</span>
      </div>
    </Field>
  );
}

// target: the thread or the finding of the card. ticks: the checkbox state of each free edit. busy: an undo of the commit of this card,
// or a decline or its undo, is out. draft: the reply draft that the note made (noteDraft). undecline: Undo of the decline can run.
export const FixCard = memo(function FixCard(props: {
  state: FixState;
  target: FixTarget;
  ticks: ReadonlyMap<number, boolean>;
  busy: boolean;
  draft: ReviewItemDto | null;
  undecline: boolean;
  ctx: FixCtx;
}) {
  const { state: s, target, ctx } = props;
  const key = cardKey(target);
  const short = ctx.meta.runner.short;
  // The reason field of "Don't fix", and the next step after Copy prompt.
  const [asking, setAsking] = useState(false);
  const [next, setNext] = useState<PromptCopy | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  // The running card answers Propose, often from a key, so it does not move. A card that a run result brings plays rl-enter.
  if (s.kind === "running") {
    return (
      <p
        id={`fx-${key}`}
        data-fix={key}
        tabIndex={-1}
        className="mt-3.5 mb-0 flex scroll-mt-3 items-center gap-2 rounded text-sm text-ink-2"
      >
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
  const declined = note?.declined;
  const why = declined ? null : (note?.why ?? null);
  const head = cardHead(edits.length, note);
  // decision and risk: the user chooses. The note reply names the options or the risk, and no reply draft holds it.
  const choose = why === "decision" || why === "risk";
  // Plan: the decline route refuses a fix that a commit holds.
  const proposal = edits.length > 0 && !commit && !declined;
  const draft = props.draft && (props.draft.status === "new" || props.draft.status === "accepted") ? props.draft : null;
  const drops = why === "dropped" ? (note?.drops ?? []) : [];
  // session-consult.md part D: the fix run of a session import. Its log is the log of the session run.
  const session = fix.run.consult?.run;
  const closeField = () => {
    setAsking(false);
    opener.current?.focus();
  };
  const decline = (reason: string) =>
    void ctx.onDecline(target, fix.run.id, reason).then((ok) => {
      if (ok) setAsking(false);
    });
  const actions = [
    draft && (
      <span key="draft" className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
        <MessageSquareReply aria-hidden className={icon} />
        Reply drafted
        <button type="button" className={linkish} onClick={() => ctx.onDraft(draft.id)}>
          Go to the draft
        </button>
      </span>
    ),
    declined && props.undecline && (
      <Button key="undecline" size="sm" variant="outline" disabled={props.busy} onClick={() => ctx.onUndecline(target, fix.run.id)}>
        {props.busy ? (
          <LoaderCircle aria-hidden data-icon="inline-start" className="animate-spin" />
        ) : (
          <Undo2 aria-hidden data-icon="inline-start" />
        )}
        Undo
      </Button>
    ),
    choose && (
      <Button key="anyway" size="sm" variant="outline" onClick={() => ctx.onAgain(target, true)}>
        <Wrench aria-hidden data-icon="inline-start" />
        Fix anyway
      </Button>
    ),
    why === "dropped" && (
      <Button key="again" size="sm" variant="outline" onClick={() => ctx.onAgain(target)}>
        <Wrench aria-hidden data-icon="inline-start" />
        Fix again
      </Button>
    ),
    why === "dropped" && target.kind === "thread" && (
      <Button key="prompt" size="sm" variant="outline" onClick={() => void ctx.onPrompt(target.id).then((r) => r && setNext(r))}>
        <ClipboardCopy aria-hidden data-icon="inline-start" />
        Copy prompt
      </Button>
    ),
    (choose || proposal) && (
      <Button
        key="dont"
        ref={opener}
        size="sm"
        variant="outline"
        aria-expanded={asking}
        aria-controls={asking ? `fxd-${key}` : undefined}
        onClick={() => setAsking((on) => !on)}
      >
        <Ban aria-hidden data-icon="inline-start" />
        Don't fix…
      </Button>
    ),
  ].filter(Boolean);
  return (
    <article
      id={`fx-${key}`}
      data-fix={key}
      data-fix-session={session !== undefined ? true : undefined}
      data-fix-outcome={declined ? "declined" : (why ?? (edits.length ? "proposed" : "none"))}
      tabIndex={-1}
      aria-label={`${head}, from ${session !== undefined ? "your session" : short}.${commit ? ` ${commit.state === "staged" ? "Staged" : "Committed"}.` : ""}`}
      className={cn(box, commit && "border-solid")}
    >
      <div className="flex min-h-(--av) flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
        <AiAvatar meta={ctx.meta} />
        <b className="font-semibold text-foreground">{short}</b>
        <span className={cn((declined || why) && "font-medium text-ink-2")}>{head}</span>
        {session !== undefined ? <span>from your session</span> : !newest && <span>from an earlier fix run</span>}
        <span className="ml-auto flex items-center">
          <LogButton run={session ?? fix.run.id} ctx={ctx} />
        </span>
      </div>
      {declined ? (
        <p className="rl-indent m-0 mt-px text-ink-2 [overflow-wrap:anywhere]">
          You declined the fix: <Inline text={declined.reason} />
        </p>
      ) : (
        note && (
          <p className="rl-indent m-0 mt-px text-ink-2 [overflow-wrap:anywhere]">
            <Inline text={note.reason} />
          </p>
        )
      )}
      {choose && note?.reply.trim() && (
        <div className="rl-indent mt-1.5 [overflow-wrap:anywhere]">
          <Text text={note.reply} />
        </div>
      )}
      {drops.length > 0 && (
        <ul aria-label="Why the edits could not be applied" className="rl-indent m-0 mt-1.5 grid list-none gap-0.5 p-0 text-xs text-ink-2">
          {drops.map((d) => (
            <li key={d} className="flex items-start gap-1.5 [overflow-wrap:anywhere]">
              <CircleAlert aria-hidden className="mt-px size-[13px] shrink-0" />
              <span>{d}</span>
            </li>
          ))}
        </ul>
      )}
      {!declined && edits.map((e) => <Edit key={e.id} e={e} free={!held.has(e.id)} ticked={props.ticks.get(e.id) ?? newest} ctx={ctx} />)}
      {commit && <Commit c={commit} target={target} busy={props.busy} ctx={ctx} />}
      {actions.length > 0 && <div className="rl-indent mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">{actions}</div>}
      {next && <PromptNote id={`fxp-${key}`} r={next} className="rl-indent" />}
      {asking && (choose || proposal) && (
        <div id={`fxd-${key}`}>
          <DeclineField
            id={`fxd-${key}-reason`}
            finding={target.kind === "finding"}
            busy={props.busy}
            onCancel={closeField}
            onSubmit={decline}
          />
        </div>
      )}
    </article>
  );
});
