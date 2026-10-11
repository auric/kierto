// Triage of drafts and questions (plan v3 WP14a, prototype/v3 acts, editor, mover): accept, edit, discard, restore, and move.
import { Check, CircleAlert, MoveVertical, Pencil, Undo2, X } from "lucide-react";
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { MAX_NOTE, type ReviewItemDto } from "../../shared/dto";
import { moveChoices } from "../../shared/review";

export type TriageAction = "accept" | "discard" | "restore";
// The open triage control of one item.
export type TriageMode = "edit" | "move" | null;

export type TriageCtx = {
  act: (it: ReviewItemDto, action: TriageAction) => void;
  // null closes the editor or the line field.
  edit: (it: ReviewItemDto | null) => void;
  save: (it: ReviewItemDto, text: string) => void;
  move: (it: ReviewItemDto | null) => void;
  moveTo: (it: ReviewItemDto, line: number) => void;
};

// Esc in a triage field closes only that field. The shell key handler never sees it.
function onEscape(e: KeyboardEvent, close: () => void) {
  if (e.key !== "Escape") return false;
  e.preventDefault();
  e.stopPropagation();
  close();
  return true;
}

// prototype/v3 acts(). Each button names its key in the tooltip.
// flush: no indent under an avatar, as in the questions of the summary.
export function Acts(props: { it: ReviewItemDto; busy: boolean; showState?: boolean; flush?: boolean; ctx: TriageCtx }) {
  const { it, busy, ctx } = props;
  const move = it.kind === "finding" && it.anchor && (
    <button
      type="button"
      disabled={busy}
      aria-label={`Move to another line. Now line ${it.anchor.line}.`}
      title="Move to another line"
      className="ml-1 inline-flex cursor-pointer items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground hover:underline disabled:cursor-default"
      onClick={() => ctx.move(it)}
    >
      <MoveVertical aria-hidden className="size-[13px]" />
      Move
    </button>
  );
  return (
    <div className={cn("mt-2.5 flex flex-wrap items-center gap-1.5", !props.flush && "rl-indent")}>
      {it.status === "accepted" ? (
        <>
          {props.showState && (
            <span className="mr-1 inline-flex items-center gap-1 font-medium text-ink-2">
              <Check aria-hidden className="size-[15px]" />
              Accepted
            </span>
          )}
          <Button size="sm" variant="outline" disabled={busy} title="Key: e" aria-keyshortcuts="e" onClick={() => ctx.edit(it)}>
            <Pencil aria-hidden data-icon="inline-start" />
            Edit
          </Button>
          <Button size="sm" variant="outline" disabled={busy} title="Key: a" aria-keyshortcuts="a" onClick={() => ctx.act(it, "restore")}>
            <Undo2 aria-hidden data-icon="inline-start" />
            Undo accept
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" variant="outline" disabled={busy} title="Key: a" aria-keyshortcuts="a" onClick={() => ctx.act(it, "accept")}>
            <Check aria-hidden data-icon="inline-start" />
            Accept
          </Button>
          <Button size="sm" variant="outline" disabled={busy} title="Key: e" aria-keyshortcuts="e" onClick={() => ctx.edit(it)}>
            <Pencil aria-hidden data-icon="inline-start" />
            Edit
          </Button>
          <Button size="sm" variant="outline" disabled={busy} title="Key: d" aria-keyshortcuts="d" onClick={() => ctx.act(it, "discard")}>
            <X aria-hidden data-icon="inline-start" />
            Discard
          </Button>
        </>
      )}
      {move}
    </div>
  );
}

// A discarded item folds to one muted line with Restore (prototype/v3 draft, question).
export function RestoreButton({ it, busy, ctx }: { it: ReviewItemDto; busy: boolean; ctx: TriageCtx }) {
  return (
    <button
      type="button"
      disabled={busy}
      title="Key: d"
      aria-keyshortcuts="d"
      className="mr-1 inline-flex flex-none cursor-pointer items-center gap-1 rounded px-1 text-sm font-medium text-pen hover:underline disabled:cursor-default"
      onClick={() => ctx.act(it, "restore")}
    >
      <Undo2 aria-hidden className="size-[15px]" />
      Restore
    </button>
  );
}

// Saving binds the approval to the new text: an edit always accepts the item (prototype/v3 saveEdit).
export function Editor({ it, busy, flush, ctx }: { it: ReviewItemDto; busy: boolean; flush?: boolean; ctx: TriageCtx }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // The whole editor comes into view, so its buttons do too.
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(ta.value.length, ta.value.length);
    box.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const save = () => {
    const v = ref.current?.value.trim() ?? "";
    if (!v) {
      toast.add({ title: `The text is empty. Discard the ${it.kind} instead.` });
      return;
    }
    ctx.save(it, v);
  };
  const id = `edit-${it.id}`;
  return (
    <div ref={box} className={cn("mt-1 max-w-[72ch]", !flush && "rl-indent")}>
      <label className="sr-only" htmlFor={id}>
        Edit the {it.kind}
      </label>
      <Textarea
        ref={ref}
        id={id}
        rows={6}
        maxLength={MAX_NOTE}
        spellCheck
        defaultValue={it.body}
        className="field-sizing-fixed min-h-[9em] resize-y bg-pane leading-normal"
        onKeyDown={(e) => {
          if (onEscape(e, () => ctx.edit(null))) return;
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            save();
          }
        }}
      />
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Button size="sm" disabled={busy} aria-keyshortcuts="Control+Enter" title="Key: Ctrl+Enter" onClick={save}>
          <Check aria-hidden data-icon="inline-start" />
          Save and accept
        </Button>
        <Button size="sm" variant="outline" title="Key: Esc" onClick={() => ctx.edit(null)}>
          Cancel
        </Button>
        <span className="ml-1 text-xs text-muted-foreground">Ctrl+Enter saves. Esc cancels.</span>
      </div>
    </div>
  );
}

// prototype/v3 mover(): the new line must be in the excerpt, so the comment quotes the code you see.
export function Mover({ it, busy, ctx }: { it: ReviewItemDto; busy: boolean; ctx: TriageCtx }) {
  const a = it.anchor;
  const ok = a ? moveChoices(a.excerpt, a.side) : [];
  const [v, setV] = useState(String(a?.line ?? ""));
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.select();
  }, []);
  if (!a || !ok.length) return null;
  const go = () => {
    const n = Number(v);
    if (!ok.includes(n)) {
      setErr(`Line ${v.trim() || "?"} is not in the excerpt. Choose a line from ${ok[0]} to ${ok.at(-1)}.`);
      ref.current?.focus();
      return;
    }
    if (n === a.line && n === a.lineEnd) ctx.move(null);
    else ctx.moveTo(it, n);
  };
  const id = `mv-${it.id}`;
  return (
    <>
      <div className="rl-indent mt-2.5 flex flex-wrap items-center gap-1.5 text-sm text-ink-2">
        <MoveVertical aria-hidden className="size-[13px] text-muted-foreground" />
        <label htmlFor={id}>Line</label>
        <Input
          ref={ref}
          id={id}
          type="number"
          inputMode="numeric"
          min={ok[0]}
          max={ok.at(-1)}
          value={v}
          aria-invalid={err ? true : undefined}
          aria-describedby={cn(err && `${id}-err`, `${id}-h`)}
          className="h-7 w-[8ch] bg-pane px-1.5 font-mono"
          onChange={(e) => {
            setV(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => {
            if (onEscape(e, () => ctx.move(null))) return;
            if (e.key === "Enter") {
              e.preventDefault();
              go();
            }
          }}
        />
        <Button size="sm" variant="outline" disabled={busy} onClick={go}>
          Move
        </Button>
        <Button size="sm" variant="outline" title="Key: Esc" onClick={() => ctx.move(null)}>
          Cancel
        </Button>
        <span id={`${id}-h`} className="ml-1 text-xs text-muted-foreground">
          Lines {ok[0]} to {ok.at(-1)} of the excerpt. Esc cancels.
        </span>
      </div>
      {err && (
        <p id={`${id}-err`} role="alert" className="rl-indent m-0 mt-1.5 flex items-center gap-1.5 text-xs text-destructive">
          <CircleAlert aria-hidden className="size-[13px] shrink-0" />
          {err}
        </p>
      )}
    </>
  );
}
