// Session consult dialogs (docs/plans/session-consult.md parts A and B). "Copy for your session" copies the text of the ticked groups.
// "Paste the answer" reads the answer of that session, shows what each entry does, and applies it after a click. Nothing posts.
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, ClipboardCopy, ClipboardPaste, Info, Undo2, Wrench } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import {
  CONSULT_GROUP,
  CONSULT_MAX_BYTES,
  type ConsultGroup,
  type ConsultImportDto,
  type ConsultVerdict,
  consultGroups,
  consultText,
  needsVerdict,
  type PlanRow,
  parseAnswer,
  planAnswer,
} from "../../shared/consult";
import type { PrRow } from "../../shared/dto";
import { dialogKeys } from "../fix/CloneDialog";
import type { FixTarget } from "../fix/model";
import { planKey } from "../publish/data";
import { replyKey } from "../review/data";
import { plural } from "../review/model";
import { prKey } from "../shell/model";
import { consultKey, loadGroups, loadSnapshot, postImport, postUndo, saveGroups, saveSnapshot, useConsultData } from "./data";

export const CONSULT_OWN_ONLY = "Copy for your session works only on your own pull requests.";

const kb = (bytes: number) => (bytes < 1000 ? plural(bytes, "byte") : `${(bytes / 1000).toFixed(1)} KB`);
const VERDICT: Record<ConsultVerdict, string> = { accept: "Accept", reject: "Reject", question: "Question" };
const rowBox = "grid cursor-pointer grid-cols-[18px_minmax(0,1fr)] items-start gap-x-2.5 gap-y-0.5 rounded px-1 py-2 hover:bg-hover";

// from: the ID of the element that takes the focus after the dialog.
type Open = { mode: "copy" | "paste"; from: string };

export type ConsultUi = {
  // from: the element that gets the focus back. Default: the More button.
  copy: (from?: string) => void;
  paste: (from?: string) => void;
  dialog: ReactNode;
};

// openFix: opens the Fix list with exactly these targets ticked.
export function useConsult(pr: PrRow, o: { announce: (text: string) => void; openFix: (targets: FixTarget[]) => void }): ConsultUi {
  const [open, setOpen] = useState<Open | null>(null);
  const author = pr.role === "AUTHOR";
  const qc = useQueryClient();
  const show =
    (mode: Open["mode"]) =>
    (from = "more-btn") => {
      if (!author) return void toast.add({ title: CONSULT_OWN_ONLY });
      setOpen({ mode, from });
    };
  const close = () => setOpen(null);
  // The import changes reply drafts, findings, and the post plan.
  const changed = () => {
    void qc.invalidateQueries({ queryKey: replyKey(pr.id) });
    void qc.invalidateQueries({ queryKey: planKey(pr.id) });
    void qc.invalidateQueries({ queryKey: consultKey(pr.id) });
    void qc.invalidateQueries({ queryKey: ["run"] });
  };
  const finalFocus = () => (open && document.getElementById(open.from)) || true;
  const dialog =
    author && open ? (
      <Dialog open onOpenChange={(on) => !on && close()}>
        {open.mode === "copy" ? (
          <CopyBody pr={pr} announce={o.announce} onClose={close} finalFocus={finalFocus} />
        ) : (
          <PasteBody
            pr={pr}
            announce={o.announce}
            onClose={close}
            onChanged={changed}
            finalFocus={finalFocus}
            onFix={(t) => {
              close();
              o.openFix(t);
            }}
          />
        )}
      </Dialog>
    ) : null;
  return { copy: show("copy"), paste: show("paste"), dialog };
}

type Body = { pr: PrRow; announce: (text: string) => void; onClose: () => void; finalFocus: () => HTMLElement | true };

function Loading({ error }: { error: Error | null }) {
  return error ? (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertTitle>Cannot read the review points</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  ) : (
    <div role="status" aria-label="Loading the review points" className="grid gap-2">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-2/3" />
    </div>
  );
}

// ---------- Part A ----------

function CopyBody({ pr, announce, onClose, finalFocus }: Body) {
  const q = useConsultData(pr.id, true);
  const [groups, setGroups] = useState(loadGroups);
  const copyBtn = useRef<HTMLButtonElement>(null);
  const t = useMemo(() => q.data && consultText(q.data, groups), [q.data, groups]);
  const tick = (g: ConsultGroup, on: boolean) => {
    const next = new Set(groups);
    if (on) next.add(g);
    else next.delete(g);
    setGroups(next);
    saveGroups(next);
  };
  const copy = async () => {
    const data = q.data;
    if (!t || !data || !t.ids.length) return;
    if (!(await copyText(t.text)))
      return void toast.add({ title: "The clipboard is blocked here. Allow the clipboard for this page and copy again." });
    const ids = new Set(t.ids);
    saveSnapshot(pr.id, Object.fromEntries(data.items.filter((it) => ids.has(it.id)).map((it) => [it.id, it.key])));
    announce(`Copied ${plural(t.ids.length, "item")} for your session. Paste its answer with Paste the answer.`);
    onClose();
  };
  return (
    <DialogContent
      className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[560px]"
      onKeyDown={dialogKeys(onClose)}
      initialFocus={t?.ids.length ? copyBtn : true}
      finalFocus={finalFocus}
    >
      <DialogHeader>
        <DialogTitle>Copy for your session</DialogTitle>
        <DialogDescription>
          <span translate="no">{prKey(pr)}</span>. Paste the text into the session that wrote the code. It answers with a verdict for each
          item.
        </DialogDescription>
      </DialogHeader>
      {!t ? (
        <Loading error={q.error} />
      ) : (
        <>
          <FieldSet className="gap-0">
            <FieldLegend variant="label">Groups</FieldLegend>
            {consultGroups.map((g) => (
              <label key={g} className={rowBox} data-consult-group={g}>
                <input
                  type="checkbox"
                  className="m-0 mt-[3px] accent-foreground"
                  checked={groups.has(g)}
                  aria-describedby={`cg-${g}-about`}
                  onChange={(e) => tick(g, e.target.checked)}
                />
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
                  <b className="font-semibold">{CONSULT_GROUP[g]}</b>
                  <span className="text-muted-foreground">{t.counts[g]}</span>
                </span>
                <span id={`cg-${g}-about`} className="col-start-2 text-xs text-muted-foreground">
                  {needsVerdict(g) ? "Needs a verdict." : "Context only. No verdict."}
                </span>
              </label>
            ))}
          </FieldSet>
          {t.left.length > 0 && (
            <Alert role="note">
              <Info aria-hidden />
              <AlertTitle>The text reached its size cap of {kb(CONSULT_MAX_BYTES)}.</AlertTitle>
              <AlertDescription>
                {plural(t.left.length, "item")} stay out: <span translate="no">{t.left.join(", ")}</span>. Untick a group to make room, or
                copy again after this answer.
              </AlertDescription>
            </Alert>
          )}
          <p id="consult-size" className="m-0 text-sm text-ink-2">
            {t.ids.length ? `${plural(t.ids.length, "item")}, ${kb(t.bytes)}.` : "Nothing to copy. Tick a group with items."}
          </p>
        </>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button ref={copyBtn} id="consult-copy" disabled={!t?.ids.length} aria-describedby="consult-size" onClick={() => void copy()}>
          <ClipboardCopy aria-hidden data-icon="inline-start" />
          {t?.ids.length ? `Copy ${plural(t.ids.length, "item")}` : "Copy"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ---------- Part B ----------

// done: the rows of an applied answer.
function PlanTable({ rows, done }: { rows: PlanRow[]; done?: boolean }) {
  return (
    <div className="max-h-[45dvh] overflow-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">What the app {done ? "did" : "does"} with each entry</caption>
        <thead className="sticky top-0 bg-popover text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-2 py-1.5 text-left font-semibold">
              Item
            </th>
            <th scope="col" className="px-2 py-1.5 text-left font-semibold">
              Verdict
            </th>
            <th scope="col" className="px-2 py-1.5 text-left font-semibold">
              What the app {done ? "did" : "does"}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n} data-consult-row={r.id || r.n} data-skipped={r.act ? undefined : true} className="border-t align-top">
              <td className="px-2 py-1.5">
                <code translate="no" className="font-mono text-xs">
                  {r.id || `Entry ${r.n}`}
                </code>
                {r.item && <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{r.item.label}</div>}
              </td>
              <td className="px-2 py-1.5 whitespace-nowrap">{r.verdict ? VERDICT[r.verdict] : "–"}</td>
              <td className="px-2 py-1.5 [overflow-wrap:anywhere]">
                <span className={cn(!r.act && "text-muted-foreground")}>{r.act ? r.text : `Skipped. ${r.text}`}</span>
                {r.reason && <div className="text-xs text-muted-foreground">Reason: {r.reason}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const resultText = (d: ConsultImportDto) => {
  const ticks = d.ticks.threads.length + d.ticks.findings.length;
  const parts = [
    d.drafts && `Made ${plural(d.drafts, "reply draft")}.`,
    d.discarded && `Discarded ${plural(d.discarded, "finding")}.`,
    d.marked && `Marked ${plural(d.marked, "finding")}.`,
    ticks && `${plural(ticks, "item")} ticked for a fix.`,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "Nothing changed.";
};

function PasteBody({
  pr,
  announce,
  onClose,
  onChanged,
  onFix,
  finalFocus,
}: Body & { onChanged: () => void; onFix: (t: FixTarget[]) => void }) {
  const q = useConsultData(pr.id, true);
  const [raw, setRaw] = useState("");
  const [done, setDone] = useState<ConsultImportDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [snapshot] = useState(() => loadSnapshot(pr.id));
  const parsed = raw.trim() ? parseAnswer(raw) : null;
  const rows = parsed && "entries" in parsed && q.data ? planAnswer(q.data.items, parsed.entries, snapshot) : null;
  const changes = rows?.filter((r) => r.act).length ?? 0;
  const error = parsed && "error" in parsed ? parsed.error : null;

  const apply = async () => {
    if (!parsed || !("entries" in parsed) || !changes || busy) return;
    setBusy(true);
    try {
      const d = await postImport(pr.id, parsed.entries, snapshot);
      setDone(d);
      onChanged();
      announce(`Applied. ${resultText(d)}`);
    } catch (e) {
      toast.add({ title: "The answer was not applied", description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    if (!done || busy) return;
    setBusy(true);
    try {
      const u = await postUndo(pr.id, done.run);
      onChanged();
      announce(
        `Undone. ${[u.drafts && `Removed ${plural(u.drafts, "reply draft")}.`, u.replaced && `Brought back ${plural(u.replaced, "earlier draft")}.`, u.findings && `Reset ${plural(u.findings, "finding")}.`].filter(Boolean).join(" ")}`,
      );
      onClose();
    } catch (e) {
      toast.add({ title: "The undo did not run", description: (e as Error).message });
      setBusy(false);
    }
  };
  const ticks: FixTarget[] = done
    ? [
        ...done.ticks.threads.map((id) => ({ kind: "thread" as const, id })),
        ...done.ticks.findings.map((id) => ({ kind: "finding" as const, id })),
      ]
    : [];

  return (
    <DialogContent
      className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[720px]"
      onKeyDown={dialogKeys(onClose)}
      finalFocus={finalFocus}
    >
      <DialogHeader>
        <DialogTitle>Paste the answer</DialogTitle>
        <DialogDescription>
          <span translate="no">{prKey(pr)}</span>. Paste the answer of your session with its json block. Nothing changes before Apply.
          Nothing posts.
        </DialogDescription>
      </DialogHeader>
      {done ? (
        <>
          <p id="consult-result" role="status" className="m-0 text-sm font-medium">
            Applied. {resultText(done)}
          </p>
          <PlanTable rows={done.rows} done />
          <p className="m-0 text-xs text-muted-foreground">
            The reply drafts wait under their threads. Accept them to put them in Ready to post. A Fix list tick stays as the default tick.
          </p>
        </>
      ) : (
        <>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="consult-answer">Answer of your session</FieldLabel>
            <Textarea
              id="consult-answer"
              rows={7}
              value={raw}
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby="consult-answer-note"
              placeholder={'```json\n[{"id": "T123", "verdict": "reject", "reason": "…"}]\n```'}
              className="max-h-[30dvh] font-mono text-xs"
              onChange={(e) => setRaw(e.target.value)}
            />
            {error ? (
              <FieldError id="consult-answer-note">{error}</FieldError>
            ) : (
              <FieldDescription id="consult-answer-note">
                {snapshot
                  ? "The app skips each item that changed after your copy."
                  : "No copy from this browser. The app checks only the current state of each item."}
              </FieldDescription>
            )}
          </Field>
          {raw.trim() && !q.data && <Loading error={q.error} />}
          {rows && (
            <>
              <p id="consult-plan" className="m-0 text-sm text-ink-2">
                {plural(changes, "change")}, {rows.length - changes} skipped.
              </p>
              <PlanTable rows={rows} />
            </>
          )}
        </>
      )}
      <DialogFooter>
        {done ? (
          <>
            <Button variant="ghost" className="sm:mr-auto" disabled={busy} onClick={() => void undo()}>
              <Undo2 aria-hidden data-icon="inline-start" />
              Undo
            </Button>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            {ticks.length > 0 && (
              <Button id="consult-fix" onClick={() => onFix(ticks)}>
                <Wrench aria-hidden data-icon="inline-start" />
                Open the Fix list ({ticks.length} ticked)
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              id="consult-apply"
              disabled={!changes || busy}
              aria-describedby={rows ? "consult-plan" : undefined}
              onClick={() => void apply()}
            >
              <ClipboardPaste aria-hidden data-icon="inline-start" />
              {changes ? `Apply ${plural(changes, "change")}` : "Apply"}
            </Button>
          </>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
