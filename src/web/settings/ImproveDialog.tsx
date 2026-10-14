// Improve prompt (Settings > Review profiles): the runner proposes a new prompt, and the dialog shows it as a line diff.
// Nothing changes before Apply. Closing the dialog cancels a running proposal.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ImproveDto } from "../../shared/dto";
import { api } from "../api";
import { dialogKeys } from "../fix/CloneDialog";
import { useMeta } from "../meta";
import { read } from "../shell/data";
import { type DiffLine, failedText, improveBody, lineDiff, MAX_GOAL, runningText, unchanged } from "./improve";
import type { Draft } from "./profiles";

const POLL_MS = 1000;
const SIGN: Record<DiffLine["kind"], string> = { same: " ", del: "−", add: "+" };
const SAID: Record<DiffLine["kind"], string> = { same: "", del: "Removed: ", add: "Added: " };

const cancelProposal = (id: number) => api.api.profiles.improve[":id"].cancel.$post({ param: { id: String(id) } }).catch(() => undefined);

// draft: the profile to improve. null: the dialog is closed.
export function ImproveDialog(props: { draft: Draft | null; label: string; onApply: (prompt: string) => void; onClose: () => void }) {
  return (
    <Dialog open={props.draft !== null} onOpenChange={(on) => !on && props.onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[720px]" onKeyDown={dialogKeys(props.onClose)}>
        {props.draft && <ImproveBody {...props} draft={props.draft} />}
      </DialogContent>
    </Dialog>
  );
}

function ImproveBody({
  draft,
  label,
  onApply,
  onClose,
}: {
  draft: Draft;
  label: string;
  onApply: (prompt: string) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const runner = useMeta().data?.runner;
  const [goal, setGoal] = useState("");
  // id: the proposal on the server. current: the prompt that the run got.
  const [run, setRun] = useState<{ id: number; current: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // The proposal that runs now. The dialog cancels it when it closes.
  const running = useRef<number | null>(null);
  const proposal = useQuery({
    queryKey: ["improve", run?.id],
    queryFn: async () => read<ImproveDto>(await api.api.profiles.improve[":id"].$get({ param: { id: String(run?.id) } })),
    enabled: run !== null,
    refetchInterval: (q) => (q.state.data?.status === "running" ? POLL_MS : false),
    gcTime: 0,
  });
  const p = run ? proposal.data : undefined;
  const busy = starting || p?.status === "running";

  useEffect(() => {
    if (p && p.status !== "running" && running.current === p.id) running.current = null;
  }, [p]);
  useEffect(
    () => () => {
      if (running.current !== null) void cancelProposal(running.current);
    },
    [],
  );

  const start = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    const body = improveBody(draft, goal);
    setStarting(true);
    setStartError(null);
    try {
      const r = await read<ImproveDto>(await api.api.profiles.improve.$post({ json: body }));
      qc.setQueryData(["improve", r.id], r);
      running.current = r.id;
      setRun({ id: r.id, current: body.prompt });
    } catch (err) {
      setStartError((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const error =
    startError ??
    (proposal.error && run ? proposal.error.message : null) ??
    (p?.status === "failed" && runner ? failedText(p, runner) : null) ??
    (p?.status === "cancelled" ? "The proposal was cancelled." : null);
  const done = p?.status === "done" ? p : null;
  const same = done && run ? unchanged(run.current, done.prompt) : false;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Improve the prompt of {label}</DialogTitle>
        <DialogDescription>
          {runner?.short} proposes a new prompt from the profile and your goal. It gets no code and no pull request. Nothing changes until
          you click Apply.
        </DialogDescription>
      </DialogHeader>
      <form id="improve-form" onSubmit={(e) => void start(e)}>
        <FieldGroup>
          <Field data-invalid={!!startError || undefined}>
            <FieldLabel htmlFor="improve-goal">What should the prompt focus on? Optional.</FieldLabel>
            <Input
              id="improve-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              autoComplete="off"
              maxLength={MAX_GOAL}
              placeholder="For example: C++ lifetime bugs in engine code"
              disabled={busy}
              aria-invalid={!!startError || undefined}
            />
            <FieldDescription>The goal and the current prompt go to {runner?.short} as data, not as instructions.</FieldDescription>
            {startError && <FieldError>{startError}</FieldError>}
          </Field>
        </FieldGroup>
      </form>
      {/* The live region holds one short line, so a screen reader does not read the whole diff. */}
      <p role="status" className={cn("m-0 inline-flex items-center gap-1.5 text-sm", !busy && "sr-only")}>
        {busy && <LoaderCircle aria-hidden className="size-[15px] shrink-0 animate-spin motion-reduce:animate-none" />}
        {busy ? runningText(runner?.short ?? "") : done ? "The proposal is ready." : ""}
      </p>
      {!startError && error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {done && run && <Proposal current={run.current} prompt={done.prompt} reasons={done.reasons} same={same} />}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        {!busy && run && (
          <Button variant={done ? "outline" : "default"} type="submit" form="improve-form">
            Try again
          </Button>
        )}
        {!run && (
          <Button type="submit" form="improve-form" disabled={busy}>
            Start
          </Button>
        )}
        {done && (
          <Button disabled={same} onClick={() => onApply(done.prompt)}>
            Apply
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

function Proposal(props: { current: string; prompt: string; reasons: string[]; same: boolean }) {
  if (props.same) return <p className="m-0 text-sm">The proposal is the same as the current prompt.</p>;
  return (
    <>
      <div className="grid min-w-0 gap-1">
        <p id="improve-diff" className="m-0 text-sm font-semibold">
          Changes to the prompt
        </p>
        <section
          aria-labelledby="improve-diff"
          className="max-h-[45vh] overflow-y-auto rounded-md bg-sunken py-1.5 font-mono text-[12.25px] leading-[1.6]"
        >
          {lineDiff(props.current, props.prompt).map((l, k) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: the lines have no ID, and the list never reorders.
              key={k}
              data-k={l.kind}
              className={cn(
                "grid grid-cols-[2ch_minmax(0,1fr)] px-2 break-words whitespace-pre-wrap",
                l.kind === "add" && "bg-(--add)",
                l.kind === "del" && "bg-(--del)",
              )}
            >
              <span aria-hidden className="text-muted-foreground select-none">
                {SIGN[l.kind]}
              </span>
              <span>
                <span className="sr-only">{SAID[l.kind]}</span>
                {l.text || " "}
              </span>
            </div>
          ))}
        </section>
      </div>
      {props.reasons.length > 0 && (
        <div className="grid min-w-0 gap-1">
          <p id="improve-reasons" className="m-0 text-sm font-semibold">
            Reasons
          </p>
          <ul aria-labelledby="improve-reasons" className="m-0 grid list-disc gap-0.5 pl-5 text-sm">
            {props.reasons.map((r, k) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the reasons have no ID, and the list never reorders.
              <li key={k}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
