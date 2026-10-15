// The Fix list (plan pr-view-v4 2.12, docs/plans/fix-ux.md Option A): one checkbox per open thread with a live message.
// "Propose fixes for K" starts one fix run with the ticked threads. Each reason that blocks the run shows as text.
import { CircleAlert, CircleCheck, ClipboardCopy, GitCommitHorizontal, Hourglass } from "lucide-react";
import { useRef } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { JudgementChip } from "../review/ReplyDraft";
import { dialogKeys } from "./CloneDialog";
import { type FixReason, type FixRow, type FixTargets, JUDGEMENT, leftOutText, NOTHING_TO_FIX } from "./model";

const icon = "size-[15px] shrink-0";

function Row({ r, ticked, onTick }: { r: FixRow; ticked: boolean; onTick: (thread: number, on: boolean) => void }) {
  const about = `fx-pick-${r.thread}-about`;
  return (
    <li className="border-b">
      <label className="grid cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-0.5 rounded px-1 py-2 hover:bg-hover">
        <input
          type="checkbox"
          className="m-0 mt-[3px] accent-foreground"
          checked={ticked}
          aria-label={`${r.who}, ${r.place}`}
          aria-describedby={about}
          onChange={(e) => onTick(r.thread, e.target.checked)}
        />
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1 text-sm">
          <b className="font-semibold">{r.who}</b>
          <code translate="no" className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]">
            {r.place}
          </code>
          {r.badge && (
            <Badge aria-hidden variant="quiet">
              {r.badge === "own" ? "Your comment" : "Posted finding"}
            </Badge>
          )}
        </span>
        {/* The description of the checkbox repeats this column for screen readers. */}
        <span aria-hidden className="justify-self-end text-xs text-muted-foreground">
          {r.fixed ? (
            <span className="inline-flex items-center gap-1 font-medium text-ink-2">
              <GitCommitHorizontal aria-hidden className="size-[13px] shrink-0" />
              Fixed in{" "}
              <code translate="no" className="font-mono">
                {r.fixed}
              </code>
            </span>
          ) : r.judgement ? (
            <JudgementChip j={r.judgement} />
          ) : (
            "No judgement yet"
          )}
        </span>
        <span id={about} className="col-span-2 col-start-2 truncate text-sm text-ink-2">
          <span className="sr-only">
            {r.fixed ? `Fixed in ${r.fixed}. ` : r.judgement ? `${JUDGEMENT[r.judgement]}. ` : "No judgement yet. "}
            {r.badge === "own" ? "Your comment. " : r.badge === "posted" ? "Posted finding. " : ""}
          </span>
          {r.text}
        </span>
      </label>
    </li>
  );
}

// prKey: "PROJ/repo #id". ticks: the ticked thread IDs. reason: fixReason for the current ticks. starting: the POST is out.
export function FixPicker(props: {
  open: boolean;
  prKey: string;
  targets: FixTargets;
  ticks: ReadonlySet<number>;
  reason: FixReason;
  starting: boolean;
  onTick: (thread: number, on: boolean) => void;
  onPropose: () => void;
  onClose: () => void;
}) {
  const { targets, reason } = props;
  const propose = useRef<HTMLButtonElement>(null);
  const blocked = reason.kind !== "ok";
  const rows = targets.rows;
  const left = leftOutText(targets);
  const k = rows.filter((r) => props.ticks.has(r.thread)).length;
  const ReasonIcon = reason.kind === "busy" ? Hourglass : CircleAlert;
  return (
    <Dialog open={props.open} onOpenChange={(on) => !on && props.onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[620px]"
        onKeyDown={dialogKeys(props.onClose)}
        initialFocus={rows.length > 0 && !blocked ? propose : true}
      >
        <DialogHeader>
          <DialogTitle>Fix comments on your pull request</DialogTitle>
          <DialogDescription>
            <span translate="no">{props.prKey}</span>. Pick the points to fix. Your clone stays untouched until you Apply.
          </DialogDescription>
        </DialogHeader>
        {rows.length ? (
          <div className="grid gap-1">
            <h3 className="m-0 flex items-baseline gap-2 text-xs font-semibold text-muted-foreground">
              Open threads <span className="font-medium">{rows.length}</span>
            </h3>
            <ul aria-label="Open threads" className="m-0 list-none border-t p-0">
              {rows.map((r) => (
                <Row key={r.thread} r={r} ticked={props.ticks.has(r.thread)} onTick={props.onTick} />
              ))}
            </ul>
            <p className="m-0 mt-1.5 text-xs text-muted-foreground">
              {left && `${left} `}A reply judgement of Valid or Partly valid ticks a thread at the start. Your own comments and posted
              findings start unticked.
            </p>
            <h3 className="m-0 mt-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              Review findings that you did not post
              <Badge variant="quiet">Planned</Badge>
            </h3>
          </div>
        ) : (
          <Alert role="note">
            <CircleCheck aria-hidden />
            <AlertTitle>{NOTHING_TO_FIX.title}</AlertTitle>
            <AlertDescription>
              {NOTHING_TO_FIX.text}
              {left && ` ${left}`}
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {rows.length > 0 && (
            <p id="fix-why" className="m-0 flex w-full items-start gap-1.5 text-sm text-muted-foreground">
              {blocked && <ReasonIcon aria-hidden className={`${icon} mt-0.5`} />}
              {reason.text}
            </p>
          )}
          {rows.length > 0 && (
            <Button
              ref={propose}
              id="fix-propose"
              disabled={blocked || props.starting}
              focusableWhenDisabled
              aria-describedby="fix-why"
              className="aria-disabled:cursor-default aria-disabled:opacity-50"
              onClick={props.onPropose}
            >
              Propose fixes for {k}
            </Button>
          )}
          <Button variant="outline" onClick={props.onClose}>
            {rows.length ? "Cancel" : "Close"}
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" disabled className="text-ink-2">
            <ClipboardCopy aria-hidden data-icon="inline-start" />
            Copy for your session
            <Badge variant="quiet">Planned</Badge>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
