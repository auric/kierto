// Review profiles settings (M4, BRIEF US9): name, note, prompt, Explain, Docs, and turn cap, in the order of the review brief.
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CircleAlert, Plus, RotateCcw, X } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import type { ProfileInput, SettingsDto } from "../../shared/dto";
import { useMeta } from "../meta";
import { useSaveSettings } from "../shell/data";
import { Hint } from "../shell/Hint";
import {
  ADD_ID,
  allValid,
  type Change,
  change,
  type Draft,
  type Edit,
  type Field,
  focusAfter,
  LIMITS,
  problems,
  profileId,
  profileLabel,
  sameProfiles,
  toDrafts,
  toProfiles,
} from "./profiles";

// The TaskRules.tsx control styles.
const field = "grid min-w-0 gap-[3px] text-xs text-muted-foreground";
const control =
  "h-[30px] w-full min-w-0 rounded-md border border-input bg-pane px-2 text-sm text-foreground aria-invalid:border-destructive focus-visible:outline-offset-0";
const iconBtn =
  "inline-grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-ink-2 hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent";

const RESET_ID = "profiles-reset";
const FIELD_ORDER: Field[] = ["name", "note", "prompt", "maxTurns"];

// Unsaved edits stay when the settings close. The browser warns before a reload or a close drops them.
let kept: Draft[] | null = null;
window.addEventListener("beforeunload", (e) => {
  if (kept) e.preventDefault();
});

export function ReviewProfiles({ settings }: { settings: SettingsDto }) {
  const qc = useQueryClient();
  const save = useSaveSettings();
  const runner = useMeta().data?.runner.short ?? "";
  const [drafts, setDrafts] = useState(() => kept ?? toDrafts(settings.profiles));
  const [focus, setFocus] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const valid = allValid(drafts);
  const dirty = !sameProfiles(toProfiles(drafts), settings.profiles);

  useEffect(() => {
    kept = dirty ? drafts : null;
  }, [dirty, drafts]);

  // Focus moves after the list renders with the change.
  useEffect(() => {
    if (focus) document.getElementById(focus)?.focus();
    setFocus(null);
  }, [focus]);

  const apply = (c: Change) => {
    const next = change(drafts, c);
    setDrafts(next);
    setSaved(false);
    if (c.act !== "edit") setFocus(focusAfter(c, next.length));
  };

  // null restores the shipped profiles.
  const send = (profiles: ProfileInput[] | null) =>
    save.mutate(
      { baseUrl: settings.baseUrl ?? "", caFile: settings.caFile ?? "", profiles },
      {
        onSuccess: (dto) => {
          // The saved IDs of new profiles stay fixed from now on.
          setDrafts(toDrafts(dto.profiles));
          setSaved(true);
          setConfirm(false);
          if (profiles === null) setFocus(RESET_ID);
          // Meta never goes stale by itself. The Review button and the brief read the profiles from it.
          void qc.invalidateQueries({ queryKey: ["meta"] });
          // The server gives the first profile for a brief whose profile is gone.
          void qc.invalidateQueries({ queryKey: ["brief"] });
        },
      },
    );

  const cancelReset = () => {
    setConfirm(false);
    setFocus(RESET_ID);
  };

  return (
    <section aria-labelledby="h-profiles" className="mt-6 grid max-w-[86ch] gap-3 border-t pt-4">
      <h2 id="h-profiles" className="m-0 text-[15px] font-bold">
        Review profiles
      </h2>
      <p className="m-0 max-w-[72ch] text-sm text-ink-2">
        Each profile tells {runner} what to check. The review brief lists the profiles in this order. A run keeps the profile name it
        started with.
      </p>
      {/* Edits wait for the save, because its answer replaces the list. */}
      <fieldset disabled={save.isPending} className="min-w-0">
        <ol aria-label="Review profiles" className="m-0 list-none border-t p-0">
          {drafts.map((d, i) => (
            <ProfileRow key={d.key} d={d} i={i} count={drafts.length} onChange={apply} />
          ))}
        </ol>
      </fieldset>
      <div>
        <Button
          id={ADD_ID}
          variant="outline"
          size="sm"
          disabled={drafts.length >= LIMITS.profiles || save.isPending}
          onClick={() => apply({ act: "add" })}
        >
          <Plus data-icon="inline-start" />
          Add profile
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button disabled={!dirty || !valid || save.isPending} onClick={() => send(toProfiles(drafts))}>
          {save.isPending && !confirm ? "Saving…" : "Save profiles"}
        </Button>
        <p role="status" className="m-0 text-sm text-ink-2">
          {dirty ? "Unsaved changes." : saved ? "Saved. New reviews use these profiles." : ""}
        </p>
        <Button
          id={RESET_ID}
          variant="ghost"
          size="sm"
          className="ml-auto text-ink-2"
          aria-expanded={confirm}
          disabled={save.isPending}
          onClick={() => setConfirm(true)}
        >
          <RotateCcw data-icon="inline-start" />
          Reset to shipped profiles
        </Button>
      </div>
      {confirm && <ResetConfirm pending={save.isPending} onReset={() => send(null)} onCancel={cancelReset} />}
      {save.error && !(save.error instanceof TypeError) && <FieldError>{save.error.message}</FieldError>}
    </section>
  );
}

function ResetConfirm({ pending, onReset, onCancel }: { pending: boolean; onReset: () => void; onCancel: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => cancel.current?.focus(), []);
  return (
    // Esc closes the settings everywhere else. Here it closes only the question.
    <fieldset
      aria-labelledby="profiles-reset-q"
      className="grid min-w-0 gap-2.5 rounded-lg bg-pane-2 p-3"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onCancel();
      }}
    >
      <p id="profiles-reset-q" className="m-0 text-sm">
        Replace all profiles with the shipped profiles? Your own profiles and prompt changes are lost.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="destructive" size="sm" disabled={pending} onClick={onReset}>
          {pending ? "Resetting…" : "Reset profiles"}
        </Button>
        <Button ref={cancel} variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </fieldset>
  );
}

// A checkbox with its label and one line of help.
function Toggle(props: { id: string; label: ReactNode; help: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="grid min-w-0 gap-px">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          id={props.id}
          aria-describedby={`${props.id}-help`}
          className="size-4 shrink-0 accent-primary"
          checked={props.checked}
          onChange={(e) => props.onChange(e.target.checked)}
        />
        <span>{props.label}</span>
      </label>
      <span id={`${props.id}-help`} className="pl-6 text-xs text-muted-foreground">
        {props.help}
      </span>
    </div>
  );
}

function ProfileRow({ d, i, count, onChange }: { d: Draft; i: number; count: number; onChange: (c: Change) => void }) {
  const found = problems(d);
  const label = profileLabel(d, i);
  const of = <span className="sr-only"> of profile {i + 1}</span>;
  const edit = (patch: Edit) => onChange({ act: "edit", i, patch });
  const invalid = (f: Field) => ({
    "aria-invalid": !!found[f],
    "aria-describedby": found[f] ? profileId(i, `${f}-error`) : undefined,
  });
  const errors = FIELD_ORDER.filter((f) => found[f]);
  return (
    <li className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_4.5rem_auto] items-end gap-x-3 gap-y-2.5 border-b py-3 @max-[559px]:grid-cols-[minmax(0,1fr)_4.5rem_auto]">
      <label className={field}>
        <span>Name{of}</span>
        <input
          id={profileId(i, "name")}
          className={cn(control, "font-semibold")}
          value={d.name}
          autoComplete="off"
          onChange={(e) => edit({ name: e.target.value })}
          {...invalid("name")}
        />
      </label>
      <label className={cn(field, "@max-[559px]:col-span-full @max-[559px]:row-start-2")}>
        <span>Note{of}</span>
        <input
          id={profileId(i, "note")}
          className={control}
          value={d.note}
          autoComplete="off"
          placeholder="Shown in the review brief…"
          onChange={(e) => edit({ note: e.target.value })}
          {...invalid("note")}
        />
      </label>
      <label className={field}>
        <span>Turn cap{of}</span>
        <input
          type="number"
          id={profileId(i, "turns")}
          inputMode="numeric"
          min={LIMITS.minTurns}
          max={LIMITS.maxTurns}
          step={1}
          className={cn(control, "tabular-nums")}
          value={d.maxTurns}
          onChange={(e) => edit({ maxTurns: e.target.value })}
          {...invalid("maxTurns")}
        />
      </label>
      <span className="flex gap-0.5">
        <Hint label="Move up">
          <button
            type="button"
            id={profileId(i, "up")}
            className={iconBtn}
            aria-label={`Move ${label} up`}
            disabled={i === 0}
            onClick={() => onChange({ act: "move", i, d: -1 })}
          >
            <ArrowUp aria-hidden className="size-[15px]" />
          </button>
        </Hint>
        <Hint label="Move down">
          <button
            type="button"
            id={profileId(i, "down")}
            className={iconBtn}
            aria-label={`Move ${label} down`}
            disabled={i === count - 1}
            onClick={() => onChange({ act: "move", i, d: 1 })}
          >
            <ArrowDown aria-hidden className="size-[15px]" />
          </button>
        </Hint>
        <Hint label="Remove">
          <button
            type="button"
            id={profileId(i, "remove")}
            className={iconBtn}
            aria-label={`Remove ${label}`}
            disabled={count <= 1}
            onClick={() => onChange({ act: "remove", i })}
          >
            <X aria-hidden className="size-[15px]" />
          </button>
        </Hint>
      </span>
      <label className={cn(field, "col-span-full")}>
        <span>Prompt{of}</span>
        <textarea
          id={profileId(i, "prompt")}
          className={cn(control, "h-auto max-h-72 min-h-[4.5rem] resize-y py-1.5 leading-normal field-sizing-content")}
          value={d.prompt}
          placeholder="What this profile checks, in plain words…"
          onChange={(e) => edit({ prompt: e.target.value })}
          {...invalid("prompt")}
        />
      </label>
      <div className="col-span-full flex flex-wrap gap-x-8 gap-y-2">
        <Toggle
          id={profileId(i, "explain")}
          label={<>Explain only{of}</>}
          help="Summary, risks, and questions. No findings."
          checked={d.explain}
          onChange={(explain) => edit({ explain })}
        />
        <Toggle
          id={profileId(i, "docs")}
          label={<>Documentation{of}</>}
          help="Checks library and API facts in public documentation."
          checked={d.docs}
          onChange={(docs) => edit({ docs })}
        />
      </div>
      {errors.length > 0 && (
        <div className="col-span-full grid gap-1">
          {errors.map((f) => (
            <p key={f} id={profileId(i, `${f}-error`)} className="m-0 flex items-start gap-[5px] text-xs text-destructive">
              <CircleAlert aria-hidden className="mt-px size-[15px] shrink-0" />
              <span>{found[f]}</span>
            </p>
          ))}
        </div>
      )}
    </li>
  );
}
