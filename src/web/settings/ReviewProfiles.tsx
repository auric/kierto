// Review profiles settings (M4, BRIEF US9): name, note, prompt, Explain, Docs, turn cap, and the run setup, in the order of the review brief.
// Each change saves by itself (autosave.tsx). A field with a problem stays unsaved until the user fixes it.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CircleAlert, Plus, RotateCcw, X } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  type Effort,
  type McpPick,
  type McpServerDto,
  type McpToolDto,
  type McpToolSafety,
  mcpToolSafety,
  type ProfileInput,
  type ReviewerMode,
  type SettingsDto,
  type SkillDto,
} from "../../shared/dto";
import { api } from "../api";
import { dialogKeys } from "../fix/CloneDialog";
import { useMeta } from "../meta";
import { read } from "../shell/data";
import { Hint } from "../shell/Hint";
import { SaveStatus, TYPING_MS, useSaver } from "./autosave";
import {
  ADD_ID,
  addSkills,
  type Change,
  change,
  type Draft,
  defaultChoice,
  type Edit,
  EFFORT_CHOICES,
  type Field,
  focusAfter,
  LIMITS,
  modelChoice,
  problems,
  profileId,
  profileLabel,
  sameProfiles,
  selectAll,
  setTools,
  tickAction,
  toDrafts,
  toggleServer,
  toggleSkill,
  toPayload,
  unmarkedListQuestion,
  unmarkedQuestion,
} from "./profiles";

// The TaskRules.tsx control styles.
const field = "grid min-w-0 gap-[3px] text-xs text-muted-foreground";
const control =
  "h-[30px] w-full min-w-0 rounded-md border border-input bg-pane px-2 text-sm text-foreground aria-invalid:border-destructive focus-visible:outline-offset-0 disabled:opacity-50";
const iconBtn =
  "inline-grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-ink-2 hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent";
// One row of the run setup: a label column and the controls. A narrow pane puts the label above.
const setupRow = "grid min-w-0 grid-cols-[8.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 @max-[559px]:grid-cols-1";
const setupLabel = "text-sm leading-[30px] text-ink-2 @max-[559px]:leading-normal";

const RESET_ID = "profiles-reset";
const STATUS_ID = "profiles-status";
const FIELD_ORDER: Field[] = ["name", "note", "prompt", "maxTurns", "model", "reviewerModel"];
const EFFORT_NAME: Record<Effort, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
const MODES: [ReviewerMode, string, (runner: string) => string][] = [
  ["auto", "Auto", (r) => `${r} gives parts of a large change to reviewer agents when it sees fit.`],
  ["always", "Always", (r) => `${r} splits the changed files across reviewer agents, then checks and merges their findings.`],
  ["off", "Off", () => "One agent reviews the whole change."],
];
// An alias as a menu item: opus reads as Opus.
const aliasName = (m: string) => m.charAt(0).toUpperCase() + m.slice(1);
// More chips than this show as a count.
const MAX_CHIPS = 12;
// SKILL_INDEX_AFTER of src/server/review/skills.ts.
const INDEX_AFTER = 5;

// The skills of the runner setup, by ID. undefined: the list is loading or failed.
type SkillList = Map<string, SkillDto> | undefined;
// The MCP servers of the runner setup, by name. undefined: the list is loading or failed.
type ServerList = Map<string, McpServerDto> | undefined;
type Lists = { skills: SkillList; skillsFailed: boolean; servers: ServerList; serversFailed: boolean };

async function putSettings(input: Parameters<typeof api.api.settings.$put>[0]["json"]) {
  return read<SettingsDto>(await api.api.settings.$put({ json: input }));
}

// target: the profile that "Edit profile…" opened. n changes on each request, so the same profile can be asked again.
export function ReviewProfiles({ settings, target }: { settings: SettingsDto; target?: { id: string; n: number } | null }) {
  const qc = useQueryClient();
  const skills = useQuery({
    queryKey: ["skills"],
    queryFn: async () => read<SkillDto[]>(await api.api.skills.$get()),
    select: (l) => new Map(l.map((s) => [s.id, s])),
  });
  const servers = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: async () => read<McpServerDto[]>(await api.api["mcp-servers"].$get()),
    select: (l) => new Map(l.map((s) => [s.name, s])),
  });
  const lists: Lists = { skills: skills.data, skillsFailed: skills.isError, servers: servers.data, serversFailed: servers.isError };
  const runner = useMeta().data?.runner.short ?? "";
  const [drafts, setDrafts] = useState(() => toDrafts(settings.profiles));
  // The newest drafts. Event handlers set it before the render, so a save in the same handler sends the change.
  const list = useRef(drafts);
  const [focus, setFocus] = useState<{ id: string; select?: boolean } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const removeFocus = useRef<string | null>(null);

  // The cache holds the newest saved settings, also after a save in another section.
  const current = () => qc.getQueryData<SettingsDto>(["settings"]) ?? settings;
  const onSaved = (dto: SettingsDto) => {
    qc.setQueryData(["settings"], dto);
    // Meta never goes stale by itself. The Review button and the brief read the profiles from it.
    void qc.invalidateQueries({ queryKey: ["meta"] });
    // The server gives the first profile for a brief whose profile is gone.
    void qc.invalidateQueries({ queryKey: ["brief"] });
  };
  const { state, saver } = useSaver(
    () => {
      const saved = current().profiles;
      const payload = toPayload(list.current, saved);
      return sameProfiles(payload, saved) ? null : payload;
    },
    async (profiles: ProfileInput[]) => {
      const s = current();
      onSaved(await putSettings({ baseUrl: s.baseUrl ?? "", caFile: s.caFile ?? "", profiles }));
    },
  );

  // A reload drops a change that waits or is on its way. The browser asks first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!saver.busy()) return;
      void saver.flush();
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saver]);

  // Focus moves after the list renders with the change.
  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(focus.id);
    el?.focus();
    if (focus.select && el instanceof HTMLInputElement) el.select();
    setFocus(null);
  }, [focus]);

  // "Edit profile…" opens the settings at this profile.
  useLayoutEffect(() => {
    if (!target) return;
    const i = list.current.findIndex((d) => d.id === target.id);
    if (i < 0) return;
    document.getElementById(profileId(i, "row"))?.scrollIntoView({ block: "start" });
    document.getElementById(profileId(i, "name"))?.focus({ preventScroll: true });
  }, [target]);

  // delay: 0 for a toggle, a select, or a list change; TYPING_MS for a key in a text field.
  const apply = (c: Change, delay = 0) => {
    const next = change(list.current, c);
    if (next === list.current) return;
    list.current = next;
    setDrafts(next);
    if (c.act === "add") setFocus({ id: focusAfter(c, next.length) as string, select: true });
    else if (c.act === "move") setFocus({ id: focusAfter(c, next.length) as string });
    saver.request(delay);
  };

  const askRemove = (i: number) => {
    removeFocus.current = null;
    setRemoving(i);
  };
  const remove = (i: number) => {
    const c: Change = { act: "remove", i };
    removeFocus.current = focusAfter(c, list.current.length - 1);
    setRemoving(null);
    apply(c);
  };

  const reset = async () => {
    saver.cancel();
    await saver.flush();
    setResetting(true);
    setResetError(null);
    try {
      const s = current();
      const dto = await putSettings({ baseUrl: s.baseUrl ?? "", caFile: s.caFile ?? "", profiles: null });
      onSaved(dto);
      list.current = toDrafts(dto.profiles);
      setDrafts(list.current);
      setConfirm(false);
      setFocus({ id: RESET_ID });
    } catch (e) {
      setResetError((e as Error).message);
    } finally {
      setResetting(false);
    }
  };

  const cancelReset = () => {
    setConfirm(false);
    setFocus({ id: RESET_ID });
  };

  const invalid = drafts.some((d) => Object.keys(problems(d)).length > 0);
  const gone = removing === null ? undefined : drafts[removing];
  return (
    <section aria-labelledby="h-profiles" className="mt-6 grid max-w-[86ch] gap-3 border-t pt-4">
      {/* The save state stays in view while the list scrolls. -top-[18px] cancels the top padding of the Settings scroll pane. */}
      <div className="sticky -top-[18px] z-[1] -mt-2 grid gap-0.5 border-b bg-pane pt-2 pb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="h-profiles" tabIndex={-1} className="m-0 scroll-mt-4 text-[15px] font-bold outline-none">
            Review profiles
          </h2>
          <SaveStatus
            id={STATUS_ID}
            state={state}
            problem={invalid ? "A marked field is not saved. Fix it to save it." : null}
            saved="Saved. New runs use these profiles."
            onRetry={() => saver.request(0)}
          />
        </div>
        <p className="m-0 text-xs text-muted-foreground">
          Changes save as you make them. Text saves when you leave the field or stop typing.
        </p>
      </div>
      <p className="m-0 max-w-[72ch] text-sm text-ink-2">
        Each profile tells {runner} what to check and how to run. The review brief lists the profiles in this order. A run keeps the profile
        name it started with.
      </p>
      <fieldset disabled={resetting} className="min-w-0">
        <ol aria-label="Review profiles" className="m-0 list-none p-0">
          {drafts.map((d, i) => (
            <ProfileRow
              key={d.key}
              d={d}
              i={i}
              count={drafts.length}
              lists={lists}
              onChange={apply}
              onBlur={() => void saver.flush()}
              onRemove={askRemove}
            />
          ))}
        </ol>
      </fieldset>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          id={ADD_ID}
          variant="outline"
          size="sm"
          disabled={drafts.length >= LIMITS.profiles || resetting}
          onClick={() => apply({ act: "add" })}
        >
          <Plus data-icon="inline-start" />
          Add profile
        </Button>
        <Button
          id={RESET_ID}
          variant="ghost"
          size="sm"
          className="ml-auto text-ink-2"
          aria-expanded={confirm}
          disabled={resetting}
          onClick={() => setConfirm(true)}
        >
          <RotateCcw data-icon="inline-start" />
          Reset to shipped profiles
        </Button>
      </div>
      {confirm && <ResetConfirm pending={resetting} onReset={() => void reset()} onCancel={cancelReset} />}
      {resetError && <FieldError>{resetError}</FieldError>}
      <Dialog open={removing !== null} onOpenChange={(on) => !on && setRemoving(null)}>
        <DialogContent
          className="sm:max-w-[440px]"
          finalFocus={() => (removeFocus.current && document.getElementById(removeFocus.current)) || true}
          onKeyDown={dialogKeys(() => setRemoving(null))}
        >
          {gone && removing !== null && (
            <>
              <DialogHeader>
                <DialogTitle>Remove {profileLabel(gone, removing)}?</DialogTitle>
                <DialogDescription>
                  Finished runs keep their results and the profile name. A review brief that uses this profile switches to the first
                  profile.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setRemoving(null)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={() => remove(removing)}>
                  Remove profile
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
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

type RowProps = {
  d: Draft;
  i: number;
  count: number;
  lists: Lists;
  onChange: (c: Change, delay?: number) => void;
  onBlur: () => void;
  onRemove: (i: number) => void;
};

function ProfileRow(props: RowProps) {
  const { d, i, count, onChange, onBlur } = props;
  const found = problems(d);
  const label = profileLabel(d, i);
  const of = <span className="sr-only"> of profile {i + 1}</span>;
  const edit = (patch: Edit) => onChange({ act: "edit", i, patch });
  const type = (patch: Edit) => onChange({ act: "edit", i, patch }, TYPING_MS);
  const invalid = (f: Field) => ({
    "aria-invalid": !!found[f],
    "aria-describedby": found[f] ? profileId(i, `${f}-error`) : undefined,
  });
  const errors = FIELD_ORDER.filter((f) => found[f]);
  return (
    <li
      id={profileId(i, "row")}
      className="grid scroll-mt-16 grid-cols-[minmax(0,12rem)_minmax(0,1fr)_4.5rem_auto] items-end gap-x-3 gap-y-2.5 border-b py-3.5 @max-[559px]:grid-cols-[minmax(0,1fr)_4.5rem_auto]"
    >
      <label className={field}>
        <span>Name{of}</span>
        <input
          id={profileId(i, "name")}
          className={cn(control, "font-semibold")}
          value={d.name}
          autoComplete="off"
          onChange={(e) => type({ name: e.target.value })}
          onBlur={onBlur}
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
          onChange={(e) => type({ note: e.target.value })}
          onBlur={onBlur}
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
          onChange={(e) => type({ maxTurns: e.target.value })}
          onBlur={onBlur}
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
            aria-haspopup="dialog"
            disabled={count <= 1}
            onClick={() => props.onRemove(i)}
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
          onChange={(e) => type({ prompt: e.target.value })}
          onBlur={onBlur}
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
        <Toggle
          id={profileId(i, "lang")}
          label={<>Language checks{of}</>}
          help="Adds checklists for the languages in the change. Review runs only."
          checked={d.languageChecks}
          onChange={(languageChecks) => edit({ languageChecks })}
        />
      </div>
      <RunSetup {...props} found={found} />
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

// The flags and the agents, skills, and MCP servers of each run of the profile. Always open, so each choice stays in view.
function RunSetup(props: RowProps & { found: ReturnType<typeof problems> }) {
  const { d, i, onChange, onBlur, found } = props;
  const meta = useMeta().data?.runner;
  const runner = meta?.name ?? "";
  const edit = (patch: Edit) => onChange({ act: "edit", i, patch });
  const type = (patch: Edit) => onChange({ act: "edit", i, patch }, TYPING_MS);
  const reviewer = (patch: Partial<Draft["reviewer"]>, delay = 0) =>
    onChange({ act: "edit", i, patch: { reviewer: { ...d.reviewer, ...patch } } }, delay);
  const of = <span className="sr-only"> of profile {i + 1}</span>;
  const head = profileId(i, "setup");
  const noAgents = d.explain ? "Explain only runs use no reviewer agents." : null;
  const mode = MODES.find(([m]) => m === d.reviewer.mode);
  const defaults = meta?.defaults;
  return (
    <fieldset aria-labelledby={head} className="col-span-full grid min-w-0 gap-2 rounded-lg bg-pane-2 px-3 pt-2.5 pb-3">
      <div className="grid gap-px">
        <p id={head} className="m-0 text-sm font-semibold">
          Run setup<span className="sr-only"> of profile {i + 1}</span>
        </p>
        <p className="m-0 text-xs text-muted-foreground">
          Applies to every run of this profile. Use my default leaves the choice to your {runner} settings.
        </p>
      </div>
      <div className={setupRow}>
        <label htmlFor={profileId(i, "model")} className={setupLabel}>
          Model{of}
        </label>
        <ModelPick
          id={profileId(i, "model")}
          textId={profileId(i, "model-id")}
          label={`Model ID of profile ${i + 1}`}
          value={d.model}
          fallback={defaultChoice(defaults?.model)}
          error={found.model ? profileId(i, "model-error") : undefined}
          onPick={(model) => edit({ model })}
          onText={(model) => type({ model })}
          onBlur={onBlur}
        />
      </div>
      <div className={setupRow}>
        <label htmlFor={profileId(i, "effort")} className={setupLabel}>
          Effort{of}
        </label>
        <EffortPick
          id={profileId(i, "effort")}
          value={d.effort}
          fallback={defaultChoice(defaults?.effort[d.model.trim()])}
          onPick={(effort) => edit({ effort })}
        />
      </div>
      <div className={setupRow}>
        <span id={profileId(i, "reviewer")} className={setupLabel}>
          Reviewer agents{of}
        </span>
        <div className="grid min-w-0 gap-1.5">
          <div
            role="radiogroup"
            aria-labelledby={profileId(i, "reviewer")}
            aria-describedby={`${profileId(i, "reviewer")}-help`}
            className="flex w-fit flex-wrap gap-0.5 rounded-lg border bg-pane p-0.5"
          >
            {MODES.map(([m, name]) => (
              <label
                key={m}
                className="flex cursor-pointer items-center rounded-md px-2.5 py-0.5 text-sm text-ink-2 hover:text-foreground has-checked:bg-sel has-checked:font-semibold has-checked:text-foreground has-disabled:cursor-default has-disabled:opacity-50 has-focus-visible:outline-2 has-focus-visible:outline-ring"
              >
                <input
                  type="radio"
                  name={`reviewer-mode-${d.key}`}
                  value={m}
                  className="sr-only"
                  checked={d.reviewer.mode === m}
                  disabled={!!noAgents}
                  onChange={() => reviewer({ mode: m })}
                />
                {name}
              </label>
            ))}
          </div>
          <p id={`${profileId(i, "reviewer")}-help`} className="m-0 text-xs text-muted-foreground">
            {noAgents ?? mode?.[2](meta?.short ?? "")}
          </p>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <div className={field}>
              <label htmlFor={profileId(i, "reviewer-model")}>Agent model{of}</label>
              <ModelPick
                id={profileId(i, "reviewer-model")}
                textId={profileId(i, "reviewer-model-id")}
                label={`Agent model ID of profile ${i + 1}`}
                value={d.reviewer.model}
                disabled={!!noAgents || d.reviewer.mode === "off"}
                error={found.reviewerModel ? profileId(i, "reviewerModel-error") : undefined}
                onPick={(model) => reviewer({ model })}
                onText={(model) => reviewer({ model }, TYPING_MS)}
                onBlur={onBlur}
              />
            </div>
            <div className={field}>
              <label htmlFor={profileId(i, "reviewer-effort")}>Agent effort{of}</label>
              <EffortPick
                id={profileId(i, "reviewer-effort")}
                value={d.reviewer.effort}
                disabled={!!noAgents || d.reviewer.mode === "off"}
                onPick={(effort) => reviewer({ effort })}
              />
            </div>
          </div>
        </div>
      </div>
      <SkillsField {...props} />
      <McpField {...props} />
    </fieldset>
  );
}

// A select of the aliases, with a text field for any other model ID.
function ModelPick(props: {
  id: string;
  textId: string;
  label: string;
  value: string;
  // The text of the "no flag" choice. Agent pickers keep the plain text: an agent inherits the model and effort of the main run.
  fallback?: string;
  disabled?: boolean;
  error?: string;
  onPick: (model: string) => void;
  onText: (model: string) => void;
  onBlur: () => void;
}) {
  const runner = useMeta().data?.runner;
  const aliases = runner?.models ?? [];
  // chose: the user picked "Other model ID…", so the text field stays while it holds an alias or nothing.
  const [chose, setChose] = useState(false);
  const text = useRef<HTMLInputElement>(null);
  const choice = chose ? "other" : modelChoice(props.value, aliases);
  useEffect(() => {
    if (chose) text.current?.focus();
  }, [chose]);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <select
        id={props.id}
        className={cn(control, "w-auto")}
        value={choice}
        disabled={props.disabled}
        onChange={(e) => {
          const v = e.target.value;
          setChose(v === "other");
          if (v !== "other") props.onPick(v);
        }}
      >
        <option value="">{props.fallback ?? "Use my default"}</option>
        {aliases.map((m) => (
          <option key={m} value={m}>
            {aliasName(m)}
          </option>
        ))}
        <option value="other">Other model ID…</option>
      </select>
      {choice === "other" && (
        <input
          ref={text}
          id={props.textId}
          aria-label={props.label}
          className={cn(control, "w-[16rem] max-w-full font-mono text-[12.5px]")}
          value={props.value}
          disabled={props.disabled}
          maxLength={LIMITS.model}
          spellCheck={false}
          autoComplete="off"
          placeholder={runner?.modelExample}
          aria-invalid={!!props.error}
          aria-describedby={props.error}
          onChange={(e) => props.onText(e.target.value)}
          onBlur={props.onBlur}
        />
      )}
    </span>
  );
}

function EffortPick(props: {
  id: string;
  value: Effort | "";
  fallback?: string;
  disabled?: boolean;
  onPick: (effort: Effort | "") => void;
}) {
  return (
    <select
      id={props.id}
      className={cn(control, "w-auto justify-self-start")}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onPick(e.target.value as Effort | "")}
    >
      <option value="">{props.fallback ?? "Use my default"}</option>
      {EFFORT_CHOICES.map((e) => (
        <option key={e} value={e}>
          {EFFORT_NAME[e]}
        </option>
      ))}
    </select>
  );
}

const warn = (text: ReactNode) => (
  <span className="flex items-start gap-[5px] text-destructive">
    <CircleAlert aria-hidden className="mt-px size-[15px] shrink-0" />
    {text}
  </span>
);

// The chips of a field: the first MAX_CHIPS items, then a count.
function Chips({ label, items }: { label: string; items: { key: string; text: ReactNode; missing?: boolean }[] }) {
  if (!items.length) return <span className="text-sm leading-[30px] text-muted-foreground">None</span>;
  const more = items.length - MAX_CHIPS;
  return (
    <ul aria-label={label} className="m-0 flex min-w-0 list-none flex-wrap items-center gap-1.5 p-0 py-[5px]">
      {items.slice(0, MAX_CHIPS).map((it) => (
        <li key={it.key} className="min-w-0">
          <Badge variant={it.missing ? "outline" : "secondary"} className={cn("max-w-full", it.missing && "text-destructive")}>
            {it.missing && <CircleAlert aria-hidden />}
            <span className="truncate">{it.text}</span>
          </Badge>
        </li>
      ))}
      {more > 0 && <li className="text-xs text-muted-foreground">and {more} more</li>}
    </ul>
  );
}

// Runner skills for one profile. The run copies each picked skill into ./skills. A picked skill that the setup lacks shows a warning.
function SkillsField(props: RowProps) {
  const { d, i, lists, onChange } = props;
  const [open, setOpen] = useState(false);
  const skills = lists.skills;
  const items = d.skills.map((id) => {
    const missing = !!skills && !skills.has(id);
    return {
      key: id,
      missing,
      text: (
        <>
          {skills?.get(id)?.name ?? id}
          {missing && <span className="sr-only">, not found</span>}
        </>
      ),
    };
  });
  return (
    <div className={setupRow}>
      <span id={profileId(i, "skills-label")} className={setupLabel}>
        Skills<span className="sr-only"> of profile {i + 1}</span>
      </span>
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
          <Chips label={`Skills of profile ${i + 1}`} items={items} />
          <Button
            id={profileId(i, "skills")}
            variant="outline"
            size="sm"
            className="my-px"
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
          >
            Choose…<span className="sr-only"> skills of profile {i + 1}</span>
          </Button>
        </div>
        {d.skills.length > INDEX_AFTER && (
          <p className="m-0 text-xs text-muted-foreground">
            With more than {INDEX_AFTER} skills, the run lists them in skills/INDEX.md, and the model reads only the skills that apply.
          </p>
        )}
      </div>
      <SkillsDialog
        open={open}
        onClose={() => setOpen(false)}
        title={profileLabel(d, i)}
        picked={d.skills}
        skills={skills}
        failed={lists.skillsFailed}
        onChange={(next) => onChange({ act: "edit", i, patch: { skills: next } })}
      />
    </div>
  );
}

function SkillsDialog(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  picked: string[];
  skills: SkillList;
  failed: boolean;
  onChange: (skills: string[]) => void;
}) {
  const { picked, skills } = props;
  const runner = useMeta().data?.runner.name ?? "";
  const [q, setQ] = useState("");
  const close = () => {
    setQ("");
    props.onClose();
  };
  const all = [...(skills?.values() ?? [])];
  const query = q.trim().toLowerCase();
  const shown = query ? all.filter((s) => `${s.name} ${s.id} ${s.description}`.toLowerCase().includes(query)) : all;
  const missing = skills ? picked.filter((id) => !skills.has(id)) : [];
  const full = picked.length >= LIMITS.skills;
  const box = (id: string, name: ReactNode, help: ReactNode) => (
    <li key={id}>
      <label className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-sm text-foreground hover:bg-hover">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-primary"
          checked={picked.includes(id)}
          disabled={full && !picked.includes(id)}
          onChange={(e) => props.onChange(toggleSkill(picked, id, e.target.checked))}
        />
        <span className="grid min-w-0 gap-px">
          <span>{name}</span>
          <span className="text-xs break-words text-muted-foreground">{help}</span>
        </span>
      </label>
    </li>
  );
  return (
    <Dialog open={props.open} onOpenChange={(on) => !on && close()}>
      <DialogContent className="flex max-h-[min(44rem,calc(100dvh-2rem))] flex-col sm:max-w-[600px]" onKeyDown={dialogKeys(close)}>
        <DialogHeader>
          <DialogTitle>Skills of {props.title}</DialogTitle>
          <DialogDescription>
            The run copies each chosen skill from your {runner} setup and tells the model to read it. Skill scripts do not run. Each change
            saves at once.
          </DialogDescription>
        </DialogHeader>
        <Input
          type="search"
          aria-label="Search skills"
          placeholder="Search skills…"
          autoComplete="off"
          spellCheck={false}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p role="status" className="m-0 mr-auto text-xs text-muted-foreground">
            {picked.length} of {all.length} chosen{query ? `, ${shown.length} shown` : ""}
            {full ? `. A profile takes at most ${LIMITS.skills} skills.` : ""}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={!shown.some((s) => !picked.includes(s.id)) || full}
            onClick={() =>
              props.onChange(
                addSkills(
                  picked,
                  shown.map((s) => s.id),
                ),
              )
            }
          >
            {query ? "Select all shown" : "Select all"}
          </Button>
          <Button variant="outline" size="sm" disabled={!picked.length} onClick={() => props.onChange([])}>
            Clear
          </Button>
        </div>
        <div className="-mx-1 min-h-0 flex-1 overflow-auto px-1">
          {props.failed && <p className="m-0 text-sm text-destructive">Could not list the skills.</p>}
          {!skills && !props.failed && <p className="m-0 text-sm text-muted-foreground">Loading skills…</p>}
          {skills && skills.size === 0 && <p className="m-0 text-sm text-muted-foreground">{runner} has no skills.</p>}
          {skills && skills.size > 0 && !shown.length && <p className="m-0 text-sm text-muted-foreground">No skill matches the search.</p>}
          <ul aria-label="Skills" className="m-0 grid list-none gap-0.5 p-0">
            {missing.map((id) =>
              box(id, <span className="font-mono text-xs">{id}</span>, warn(`Not found in ${runner}. Runs go on without it.`)),
            )}
            {shown.map((s) =>
              box(
                s.id,
                <>
                  {s.name} <span className="font-mono text-xs text-muted-foreground">{s.id}</span>
                </>,
                <>
                  {s.source === "plugin" ? `Plugin${s.version ? ` ${s.version}` : ""}` : "User skill"}
                  {s.description && ` · ${s.description}`}
                </>,
              ),
            )}
          </ul>
        </div>
        <DialogFooter>
          <Button onClick={close}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// MCP servers of the runner setup for one profile. A run allows only the ticked tools of each picked server.
function McpField(props: RowProps) {
  const { d, i, lists, onChange } = props;
  const [open, setOpen] = useState(false);
  const servers = lists.servers;
  const items = d.mcp.map((m) => {
    const missing = !!servers && !servers.has(m.server);
    const n = m.tools.length;
    return {
      key: m.server,
      missing,
      text: (
        <>
          {m.server} ({n ? `${n} ${n === 1 ? "tool" : "tools"}` : "no tool, skipped"})
          {missing && <span className="sr-only">, not found</span>}
        </>
      ),
    };
  });
  return (
    <div className={setupRow}>
      <span id={profileId(i, "mcp-label")} className={setupLabel}>
        MCP servers<span className="sr-only"> of profile {i + 1}</span>
      </span>
      <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
        <Chips label={`MCP servers of profile ${i + 1}`} items={items} />
        <Button id={profileId(i, "mcp")} variant="outline" size="sm" className="my-px" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          Choose…<span className="sr-only"> MCP servers of profile {i + 1}</span>
        </Button>
      </div>
      <McpDialog
        open={open}
        onClose={() => setOpen(false)}
        title={profileLabel(d, i)}
        picked={d.mcp}
        servers={servers}
        failed={lists.serversFailed}
        onChange={(mcp) => onChange({ act: "edit", i, patch: { mcp } })}
      />
    </div>
  );
}

function McpDialog(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  picked: McpPick[];
  servers: ServerList;
  failed: boolean;
  onChange: (mcp: McpPick[]) => void;
}) {
  const { picked, servers } = props;
  const runner = useMeta().data?.runner.name ?? "";
  const missing = servers ? picked.filter((m) => !servers.has(m.server)) : [];
  const full = picked.length >= LIMITS.mcp;
  const row = (name: string, server: McpServerDto | undefined) => (
    <McpServerRow
      key={name}
      name={name}
      server={server}
      pick={picked.find((m) => m.server === name)}
      full={full}
      runner={runner}
      list={picked}
      onChange={props.onChange}
    />
  );
  return (
    <Dialog open={props.open} onOpenChange={(on) => !on && props.onClose()}>
      <DialogContent className="flex max-h-[min(44rem,calc(100dvh-2rem))] flex-col sm:max-w-[600px]" onKeyDown={dialogKeys(props.onClose)}>
        <DialogHeader>
          <DialogTitle>MCP servers of {props.title}</DialogTitle>
          <DialogDescription>
            The run starts each picked server from your {runner} setup and allows only the ticked tools. Tool results are untrusted data.
            Each change saves at once.
            {full && ` A profile takes at most ${LIMITS.mcp} servers.`}
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 min-h-0 flex-1 overflow-auto px-1">
          {props.failed && <p className="m-0 text-sm text-destructive">Could not list the MCP servers.</p>}
          {!servers && !props.failed && <p className="m-0 text-sm text-muted-foreground">Loading MCP servers…</p>}
          {servers && servers.size === 0 && <p className="m-0 text-sm text-muted-foreground">{runner} has no MCP servers.</p>}
          <ul aria-label="MCP servers" className="m-0 grid list-none gap-3 p-0">
            {missing.map((m) => row(m.server, undefined))}
            {[...(servers?.values() ?? [])].map((s) => row(s.name, s))}
          </ul>
        </div>
        <DialogFooter>
          <Button onClick={props.onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// server: undefined when the runner setup lacks the picked server.
function McpServerRow(props: {
  name: string;
  server: McpServerDto | undefined;
  pick: McpPick | undefined;
  full: boolean;
  runner: string;
  list: McpPick[];
  onChange: (mcp: McpPick[]) => void;
}) {
  const { name, server, pick, list, onChange } = props;
  // A new pick gets the read-only tools when the tool list arrives.
  const fresh = useRef(false);
  // The unmarked tools that wait for one confirm, and the tools that the confirm sets.
  const [asking, setAsking] = useState<{ tools: string[]; set: string[] } | null>(null);
  const tools = useQuery({
    queryKey: ["mcp-tools", name],
    enabled: !!pick && !!server,
    // Each call can start a process. The list stays until the page reloads.
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: async () => read<McpToolDto[]>(await api.api["mcp-servers"][":name"].tools.$post({ param: { name } })),
  });
  useEffect(() => {
    if (!fresh.current || !pick || !tools.data) return;
    fresh.current = false;
    const readOnly = tools.data.filter((t) => mcpToolSafety(t) === "readOnly").map((t) => t.name);
    onChange(setTools(list, name, readOnly.slice(0, LIMITS.mcpTools)));
  }, [pick, tools.data, list, name, onChange]);
  const known = new Set(tools.data?.map((t) => t.name));
  const gone = tools.data && pick ? pick.tools.filter((t) => !known.has(t)) : [];
  const fullTools = !!pick && pick.tools.length >= LIMITS.mcpTools;
  const tick = (t: string, on: boolean) => pick && onChange(setTools(list, name, toggleSkill(pick.tools, t, on)));
  const all = () => {
    if (!pick || !tools.data) return;
    const r = selectAll(
      pick.tools,
      tools.data.map((t) => ({ name: t.name, safety: mcpToolSafety(t) })),
    );
    onChange(setTools(list, name, r.tools));
    if (r.unmarked.length) setAsking({ tools: r.unmarked, set: r.withUnmarked });
  };
  // A gone tool shows only while ticked, so it only unticks.
  const tool = (t: string, help: ReactNode, safety: McpToolSafety = "readOnly") => (
    <li key={t}>
      <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-primary"
          checked={!!pick?.tools.includes(t)}
          disabled={(fullTools || safety === "blocked") && !pick?.tools.includes(t)}
          onChange={(e) => {
            const act = tickAction(safety, e.target.checked);
            if (act === "set") tick(t, e.target.checked);
            else if (act === "confirm") setAsking({ tools: [t], set: toggleSkill(pick?.tools ?? [], t, true) });
          }}
        />
        <span className="grid min-w-0 gap-px">
          <span className="font-mono text-xs">{t}</span>
          <span className="grid gap-px text-xs break-words text-muted-foreground">{help}</span>
        </span>
      </label>
    </li>
  );
  return (
    <li className="grid min-w-0 gap-1.5">
      <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-primary"
          checked={!!pick}
          disabled={props.full && !pick}
          onChange={(e) => {
            fresh.current = e.target.checked;
            onChange(toggleServer(list, name, e.target.checked));
          }}
        />
        <span className="grid min-w-0 gap-px">
          <span>{name}</span>
          <span className="text-xs break-words text-muted-foreground">
            {!server
              ? warn(`Not found in ${props.runner}. Runs go on without it.`)
              : `${server.transport === "stdio" ? "Local command" : `Remote server (${server.transport})`}${server.plugin ? `, plugin ${server.plugin}` : ""}`}
          </span>
        </span>
      </label>
      {pick && server && (
        <fieldset className="grid min-w-0 gap-2 pl-6">
          <legend className="sr-only">Tools of {name}</legend>
          {tools.isPending && <p className="m-0 text-xs text-muted-foreground">Loading tools…</p>}
          {tools.error && <p className="m-0 text-xs text-destructive">{tools.error.message}</p>}
          {tools.data && tools.data.length === 0 && <p className="m-0 text-xs text-muted-foreground">The server has no tools.</p>}
          {tools.data && tools.data.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="m-0 mr-auto text-xs text-muted-foreground">
                {pick.tools.length
                  ? `${pick.tools.length} of ${tools.data.length} tools ticked.`
                  : "No tool is ticked. Runs skip this server."}
              </p>
              <Button variant="outline" size="xs" onClick={all}>
                Select all<span className="sr-only"> tools of {name}</span>
              </Button>
              <Button variant="outline" size="xs" disabled={!pick.tools.length} onClick={() => onChange(setTools(list, name, []))}>
                Clear<span className="sr-only"> tools of {name}</span>
              </Button>
            </div>
          )}
          <ul className="m-0 grid list-none gap-2 p-0">
            {gone.map((t) => tool(t, warn("Not found in the server. Runs go on without it.")))}
            {tools.data?.map((t) => {
              const safety = mcpToolSafety(t);
              return tool(
                t.name,
                <>
                  {safety === "blocked" && warn("Blocked: the server marks this tool as able to change data.")}
                  {safety === "unmarked" && warn("May change data. Review Loop cannot check this.")}
                  {t.description && <span>{t.description}</span>}
                </>,
                safety,
              );
            })}
          </ul>
        </fieldset>
      )}
      <Dialog open={asking !== null} onOpenChange={(on) => !on && setAsking(null)}>
        <DialogContent className="sm:max-w-[480px]" onKeyDown={dialogKeys(() => setAsking(null))}>
          {asking !== null && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {asking.tools.length === 1 ? `Allow ${asking.tools[0]}?` : `Allow ${asking.tools.length} unmarked tools?`}
                </DialogTitle>
                <DialogDescription>
                  {asking.tools.length === 1 ? unmarkedQuestion(asking.tools[0] as string, name) : unmarkedListQuestion(asking.tools, name)}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAsking(null)}>
                  {asking.tools.length === 1 ? "Cancel" : "Read-only tools only"}
                </Button>
                <Button
                  onClick={() => {
                    onChange(setTools(list, name, asking.set));
                    setAsking(null);
                  }}
                >
                  Allow in runs
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </li>
  );
}
