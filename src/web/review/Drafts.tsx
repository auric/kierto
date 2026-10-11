// Drafts and the runner's summary (prototype/v3 threadsSec drafts, draft, draftBody, aiSummary, question), with triage (WP14a).
import { Bot, Check, ChevronRight, CircleAlert, FileCode, User } from "lucide-react";
import { Fragment, memo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MetaDto, PrRow, ReviewItemDto, RunDto } from "../../shared/dto";
import type { AnchoredFinding, Question } from "../../shared/review";
import { Text } from "../pr/Thread";
import { snippet, splitExcerpt } from "../pr/threads";
import { type Hints, HintTrigger } from "../shell/Hint";
import { useTaskContext } from "./Brief";
import {
  anchorNote,
  carriedNote,
  closedLabel,
  coverageRows,
  DROP_REASON,
  draftExcerpt,
  EVIDENCE,
  lineText,
  plural,
  SEVERITY,
} from "./model";
import { Acts, Editor, Mover, RestoreButton, type TriageCtx, type TriageMode } from "./Triage";
import { contextLines, trackerOf } from "./tasks";

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

export type DraftCtx = {
  meta: MetaDto;
  hints: Hints;
  onToggle: (id: number) => void;
  onFrom: (agent: string) => void;
  // Plan r2 UI-DIFF: focuses the line of the draft in the diff.
  onShowInDiff: (id: number) => void;
  triage: TriageCtx;
};

// mode: the open editor or line field of this draft. busy: a triage request of this draft is out.
export const Draft = memo(function Draft({
  it,
  open,
  mode,
  busy,
  ctx,
}: {
  it: ReviewItemDto;
  open: boolean;
  mode: TriageMode;
  busy: boolean;
  ctx: DraftCtx;
}) {
  const f = it.payload as AnchoredFinding;
  // A re-review drops the anchor of a finding whose code is gone. The row then names the place that the base run showed.
  const a = it.anchor ?? f.anchor;
  const path = a?.path ?? f.path;
  const where = `${base(path)}:${a ? lineText(a) : f.line}`;
  const short = ctx.meta.runner.short;
  const carried = carriedNote(it);
  if (it.status === "discarded") {
    const closed = closedLabel(it);
    return (
      <article
        id={`d-${it.id}`}
        data-draft={it.id}
        data-item={it.id}
        tabIndex={-1}
        aria-label={closed === "Discarded" ? `Discarded draft. ${where}.` : `Draft, ${closed.toLowerCase()}. ${where}.`}
        className="scroll-mt-3 border-b"
      >
        <div className="flex min-w-0 items-center gap-2">
          <p className="rl-fade m-0 flex min-w-0 flex-1 items-center gap-3 px-1.5 py-2 text-sm text-muted-foreground">
            <span translate="no" className="shrink-0 font-mono">
              {where}
            </span>
            <span className="min-w-0 truncate">
              {closed}: {snippet(it.body, 140)}
            </span>
          </p>
          {/* items.ts refuses Restore for a finding without an anchor: a re-review found its code gone. */}
          {it.anchor && <RestoreButton it={it} busy={busy} ctx={ctx.triage} />}
        </div>
      </article>
    );
  }
  const accepted = it.status === "accepted" && (
    <span className="rl-fade inline-flex shrink-0 items-center gap-1 font-medium text-ink-2">
      <Check aria-hidden className={icon} />
      Accepted
    </span>
  );
  return (
    <article
      id={`d-${it.id}`}
      data-draft={it.id}
      data-item={it.id}
      tabIndex={-1}
      aria-label={`Draft from ${short}. ${SEVERITY[f.severity]}. ${where}.${it.status === "accepted" ? " Accepted." : ""}${carried ? ` ${carried}` : ""}`}
      className="rl-enter scroll-mt-3 border-b"
    >
      <div className="flex items-center gap-0.5">
        <button
          id={`dh-${it.id}`}
          type="button"
          aria-expanded={open}
          aria-controls={`db-${it.id}`}
          onClick={() => ctx.onToggle(it.id)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded px-1.5 py-2 text-left text-sm text-muted-foreground hover:bg-hover"
        >
          <HintTrigger hints={ctx.hints} label={path}>
            <span translate="no" className="min-w-0 shrink truncate font-mono text-foreground">
              {base(path)}
              <span className="text-muted-foreground">:{a ? lineText(a) : f.line}</span>
            </span>
          </HintTrigger>
          {!open && (
            <>
              <Severity s={f.severity} />
              <span className="rl-wide-pane min-w-0 flex-1 truncate text-ink-2">{snippet(it.body, 160)}</span>
            </>
          )}
          {accepted}
          <ChevronRight aria-hidden className={cn("rl-chev ml-auto", icon)} />
        </button>
        <span className="w-[30px] flex-none" />
      </div>
      <div id={`db-${it.id}`} hidden={!open} className="px-1.5 pt-0.5 pb-4">
        {open && <DraftBody it={it} mode={mode} busy={busy} ctx={ctx} />}
      </div>
    </article>
  );
});

function DraftBody({ it, mode, busy, ctx }: { it: ReviewItemDto; mode: TriageMode; busy: boolean; ctx: DraftCtx }) {
  const f = it.payload as AnchoredFinding;
  const a = it.anchor;
  const lines = a ? draftExcerpt(a) : [];
  const { head, tail } = splitExcerpt(lines);
  const note = anchorNote(it);
  const carried = carriedNote(it);
  const outside = a?.state === "outside";
  const at = a ? `${a.path} line ${lineText(a)}` : f.path;
  const short = ctx.meta.runner.short;
  const msg = (
    <ol className="rl-tree">
      <li>
        <article aria-label={`${short}, ${SEVERITY[f.severity]}, ${f.category}${f.agent ? `, from ${f.agent}` : ""}`} className="rl-msg">
          <div className="flex min-h-(--av) flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
            <AiAvatar meta={ctx.meta} />
            <b className="font-semibold text-foreground">{short}</b>
            <Severity s={f.severity} />
            <span>{f.category}</span>
            {f.agent && (
              <button
                type="button"
                title="Open the run log at this agent"
                className="inline-flex cursor-pointer items-center rounded text-xs text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => ctx.onFrom(f.agent as string)}
              >
                from {f.agent}
              </button>
            )}
            {it.edited && <span>edited by you</span>}
            {a && (
              <Button size="sm" variant="ghost" className="-my-1 ml-auto text-ink-2" onClick={() => ctx.onShowInDiff(it.id)}>
                <FileCode aria-hidden data-icon="inline-start" />
                Show in diff
              </Button>
            )}
          </div>
          {mode === "edit" ? (
            <Editor it={it} busy={busy} ctx={ctx.triage} />
          ) : (
            <>
              <div className="rl-indent mt-px max-w-[72ch] [overflow-wrap:anywhere]">
                <Text text={it.body} />
              </div>
              <div className="rl-indent mt-2 max-w-[72ch] text-xs text-muted-foreground [overflow-wrap:anywhere]">
                <Text
                  text={`${EVIDENCE[f.evidenceStatus]}, ${f.confidence} confidence.${f.evidence.trim() ? ` ${f.evidence.trim()}` : ""}`}
                />
              </div>
              {carried && <p className="rl-indent m-0 mt-2 text-xs text-muted-foreground">{carried}</p>}
              {note && <p className="rl-indent m-0 mt-2 text-xs text-muted-foreground">{note}</p>}
              {mode === "move" ? <Mover it={it} busy={busy} ctx={ctx.triage} /> : <Acts it={it} busy={busy} ctx={ctx.triage} />}
            </>
          )}
        </article>
      </li>
    </ol>
  );
  if (!head.length) return <div className="rl-disc">{msg}</div>;
  return (
    <>
      <figure
        className={cn("rl-code m-0", tail.length > 0 && "rl-head")}
        aria-label={`Code at ${at}${outside ? ", from the snapshot, outside the diff" : ""}`}
      >
        <pre className="rl-pre">
          <Lines lines={head} />
        </pre>
      </figure>
      <div className="rl-disc rl-anchored">{msg}</div>
      {tail.length > 0 && (
        <figure className="rl-code rl-tail m-0" aria-label={`Code after line ${a?.lineEnd ?? ""}`.trim()}>
          <pre className="rl-pre">
            <Lines lines={tail} />
          </pre>
        </figure>
      )}
    </>
  );
}

// The drafts group sits above the threads. Only you see drafts until you post them.
// open: the item with an open editor or line field. busy: items with a triage request out.
export type TriageState = { open: { id: number; mode: Exclude<TriageMode, null> } | null; busy: ReadonlySet<number> };
export const modeOf = (s: TriageState, id: number): TriageMode => (s.open?.id === id ? s.open.mode : null);

export function Drafts({
  items,
  isOpen,
  triage,
  ctx,
}: {
  items: ReviewItemDto[];
  isOpen: (it: ReviewItemDto) => boolean;
  triage: TriageState;
  ctx: DraftCtx;
}) {
  if (!items.length) return null;
  return (
    <div id="g-drafts" className="mt-5">
      <h3 className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-1.5 pb-1.5 text-sm font-bold">
        <span className="inline-flex items-center gap-1.5">
          <Bot aria-hidden className={cn(icon, "text-ink-2")} />
          Drafts from {ctx.meta.runner.short}
        </span>
        <span className="font-medium text-muted-foreground">{items.length}</span>
        <span className="ml-auto text-xs font-normal text-muted-foreground">Only you see drafts until you post them.</span>
      </h3>
      {items.map((it) => {
        const mode = modeOf(triage, it.id);
        return <Draft key={it.id} it={it} open={isOpen(it) || mode !== null} mode={mode} busy={triage.busy.has(it.id)} ctx={ctx} />;
      })}
    </div>
  );
}

const h3 = "m-0 mt-3 mb-1 text-sm font-semibold";

// The runner's summary: one line when closed. Risk areas, coverage, dropped findings, and questions when open.
export function AiSummary(props: {
  run: RunDto;
  items: ReviewItemDto[];
  pr: PrRow;
  meta: MetaDto;
  open: boolean;
  onOpen: (open: boolean) => void;
  triage: TriageState;
  ctx: TriageCtx;
}) {
  const { run, meta, pr } = props;
  const fetched = useTaskContext(pr.id).data ?? [];
  const s = run.summary;
  if (!s) return null;
  const qs = props.items.filter((i) => i.kind === "question" && i.status !== "posted");
  const asker = pr.role === "AUTHOR" ? "the author" : ((pr.authorName ?? pr.authorSlug ?? "the author").split(/\s+/)[0] ?? "the author");
  const rows: [string, ReactNode][] = [];
  if (pr.tasks.length)
    rows.push([
      "Task",
      pr.tasks.map((t, i) => (
        <Fragment key={t.key}>
          {i > 0 && ", "}
          <code translate="no" className="font-mono text-[0.9em]">
            {t.key}
          </code>{" "}
          from the {t.source}
        </Fragment>
      )),
    ]);
  if (run.note.trim())
    rows.push([
      "Your note",
      <span key="note" className="flex gap-1.5 whitespace-pre-line [overflow-wrap:anywhere]">
        <User aria-hidden className={cn(icon, "mt-0.5 text-muted-foreground")} />
        <span>{run.note}</span>
      </span>,
    ]);
  for (const [k, v] of coverageRows(s.coverage))
    rows.push([
      k,
      <ul key={k} className="m-0 list-none p-0">
        {v.map((x) => (
          <li key={x} className="[overflow-wrap:anywhere]">
            <Inline text={x} />
          </li>
        ))}
      </ul>,
    ]);
  const tracker = trackerOf(meta);
  const context = tracker ? contextLines(fetched, run, tracker.name, Date.now()) : [];
  if (context.length)
    rows.push([
      "Context",
      <ul key="context" className="m-0 list-none p-0">
        {context.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>,
    ]);
  else rows.push(["Context", tracker?.configured ? "No task text fetched." : "No context source is set up."]);
  if (s.dropped.length) rows.push(["Dropped", <Dropped key="dropped" run={run} meta={meta} />]);
  return (
    <details id="ai-sum" open={props.open} onToggle={(e) => props.onOpen(e.currentTarget.open)} className="group mb-1 w-full max-w-[72ch]">
      <summary id="ai-sum-head" className="-ml-1.5 rounded px-1.5 py-[5px] hover:bg-hover">
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <AiAvatar meta={meta} />
          <b className="flex-none font-semibold">{meta.runner.short}'s summary</b>
          <span className="min-w-0 flex-1 truncate text-ink-2 group-open:whitespace-normal">
            <Inline text={s.summary} />
          </span>
          {qs.length > 0 && <span className="flex-none text-muted-foreground">{plural(qs.length, "question")}</span>}
          <ChevronRight aria-hidden className={cn("rl-chev flex-none text-muted-foreground", icon)} />
        </span>
      </summary>
      <div className="pt-0.5 pb-1.5 pl-7 text-sm">
        {s.risks.length > 0 && (
          <>
            <h3 className={h3}>Risk areas</h3>
            <ul className="m-0 list-disc pl-[18px]">
              {s.risks.map((r) => (
                <li key={r}>
                  <Inline text={r} />
                </li>
              ))}
            </ul>
          </>
        )}
        <h3 className={h3}>Coverage</h3>
        <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3.5 gap-y-1">
          {rows.map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="m-0 min-w-0">{v}</dd>
            </Fragment>
          ))}
        </dl>
        {qs.length > 0 && (
          <>
            <h3 className={h3}>Questions for {asker}</h3>
            <div>
              {qs.map((q) => (
                <QuestionItem
                  key={q.id}
                  q={q}
                  meta={meta}
                  mode={modeOf(props.triage, q.id)}
                  busy={props.triage.busy.has(q.id)}
                  ctx={props.ctx}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </details>
  );
}

// prototype/v3 question(). The body is the question as it will post. why stays as the runner wrote it.
function QuestionItem({ q, meta, mode, busy, ctx }: { q: ReviewItemDto; meta: MetaDto; mode: TriageMode; busy: boolean; ctx: TriageCtx }) {
  const p = q.payload as Question;
  const head = { id: `q-${q.id}`, "data-item": q.id, tabIndex: -1, className: "scroll-mt-3 border-b px-1.5 py-2.5 first:border-t" };
  if (q.status === "discarded") {
    return (
      <article {...head} aria-label="Discarded question" className={cn(head.className, "flex items-center gap-2 py-1.5")}>
        <p className="m-0 min-w-0 flex-1 truncate text-sm text-muted-foreground">Discarded: {snippet(q.body, 140)}</p>
        <RestoreButton it={q} busy={busy} ctx={ctx} />
      </article>
    );
  }
  return (
    <article {...head} aria-label={`Question from ${meta.runner.short}${q.status === "accepted" ? ", accepted" : ""}`}>
      {mode === "edit" ? (
        <Editor it={q} busy={busy} flush ctx={ctx} />
      ) : (
        <>
          <p className="m-0 text-base font-medium">
            <Inline text={q.body} />
          </p>
          <p className="m-0 mt-0.5 text-ink-2">
            <Inline text={p.why} />
          </p>
          <Acts it={q} busy={busy} showState flush ctx={ctx} />
        </>
      )}
    </article>
  );
}

function Dropped({ run, meta }: { run: RunDto; meta: MetaDto }) {
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
