// Ask section of the detail (plan r2 UI-ASK): one-shot questions about the PR and their answers, newest first.
// An answer is text only. It never becomes a draft, so nothing of it can post (BRIEF section 2).
import { useQueryClient } from "@tanstack/react-query";
import { Braces, CircleAlert, CircleStop, Copy, LoaderCircle, ScrollText, User } from "lucide-react";
import { Fragment, type KeyboardEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import type { AskDto, MetaDto, PrRow, RunKind } from "../../shared/dto";
import { MAX_QUESTION } from "../../shared/review";
import { Fold, FoldHead } from "../pr/Sections";
import { fullTime, Text } from "../pr/Thread";
import { agoLong } from "../pr/threads";
import { AiAvatar } from "../review/Drafts";
import { useBrief, useCancelRun, useRuns } from "../review/data";
import { clockDur, profileOf, shortHash, tokenText } from "../review/model";
import { Hint } from "../shell/Hint";
import { prKey } from "../shell/model";
import { useNow } from "../shell/Sidebar";
import { loadDraft, saveDraft, useAsks, useStartAsk } from "./data";
import { askCount, askView, busyText } from "./model";

const icon = "size-[15px] shrink-0";
const linkish =
  "inline-flex cursor-pointer items-center gap-1 rounded text-sm font-medium text-pen hover:underline disabled:cursor-default disabled:opacity-60";

function Elapsed({ from }: { from: number }) {
  const now = useNow(true);
  return <span>{clockDur(Math.max(0, now - from) / 1000)}</span>;
}

function Err({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-start gap-1.5 text-destructive">
      <CircleAlert aria-hidden className={cn(icon, "mt-0.5")} />
      <span>{children}</span>
    </span>
  );
}

// A blocked clipboard leaves the answer selected.
function copyAnswer(id: number, text: string) {
  void copyText(text).then((ok) => {
    if (ok) {
      toast.add({ title: "Copied the answer." });
      return;
    }
    const el = document.getElementById(`ask-${id}-a`);
    if (!el) return;
    const r = document.createRange();
    r.selectNodeContents(el);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(r);
    toast.add({ title: "The clipboard is blocked here. The answer is selected: press Ctrl+C to copy it." });
  });
}

export function AskPanel(props: {
  pr: PrRow;
  meta: MetaDto;
  now: number;
  open: boolean;
  onOpen: (open: boolean) => void;
  // The run log sheet of one run. raw: show its raw output.
  onLog: (run: number, raw?: boolean) => void;
  announce: (text: string) => void;
}) {
  const { pr, meta } = props;
  const runner = meta.runner.short;
  const qc = useQueryClient();
  const asks = useAsks(pr.id);
  const runs = useRuns().data;
  const brief = useBrief(pr.id).data;
  const start = useStartAsk(pr.id);
  const cancel = useCancelRun();
  const [text, setText] = useState(() => loadDraft(pr.id));
  const list = asks.data ?? [];

  const where = (id: number) => {
    if (id === pr.id) return "this pull request";
    const other = qc.getQueryData<PrRow[]>(["prs"])?.find((p) => p.id === id);
    return other ? prKey(other) : "another pull request";
  };
  const active = runs?.find((r) => r.status === "running") ?? null;
  // Only an open section shows the note.
  const busy = props.open && active ? busyText(runner, active.kind, where(active.pr)) : null;

  const change = (v: string) => {
    setText(v);
    saveDraft(pr.id, v);
  };
  const ask = () => {
    const question = text.trim();
    if (!question) {
      toast.add({ title: "Type a question first." });
      return;
    }
    if (start.isPending) return;
    start.mutate(question, {
      onSuccess: (r) => {
        if ("conflict" in r) {
          const kind: RunKind = runs?.find((x) => x.id === r.conflict.running.run)?.kind ?? "review";
          toast.add({ title: "The question was not sent", description: busyText(runner, kind, where(r.conflict.running.pr)) });
          return;
        }
        // Text typed while the request was out stays in the box.
        setText((t) => (t.trim() === question ? "" : t));
        props.announce(`Asked. ${runner} is answering.`);
      },
      onError: (e) => toast.add({ title: "The question was not sent", description: e.message }),
    });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      ask();
    }
  };

  return (
    <Fold id="ask" open={props.open} onOpen={props.onOpen} head={<FoldHead label={`Ask ${runner}`} n={askCount(list)} />}>
      <form
        className="grid max-w-[72ch] gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <Field className="gap-1.5">
          <FieldLabel htmlFor="ask-q" className="text-sm font-semibold">
            Your question
          </FieldLabel>
          <Textarea
            id="ask-q"
            rows={3}
            maxLength={MAX_QUESTION}
            spellCheck
            value={text}
            aria-describedby="ask-help"
            placeholder="For example: which callers of the changed function are not updated?"
            className="field-sizing-fixed resize-y bg-pane leading-normal"
            onChange={(e) => change(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <FieldDescription id="ask-help" className="text-xs">
            {runner} answers with the {profileOf(meta.profiles, brief?.profile ?? "general")?.name ?? ""} profile. The answer stays in
            Review Loop. Nothing posts to {meta.forge.name}.
          </FieldDescription>
        </Field>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Button type="submit" size="sm" disabled={start.isPending} aria-keyshortcuts="Control+Enter" title="Key: Ctrl+Enter">
            {start.isPending && <LoaderCircle aria-hidden data-icon="inline-start" className="animate-spin" />}
            Ask
          </Button>
          <span className="ml-1.5 text-xs text-muted-foreground">{busy ?? "Ctrl+Enter asks."}</span>
        </div>
      </form>
      {asks.error && (
        <p className="m-0 mt-3 text-sm">
          <Err>Cannot load the answers. {asks.error.message}</Err>
        </p>
      )}
      {list.length > 0 && (
        <ol aria-label="Answers" className="m-0 mt-4 mb-2.5 list-none p-0">
          {list.map((a) => (
            <Answer
              key={a.run.id}
              a={a}
              meta={meta}
              now={props.now}
              cancelling={cancel.isPending && cancel.variables === a.run.id}
              onLog={props.onLog}
              onCancel={() => cancel.mutate(a.run.id, { onError: (e) => toast.add({ title: "Cancel failed", description: e.message }) })}
            />
          ))}
        </ol>
      )}
    </Fold>
  );
}

function Answer(props: {
  a: AskDto;
  meta: MetaDto;
  now: number;
  cancelling: boolean;
  onLog: (run: number, raw?: boolean) => void;
  onCancel: () => void;
}) {
  const { a, meta } = props;
  const id = a.run.id;
  const v = askView(a, meta.runner.name);
  // The buttons of each answer name their question for screen readers.
  const about = `ask-${id}-q`;
  const log = (
    <button type="button" className={linkish} aria-describedby={about} onClick={() => props.onLog(id)}>
      <ScrollText aria-hidden className={icon} />
      View log
    </button>
  );
  let status: ReactNode;
  let actions: ReactNode;
  switch (v.kind) {
    case "running":
      status = (
        <>
          <span className="inline-flex items-center gap-1.5 text-foreground">
            <LoaderCircle aria-hidden className={cn(icon, "animate-spin motion-reduce:animate-none")} />
            Answering…
          </span>
          <Elapsed from={v.startedAt} />
        </>
      );
      actions = (
        <>
          {log}
          <button type="button" className={linkish} aria-describedby={about} disabled={props.cancelling} onClick={props.onCancel}>
            {props.cancelling ? "Cancelling…" : "Cancel"}
          </button>
        </>
      );
      break;
    case "answered":
      status = (
        <>
          <span className="text-foreground">
            {meta.runner.short} answered on{" "}
            <code translate="no" className="font-mono text-[0.95em]">
              {shortHash(a.run.sourceHead)}
            </code>
          </span>
          <Hint label={fullTime(v.at)}>
            <time dateTime={new Date(v.at).toISOString()}>{agoLong(v.at, props.now)}</time>
          </Hint>
          {v.tokens !== null && <span>{tokenText(v.tokens)}</span>}
        </>
      );
      actions = (
        <>
          {v.answer !== null && (
            <button type="button" className={linkish} aria-describedby={about} onClick={() => copyAnswer(id, v.answer ?? "")}>
              <Copy aria-hidden className={icon} />
              Copy
            </button>
          )}
          {log}
        </>
      );
      break;
    case "failed":
      status = <Err>{v.text}</Err>;
      actions = (
        <>
          {v.raw && (
            <button type="button" className={linkish} aria-describedby={about} onClick={() => props.onLog(id, true)}>
              <Braces aria-hidden className={icon} />
              Show raw output
            </button>
          )}
          {log}
        </>
      );
      break;
    default:
      status = (
        <span className="inline-flex items-center gap-1.5">
          <CircleStop aria-hidden className={icon} />
          You cancelled the question.
        </span>
      );
      actions = log;
  }
  return (
    <li id={`ask-${id}`} data-ask={id} className="grid grid-cols-[minmax(0,1fr)] gap-2 border-t py-3">
      <p className="m-0 flex gap-2">
        <User aria-hidden className={cn(icon, "mt-[3px] text-muted-foreground")} />
        <span id={about} className="min-w-0 font-medium whitespace-pre-line [overflow-wrap:anywhere]">
          <span className="sr-only">You asked: </span>
          {a.run.question}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
        <AiAvatar meta={meta} />
        <span role="status" className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          {status}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">{actions}</span>
      </div>
      {v.kind === "answered" && v.answer !== null && (
        <div id={`ask-${id}-a`} className="max-w-[72ch] pl-7 [overflow-wrap:anywhere]">
          <Text text={v.answer} />
        </div>
      )}
      {v.kind === "answered" && v.gaps.length > 0 && (
        <dl className="m-0 grid max-w-[72ch] grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 pl-7 text-xs text-muted-foreground">
          {v.gaps.map(([k, items]) => (
            <Fragment key={k}>
              <dt className="font-semibold">{k}</dt>
              <dd className="m-0 [overflow-wrap:anywhere]">{items.join(" ")}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </li>
  );
}
