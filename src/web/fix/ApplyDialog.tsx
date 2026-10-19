// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Apply dialog (plan r3 UI-FIX): the clone with its problems, the commit message, "Apply and commit", and the app-branch fallback.
// The commit runs the user's git hooks. A hook or commit failure leaves the edits staged; the dialog then shows the stderr tail.
import { CircleAlert, FolderGit2, GitCommitHorizontal, LoaderCircle, Undo2 } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CloneDto, FixCommitDto, FixDto, FixMode } from "../../shared/dto";
import { shortHash } from "../review/model";
import { CloneDialog, CloneFolder, dialogKeys } from "./CloneDialog";
import { commitFix } from "./data";
import { FetchCommands, type FixCtx } from "./FixCard";
import { applyText, appRefPrefix, commitText, defaultMessage, type FixTarget } from "./model";

const icon = "size-[15px] shrink-0";

// The selection when the dialog opened (model.ts selection).
export type ApplyTarget = { run: number; edits: number[]; threads: number[]; findings: number[]; first: FixTarget | null };

type Failure = { status: 409 | 502; error: string; problems: CloneDto["problems"]; mode: FixMode };

export function ApplyDialog(props: {
  target: ApplyTarget | null;
  // pr: the app ID of the pull request. prNumber: its number on the forge, for the commit message.
  pr: number;
  prNumber: number;
  repo: string;
  fixes: FixDto[];
  // path:line of each finding of the newest review run, for the commit message.
  places: ReadonlyMap<number, string>;
  clone: { data: CloneDto | undefined; error: Error | null; refetch: () => void };
  // A commit row came back. The caller closes the dialog in clone mode. In cache mode the dialog stays for the fetch commands.
  onCommitted: (c: FixCommitDto, target: ApplyTarget) => void;
  // A refusal came back. The fix runs and the clone state change, so the caller reads them again.
  onRefused: (target: ApplyTarget) => void;
  onClose: () => void;
  ctx: FixCtx;
  // The ID of the element that takes the focus after the dialog closes. null: the element that opened it.
  focusTo: () => string | null;
}) {
  const open = props.target !== null;
  // The last target stays while the dialog plays its close transition.
  const last = useRef(props.target);
  if (props.target) last.current = props.target;
  const t = last.current;
  return (
    <Dialog
      open={open}
      onOpenChange={(on) => !on && props.onClose()}
      onOpenChangeComplete={(on) => {
        // The page outside the dialog takes focus only after the dialog is gone. A target without a tab stop needs this path.
        const el = on ? null : document.getElementById(props.focusTo() ?? "");
        el?.scrollIntoView({ block: "nearest" });
        el?.focus({ preventScroll: true });
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[640px]"
        onKeyDown={dialogKeys(props.onClose)}
        finalFocus={() => !props.focusTo()}
      >
        {t && <ApplyBody key={`${t.run}:${t.edits.join(",")}`} {...props} target={t} />}
      </DialogContent>
    </Dialog>
  );
}

function ApplyBody(props: Parameters<typeof ApplyDialog>[0] & { target: ApplyTarget }) {
  const { target, clone, ctx } = props;
  const fix = props.fixes.find((f) => f.run.id === target.run);
  const [message, setMessage] = useState(() =>
    defaultMessage(
      props.prNumber,
      target.threads,
      fix?.threads ?? [],
      target.findings.map((id) => ({ id, place: props.places.get(id) ?? null })),
    ),
  );
  const [pending, setPending] = useState<FixMode | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [made, setMade] = useState<FixCommitDto | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);

  const c = clone.data;
  // The clone check of GET uses the synced head. A commit checks the live head again, so its refusal can name more problems.
  const problems = c?.problems ?? [];
  const ready = !!c?.path && problems.length === 0;
  // A failed commit leaves a staged row of this selection.
  const staged =
    fix?.commits.find(
      (x) => x.state === "staged" && x.edits.length === target.edits.length && x.edits.every((id) => target.edits.includes(id)),
    ) ?? null;
  const title = applyText(target.edits.length, target.threads.length, target.findings.length);

  const commit = async (mode: FixMode) => {
    if (pending) return;
    setPending(mode);
    setFailure(null);
    try {
      const r = await commitFix(target.run, { edits: target.edits, message, mode });
      if ("ok" in r) {
        if (mode === "cache") setMade(r.ok);
        props.onCommitted(r.ok, target);
        return;
      }
      setFailure({ ...r, mode });
      props.onRefused(target);
    } catch (e) {
      setFailure({ status: 409, error: (e as Error).message, problems: [], mode });
    } finally {
      setPending(null);
    }
  };

  if (made?.fetch) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Committed to an app branch</DialogTitle>
          <DialogDescription>{commitText(made)}</DialogDescription>
        </DialogHeader>
        <FetchCommands fetch={made.fetch} ctx={ctx} />
        <DialogFooter>
          <Button onClick={props.onClose}>Done</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          The app applies the edits in your clone and commits them with your git identity and hooks. It never pushes.
        </DialogDescription>
      </DialogHeader>

      <section aria-labelledby="apply-clone-h" className="grid gap-1.5">
        <h3 id="apply-clone-h" className="m-0 text-sm font-semibold">
          Your clone
        </h3>
        <div className="flex items-start gap-2">
          <FolderGit2 aria-hidden className={cn(icon, "mt-0.5 text-muted-foreground")} />
          {c === undefined && !clone.error ? (
            <Skeleton className="h-5 w-64" />
          ) : (
            <span translate="no" className="min-w-0 flex-1 font-mono text-sm [overflow-wrap:anywhere]">
              {c?.path ?? <span className="font-sans text-muted-foreground">No folder set</span>}
            </span>
          )}
        </div>
        {c?.branch && (
          <p className="m-0 pl-[23px] text-xs text-muted-foreground">
            On{" "}
            <code translate="no" className="font-mono">
              {c.branch}
            </code>
            {c.head && (
              <>
                {" "}
                at{" "}
                <code translate="no" className="font-mono">
                  {shortHash(c.head)}
                </code>
              </>
            )}
            .
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1 pl-[23px]">
          <Button size="sm" variant="outline" onClick={() => setCloneOpen(true)}>
            {c?.path ? "Change" : "Set the folder"}
          </Button>
          {c?.path && <CloneFolder pr={props.pr} path={c.path} />}
        </div>
        {clone.error && (
          <p className="m-0 flex items-start gap-1.5 pl-[23px] text-sm text-destructive">
            <CircleAlert aria-hidden className={cn(icon, "mt-0.5")} />
            Cannot check the clone. {clone.error.message}
          </p>
        )}
        {problems.length > 0 && (
          <>
            <ul id="apply-problems" aria-label="Clone problems" className="m-0 grid list-none gap-1 p-0 pl-[23px]">
              {problems.map((p) => (
                <li key={p.kind} data-problem={p.kind} className="flex items-start gap-1.5 text-sm text-destructive">
                  <CircleAlert aria-hidden className={cn(icon, "mt-0.5")} />
                  <span>{p.text}</span>
                </li>
              ))}
            </ul>
            <p className="m-0 pl-[23px]">
              <Button size="sm" variant="ghost" className="text-ink-2" onClick={clone.refetch}>
                Check the clone again
              </Button>
            </p>
          </>
        )}
      </section>

      <Field>
        <FieldLabel htmlFor="fix-message">Commit message</FieldLabel>
        <Textarea
          id="fix-message"
          rows={6}
          maxLength={5000}
          spellCheck
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="font-mono text-xs"
        />
        <FieldDescription>Your hooks can change it. The app commits only the edits that you ticked.</FieldDescription>
      </Field>

      <p role="status" className="m-0 min-h-5 text-sm text-ink-2">
        {pending === "clone"
          ? "Applying the edits and committing in your clone…"
          : pending === "cache"
            ? "Committing to an app branch…"
            : ""}
      </p>
      {failure && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription className="grid gap-2">
            <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{failure.error}</p>
            {failure.problems.length > 0 && (
              <ul className="m-0 grid list-disc gap-0.5 pl-4">
                {failure.problems.map((p) => (
                  <li key={p.kind}>{p.text}</li>
                ))}
              </ul>
            )}
            {failure.status === 502 && <p className="m-0 text-ink-2">The app reads the pull request again on the next try.</p>}
            <div className="flex flex-wrap gap-2">
              {failure.status === 502 && (
                <Button size="sm" variant="outline" disabled={!!pending} onClick={() => void commit(failure.mode)}>
                  Try again
                </Button>
              )}
              {staged && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setFailure(null);
                    ctx.onUndo(staged, null);
                  }}
                >
                  <Undo2 aria-hidden data-icon="inline-start" />
                  Undo the staged edits
                </Button>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <p id="apply-cache-help" className="m-0 text-xs text-muted-foreground">
        Commit to an app branch puts the commit in the app's own copy of the repository. It goes
        {fix && (
          <>
            {" "}
            on top of{" "}
            <code translate="no" className="font-mono">
              {shortHash(fix.run.sourceHead)}
            </code>
            ,
          </>
        )}{" "}
        under{" "}
        <code translate="no" className="font-mono">
          {appRefPrefix(props.prNumber)}
        </code>
        . Your clone does not change. Then the app shows two git commands that bring the commit into your clone.
      </p>
      <DialogFooter>
        <Button
          variant="outline"
          className="sm:mr-auto"
          aria-describedby="apply-cache-help"
          disabled={!!pending}
          onClick={() => void commit("cache")}
        >
          Commit to an app branch
        </Button>
        <Button variant="ghost" onClick={props.onClose}>
          Cancel
        </Button>
        <Button
          disabled={!ready || !!pending || !!staged}
          focusableWhenDisabled
          aria-describedby={problems.length ? "apply-problems" : undefined}
          className="aria-disabled:cursor-default aria-disabled:opacity-50"
          onClick={() => void commit("clone")}
        >
          {pending === "clone" ? (
            <LoaderCircle aria-hidden data-icon="inline-start" className="animate-spin" />
          ) : (
            <GitCommitHorizontal aria-hidden data-icon="inline-start" />
          )}
          Apply and commit
        </Button>
      </DialogFooter>

      <CloneDialog
        pr={props.pr}
        repo={props.repo}
        path={c?.path ?? null}
        open={cloneOpen}
        onClose={() => setCloneOpen(false)}
        onSaved={() => {
          setCloneOpen(false);
          setFailure(null);
          clone.refetch();
        }}
      />
    </>
  );
}
