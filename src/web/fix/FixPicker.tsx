// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The Fix list (plan pr-view-v4 2.12, docs/plans/fix-ux.md Option A): one checkbox per open thread with a live message, and one per
// open review finding that you did not post. "Propose fixes for K" starts one fix run with the ticked rows. Each reason that blocks
// the run shows as text.
import { Check, CircleAlert, CircleCheck, ClipboardCopy, GitCommitHorizontal, Hourglass } from "lucide-react";
import { useRef } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Severity } from "../review/Drafts";
import { SEVERITY } from "../review/model";
import { JudgementChip } from "../review/ReplyDraft";
import { dialogKeys } from "./CloneDialog";
import {
  cardKey,
  type FixFindingRow,
  type FixOutcome,
  type FixReason,
  type FixRow,
  type FixTargets,
  JUDGEMENT,
  leftOutText,
  NOTHING_TO_FIX,
  outcomeText,
} from "./model";

const icon = "size-[15px] shrink-0";
const rowBox = "grid cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-0.5 rounded px-1 py-2 hover:bg-hover";
const groupHead = "m-0 flex items-baseline gap-2 text-xs font-semibold text-muted-foreground";

type Tick = (key: string, on: boolean) => void;

// docs/plans/thread-outcome.md: the fix outcome of a row. A commit outcome names its short hash.
function Outcome({ o }: { o: FixOutcome }) {
  return (
    <span data-outcome className="inline-flex items-center gap-1 font-medium text-ink-2">
      {o.short && <GitCommitHorizontal aria-hidden className="size-[13px] shrink-0" />}
      {o.label}
      {o.short && (
        <>
          {" "}
          <code translate="no" className="font-mono">
            {o.short}
          </code>
        </>
      )}
    </span>
  );
}

const fixedIn = (short: string): FixOutcome => ({ label: "Fixed in", short, noFix: false });

function Row({ r, ticked, onTick }: { r: FixRow; ticked: boolean; onTick: Tick }) {
  const about = `fx-pick-${r.thread}-about`;
  const outcome = r.outcome ?? (r.fixed ? fixedIn(r.fixed) : null);
  return (
    <li className="border-b">
      <label className={rowBox}>
        <input
          type="checkbox"
          className="m-0 mt-[3px] accent-foreground"
          checked={ticked}
          aria-label={`${r.who}, ${r.place}`}
          aria-describedby={about}
          onChange={(e) => onTick(cardKey({ kind: "thread", id: r.thread }), e.target.checked)}
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
          {outcome ? <Outcome o={outcome} /> : r.judgement ? <JudgementChip j={r.judgement} /> : "No judgement yet"}
        </span>
        <span id={about} className="col-span-2 col-start-2 truncate text-sm text-ink-2">
          <span className="sr-only">
            {outcome ? `${outcomeText(outcome)}. ` : r.judgement ? `${JUDGEMENT[r.judgement]}. ` : "No judgement yet. "}
            {r.badge === "own" ? "Your comment. " : r.badge === "posted" ? "Posted finding. " : ""}
          </span>
          {r.text}
        </span>
      </label>
    </li>
  );
}

// One open finding: severity, place, and state, then the title. The state explains the tick at the start.
function FindingRow({ r, ticked, onTick }: { r: FixFindingRow; ticked: boolean; onTick: Tick }) {
  const about = `fx-pick-f${r.finding}-about`;
  const outcome = r.outcome ?? (r.fixed ? fixedIn(r.fixed) : null);
  const state = outcome ? `${outcomeText(outcome)}.` : r.accepted ? "Accepted." : "Not accepted yet.";
  return (
    <li className="border-b">
      <label className={rowBox}>
        <input
          type="checkbox"
          className="m-0 mt-[3px] accent-foreground"
          checked={ticked}
          aria-label={`${SEVERITY[r.severity]} finding, ${r.place}`}
          aria-describedby={about}
          onChange={(e) => onTick(cardKey({ kind: "finding", id: r.finding }), e.target.checked)}
        />
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1 text-sm">
          <span className="text-xs">
            <Severity s={r.severity} />
          </span>
          <code translate="no" className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]">
            {r.place}
          </code>
        </span>
        {/* The description of the checkbox repeats this column for screen readers. */}
        <span aria-hidden className="justify-self-end text-xs text-muted-foreground">
          {outcome ? (
            <Outcome o={outcome} />
          ) : r.accepted ? (
            <span className="inline-flex items-center gap-1 font-semibold text-ink-2">
              <Check aria-hidden className="size-[13px] shrink-0" />
              Accepted
            </span>
          ) : (
            "Not accepted yet"
          )}
        </span>
        <span id={about} className="col-span-2 col-start-2 truncate text-sm text-ink-2">
          <span className="sr-only">{state} </span>
          {r.text}
        </span>
      </label>
    </li>
  );
}

// prKey: "PROJ/repo #id". ticks: the cardKey of each ticked row. reason: fixReason for the current ticks. starting: the POST is out.
export function FixPicker(props: {
  open: boolean;
  // A shortcut key opened the list (DialogContent instant).
  instant: boolean;
  prKey: string;
  targets: FixTargets;
  ticks: ReadonlySet<string>;
  reason: FixReason;
  starting: boolean;
  onTick: Tick;
  onPropose: () => void;
  onClose: () => void;
  // Closes the list and opens "Copy for your session" (docs/plans/session-consult.md part A).
  onConsult: () => void;
}) {
  const { targets, reason, ticks } = props;
  const propose = useRef<HTMLButtonElement>(null);
  const blocked = reason.kind !== "ok";
  const { rows, findings } = targets;
  const any = rows.length + findings.length > 0;
  const left = leftOutText(targets);
  const k =
    rows.filter((r) => ticks.has(cardKey({ kind: "thread", id: r.thread }))).length +
    findings.filter((r) => ticks.has(cardKey({ kind: "finding", id: r.finding }))).length;
  const ReasonIcon = reason.kind === "busy" ? Hourglass : CircleAlert;
  return (
    <Dialog open={props.open} onOpenChange={(on) => !on && props.onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[620px]"
        instant={props.instant}
        onKeyDown={dialogKeys(props.onClose)}
        initialFocus={any && !blocked ? propose : true}
      >
        <DialogHeader>
          <DialogTitle>Fix comments on your pull request</DialogTitle>
          <DialogDescription>
            <span translate="no">{props.prKey}</span>. Pick the points to fix. Your clone stays untouched until you Apply.
          </DialogDescription>
        </DialogHeader>
        {any ? (
          <div className="grid gap-1">
            {rows.length > 0 && (
              <>
                <h3 className={groupHead}>
                  Open threads <span className="font-medium">{rows.length}</span>
                </h3>
                <ul aria-label="Open threads" className="m-0 list-none border-t p-0">
                  {rows.map((r) => (
                    <Row key={r.thread} r={r} ticked={ticks.has(cardKey({ kind: "thread", id: r.thread }))} onTick={props.onTick} />
                  ))}
                </ul>
                <p className="m-0 mt-1.5 text-xs text-muted-foreground">
                  {left && `${left} `}A reply judgement of Valid or Partly valid ticks a thread at the start. Your own comments and posted
                  findings start unticked, unless your session accepted them. A fixed thread, a fix run without a fix, and a declined fix
                  start unticked too.
                </p>
              </>
            )}
            {findings.length > 0 && (
              <>
                <h3 className={`${groupHead} ${rows.length ? "mt-3" : ""}`}>
                  Review findings that you did not post <span className="font-medium">{findings.length}</span>
                </h3>
                <ul aria-label="Review findings that you did not post" className="m-0 list-none border-t p-0">
                  {findings.map((r) => (
                    <FindingRow
                      key={r.finding}
                      r={r}
                      ticked={ticks.has(cardKey({ kind: "finding", id: r.finding }))}
                      onTick={props.onTick}
                    />
                  ))}
                </ul>
                <p className="m-0 mt-1.5 text-xs text-muted-foreground">
                  {!rows.length && left && `${left} `}Accepted findings, and findings that your session accepted, start ticked, unless a fix
                  run gave no fix. A commit that fixes a finding takes it out of Ready to post.
                </p>
              </>
            )}
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
          {any && (
            <p id="fix-why" className="m-0 flex w-full items-start gap-1.5 text-sm text-muted-foreground">
              {blocked && <ReasonIcon aria-hidden className={`${icon} mt-0.5`} />}
              {reason.text}
            </p>
          )}
          {any && (
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
            {any ? "Cancel" : "Close"}
          </Button>
          <span className="flex-1" />
          <Button id="fix-consult" variant="ghost" size="sm" className="text-ink-2" onClick={props.onConsult}>
            <ClipboardCopy aria-hidden data-icon="inline-start" />
            Copy for your session
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
