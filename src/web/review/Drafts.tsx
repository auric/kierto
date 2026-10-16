// Drafts section (plan pr-view-v4 2.7, prototype pr-view-v4 drafts()): the findings and questions of the newest review run in one
// list of rows, with triage (WP14a). Only you see drafts until you post them. On your own PR, an open finding has Fix and its fix
// card (docs/plans/fix-ux.md phase 2).
import { Check, ChevronRight, CircleAlert, FileCode, GitCommitHorizontal, MessageCircleQuestionMark, Wrench } from "lucide-react";
import { memo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MetaDto, ReviewItemDto, RunDto } from "../../shared/dto";
import type { AnchoredFinding, Question } from "../../shared/review";
import { Text } from "../pr/Thread";
import { snippet } from "../pr/threads";
import {
  anchorNote,
  carriedNote,
  closedLabel,
  DROP_REASON,
  draftExcerpt,
  EVIDENCE,
  fixedNote,
  lineText,
  SEVERITY,
  sessionNote,
} from "./model";
import { Acts, Editor, Mover, type TriageCtx, type TriageMode } from "./Triage";

const icon = "size-[15px] shrink-0";
const base = (path: string) => path.slice(path.lastIndexOf("/") + 1);

// Backticks become code. The text is the runner's output, so nothing else renders as markup.
export function Inline({ text }: { text: string }) {
  return text.split(/(`[^`\n]+`)/).map((part, i) =>
    part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one text keep their order.
      <code key={i} className="rounded-[3px] bg-sunken px-[3px] font-mono text-[0.9em]">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

export function AiAvatar({ meta }: { meta: MetaDto }) {
  return (
    <span aria-hidden className="rl-av" data-ai>
      {meta.runner.initials}
    </span>
  );
}

export function Severity({ s }: { s: AnchoredFinding["severity"] }) {
  // Hue rule: the error hue marks only errors and Blocker findings.
  return s === "blocker" ? (
    <span className="inline-flex shrink-0 items-center gap-1 font-semibold whitespace-nowrap text-destructive">
      <CircleAlert aria-hidden className={icon} />
      {SEVERITY[s]}
    </span>
  ) : (
    <span className="shrink-0 font-semibold whitespace-nowrap text-ink-2">{SEVERITY[s]}</span>
  );
}

const SIGN = { add: "+", del: "−", ctx: " " } as const;

function Lines({ lines }: { lines: ReturnType<typeof draftExcerpt> }) {
  return lines.map((l) => (
    <span key={`${l.kind}${l.n}`} className="rl-cl" data-k={l.kind} data-hit={l.hit || undefined}>
      <span className="rl-no">{l.n}</span>
      <span className="rl-sg">{SIGN[l.kind]}</span>
      <span>{l.text}</span>
    </span>
  ));
}

// asker: the person that the questions ask, as the question rows name them.
export type DraftCtx = {
  meta: MetaDto;
  asker: string;
  onToggle: (id: number) => void;
  onFrom: (agent: string) => void;
  // Plan r2 UI-DIFF: focuses the line of the draft in the diff.
  onShowInDiff: (id: number) => void;
  // Your own PR: opens the Fix list with only this finding ticked. null: a PR of another author.
  onFix: ((id: number) => void) | null;
  triage: TriageCtx;
};

// The ID of the row element. The diff, the ledger, and the keys focus it.
export const draftDomId = (it: ReviewItemDto) => (it.kind === "question" ? `q-${it.id}` : `d-${it.id}`);

// One row: kind, title, place, and state. Enter, o, or a click opens the body with the triage actions (plan pr-view-v4 2.7).
// mode: the open editor or line field of this draft. busy: a triage request of this draft is out. fix: the fix card of the finding.
export const Draft = memo(function Draft({
  it,
  open,
  mode,
  busy,
  fix,
  ctx,
}: {
  it: ReviewItemDto;
  open: boolean;
  mode: TriageMode;
  busy: boolean;
  fix?: ReactNode;
  ctx: DraftCtx;
}) {
  const short = ctx.meta.runner.short;
  const f = it.kind === "finding" ? (it.payload as AnchoredFinding) : null;
  // A re-review drops the anchor of a finding whose code is gone. The row then names the place that the base run showed.
  const a = f ? (it.anchor ?? f.anchor) : null;
  const path = f ? (a?.path ?? f.path) : null;
  const line = f ? (a ? lineText(a) : String(f.line)) : null;
  const where = path && `${base(path)}:${line}`;
  const closed = it.status === "discarded" ? closedLabel(it) : null;
  const accepted = it.status === "accepted";
  const carried = carriedNote(it);
  const restored = fixedNote(it);
  const label = !f
    ? closed
      ? "Discarded question"
      : `Question from ${short}${accepted ? ", accepted" : ""}`
    : closed
      ? closed === "Discarded"
        ? `Discarded draft. ${where}.`
        : `Draft, ${closed.toLowerCase()}. ${where}.`
      : `Draft from ${short}. ${SEVERITY[f.severity]}. ${where}.${accepted ? " Accepted." : ""}${carried ? ` ${carried}` : ""}${restored ? ` ${restored}` : ""}`;
  const cut = path ? path.lastIndexOf("/") + 1 : 0;
  return (
    <article
      id={draftDomId(it)}
      data-draft={f ? it.id : undefined}
      data-draft-question={f ? undefined : it.id}
      data-item={it.id}
      tabIndex={-1}
      aria-label={label}
      className={cn("scroll-mt-3 border-b", !closed && "rl-enter")}
    >
      <button
        id={`dh-${it.id}`}
        data-row-head
        type="button"
        aria-expanded={open}
        aria-controls={`db-${it.id}`}
        onClick={() => ctx.onToggle(it.id)}
        className="grid min-h-[38px] w-full cursor-pointer grid-cols-[16px_84px_minmax(0,1fr)_auto] items-center gap-2 rounded px-1.5 py-[7px] text-left text-sm hover:bg-hover"
      >
        <ChevronRight aria-hidden className={cn("rl-chev", icon)} />
        <span className="text-xs">
          {f ? (
            <Severity s={f.severity} />
          ) : (
            <span className="inline-flex items-center gap-1 font-semibold whitespace-nowrap text-ink-2">
              <MessageCircleQuestionMark aria-hidden className="size-[13px] shrink-0" />
              Question
            </span>
          )}
        </span>
        <span className="grid min-w-0">
          <span className={cn("truncate", closed && "text-muted-foreground line-through")}>{snippet(it.body, 160)}</span>
          {path && (
            <span translate="no" className="truncate font-mono text-xs text-muted-foreground">
              {path.slice(0, cut)}
              <span className="text-ink-2">{path.slice(cut)}</span>:{line}
            </span>
          )}
        </span>
        {it.status === "discarded" && it.payload.fixed ? (
          <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
            <GitCommitHorizontal aria-hidden className="size-[13px] shrink-0" />
            Fixed in{" "}
            <code translate="no" className="font-mono">
              {it.payload.fixed.short}
            </code>
          </span>
        ) : closed ? (
          <span className="text-xs whitespace-nowrap text-muted-foreground">{closed}</span>
        ) : accepted ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap text-ink-2">
            <Check aria-hidden className="size-[13px] shrink-0" />
            Accepted
          </span>
        ) : null}
      </button>
      <div id={`db-${it.id}`} hidden={!open}>
        {open &&
          (f ? (
            <FindingBody it={it} mode={mode} busy={busy} fix={fix} ctx={ctx} />
          ) : (
            <QuestionBody it={it} mode={mode} busy={busy} ctx={ctx} />
          ))}
      </div>
    </article>
  );
});

// The body lines up with the kind column of the row.
const body = "pt-1 pr-1.5 pb-4 pl-[30px]";
const note = "m-0 mt-1.5 max-w-[72ch] text-xs text-muted-foreground [overflow-wrap:anywhere]";

function FindingBody({ it, mode, busy, fix, ctx }: { it: ReviewItemDto; mode: TriageMode; busy: boolean; fix: ReactNode; ctx: DraftCtx }) {
  const f = it.payload as AnchoredFinding;
  const a = it.anchor;
  const lines = a ? draftExcerpt(a) : [];
  const anchored = anchorNote(it);
  const carried = carriedNote(it);
  const restored = fixedNote(it);
  const session = sessionNote(it);
  const onFix = ctx.onFix;
  // Acts shows lead only for a draft that is not discarded. jobs.ts fixFindings also needs the anchor.
  const toFix = onFix && a && (
    <Button size="sm" variant="outline" disabled={busy} title="Key: f" aria-keyshortcuts="f" onClick={() => onFix(it.id)}>
      <Wrench aria-hidden data-icon="inline-start" />
      Fix
    </Button>
  );
  const at = a ? `${a.path} line ${lineText(a)}` : f.path;
  const toDiff = a && (
    <button
      type="button"
      title="Key: g d"
      aria-keyshortcuts="g d"
      className="ml-1 inline-flex cursor-pointer items-center gap-1 rounded text-sm font-medium text-pen hover:underline"
      onClick={() => ctx.onShowInDiff(it.id)}
    >
      <FileCode aria-hidden className={icon} />
      Show in diff
    </button>
  );
  return (
    <div className={body}>
      {lines.length > 0 && (
        <figure
          className="rl-code m-0 mb-2.5"
          aria-label={`Code at ${at}${a?.state === "outside" ? ", from the snapshot, outside the diff" : ""}`}
        >
          <pre className="rl-pre">
            <Lines lines={lines} />
          </pre>
        </figure>
      )}
      {mode === "edit" && it.status !== "discarded" ? (
        <Editor it={it} busy={busy} flush ctx={ctx.triage} />
      ) : (
        <>
          <div className="max-w-[72ch] [overflow-wrap:anywhere]">
            <Text text={it.body} />
          </div>
          <div className={note}>
            <Text text={`${EVIDENCE[f.evidenceStatus]}, ${f.confidence} confidence.${f.evidence.trim() ? ` ${f.evidence.trim()}` : ""}`} />
          </div>
          <p className={cn(note, "flex flex-wrap items-center gap-x-3 gap-y-0.5")}>
            <span>{f.category}</span>
            {f.agent && (
              <button
                type="button"
                title="Open the run log at this agent"
                className="inline-flex cursor-pointer items-center rounded hover:text-foreground hover:underline"
                onClick={() => ctx.onFrom(f.agent as string)}
              >
                from {f.agent}
              </button>
            )}
            {it.edited && <span>Edited by you</span>}
          </p>
          {carried && <p className={note}>{carried}</p>}
          {restored && <p className={note}>{restored}</p>}
          {session && (
            <p className={note} data-session-note>
              <Inline text={session} />
            </p>
          )}
          {anchored && <p className={note}>{anchored}</p>}
          {mode === "move" ? (
            <Mover it={it} busy={busy} ctx={ctx.triage} />
          ) : (
            <Acts it={it} busy={busy} flush ctx={ctx.triage} lead={toFix}>
              {toDiff}
            </Acts>
          )}
        </>
      )}
      {fix}
    </div>
  );
}

// prototype pr-view-v4 draft 14. The body is the question as it will post. why stays as the runner wrote it.
// publish/plan.ts generalText puts the questions into one general comment.
function QuestionBody({ it, mode, busy, ctx }: { it: ReviewItemDto; mode: TriageMode; busy: boolean; ctx: DraftCtx }) {
  const p = it.payload as Question;
  return (
    <div className={body}>
      {mode === "edit" && it.status !== "discarded" ? (
        <Editor it={it} busy={busy} flush ctx={ctx.triage} />
      ) : (
        <>
          <p className="m-0 max-w-[72ch] [overflow-wrap:anywhere]">
            <Inline text={it.body} />
          </p>
          <p className="m-0 mt-1 max-w-[72ch] text-ink-2 [overflow-wrap:anywhere]">
            <Inline text={p.why} />
          </p>
          <p className={note}>A question for {ctx.asker}. It posts as a general comment.</p>
          <Acts it={it} busy={busy} flush ctx={ctx.triage} />
        </>
      )}
    </div>
  );
}

// open: the item with an open editor or line field. quiet: the editor opened again with its unsent text when the PR opened.
// busy: items with a triage request out.
export type TriageState = {
  open: { id: number; mode: Exclude<TriageMode, null>; quiet?: boolean } | null;
  busy: ReadonlySet<number>;
};
export const modeOf = (s: TriageState, id: number): TriageMode => (s.open?.id === id ? s.open.mode : null);

// items: the findings, then the questions, of the newest review run. The count leaves out the discarded ones.
// cards: the fix card of each finding, keyed by item ID.
export function Drafts({
  items,
  isOpen,
  triage,
  cards,
  ctx,
}: {
  items: ReviewItemDto[];
  isOpen: (it: ReviewItemDto) => boolean;
  triage: TriageState;
  cards: ReadonlyMap<number, ReactNode>;
  ctx: DraftCtx;
}) {
  if (!items.length) return null;
  return (
    <section id="s-drafts" aria-labelledby="h-drafts" className="max-w-[86ch] scroll-mt-3 pt-6">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="h-drafts" className="m-0 flex items-baseline gap-2 text-[15px] font-bold tracking-[-0.005em]">
          Drafts
          <span className="text-sm font-medium text-muted-foreground">{items.filter((i) => i.status !== "discarded").length}</span>
        </h2>
        <p className="m-0 text-xs text-muted-foreground">Only you see drafts until you post them.</p>
      </div>
      <ol className="m-0 list-none border-t p-0">
        {items.map((it) => {
          const mode = modeOf(triage, it.id);
          return (
            <li key={it.id}>
              <Draft
                it={it}
                open={isOpen(it) || mode !== null}
                mode={mode}
                busy={triage.busy.has(it.id)}
                fix={cards.get(it.id)}
                ctx={ctx}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function Dropped({ run, meta }: { run: RunDto; meta: MetaDto }) {
  const d = run.summary?.dropped ?? [];
  return (
    <>
      {d.length === 1 ? "1 finding dropped: its code reference" : `${d.length} findings dropped: their code references`} did not match the
      snapshot.
      <details className="mt-0.5">
        <summary className="inline-flex rounded font-medium text-pen hover:underline">Show {d.length === 1 ? "it" : "them"}</summary>
        {d.map((x, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: dropped findings have no ID.
          <div key={i} className="mt-1.5 mb-0.5 border-l border-rule-strong pl-2.5">
            <p className="m-0 mt-1.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              From {x.agent ?? meta.runner.short}. It quoted{" "}
              <code className="rounded-[3px] bg-sunken px-[3px] font-mono">{snippet(x.anchorText, 120)}</code> at{" "}
              <code className="rounded-[3px] bg-sunken px-[3px] font-mono">
                {base(x.path)}:{x.line}
              </code>
              . {DROP_REASON[x.reason]}
            </p>
            <div className="max-w-[72ch] [overflow-wrap:anywhere]">
              <Text text={x.body} />
            </div>
          </div>
        ))}
      </details>
    </>
  );
}
