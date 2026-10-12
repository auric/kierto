// Review profiles settings (M4, BRIEF US9): name, note, prompt, Explain, Docs, and turn cap, in the order of the review brief.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CircleAlert, Plus, RotateCcw, X } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import type { McpPick, McpServerDto, McpToolDto, ProfileInput, SettingsDto, SkillDto } from "../../shared/dto";
import { api } from "../api";
import { useMeta } from "../meta";
import { read, useSaveSettings } from "../shell/data";
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
  setTools,
  toDrafts,
  toggleServer,
  toggleSkill,
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

// The skills of the runner setup, by ID. undefined: the list is loading or failed.
type SkillList = Map<string, SkillDto> | undefined;
// The MCP servers of the runner setup, by name. undefined: the list is loading or failed.
type ServerList = Map<string, McpServerDto> | undefined;
type Lists = { skills: SkillList; skillsFailed: boolean; servers: ServerList; serversFailed: boolean };

export function ReviewProfiles({ settings }: { settings: SettingsDto }) {
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
      <div className="grid gap-0.5">
        <h2 id="h-profiles" tabIndex={-1} className="m-0 scroll-mt-4 text-[15px] font-bold outline-none">
          Review profiles
        </h2>
        <p className="m-0 text-xs text-muted-foreground">Press Save profiles to keep the changes.</p>
      </div>
      <p className="m-0 max-w-[72ch] text-sm text-ink-2">
        Each profile tells {runner} what to check. The review brief lists the profiles in this order. A run keeps the profile name it
        started with.
      </p>
      {/* Edits wait for the save, because its answer replaces the list. */}
      <fieldset disabled={save.isPending} className="min-w-0">
        <ol aria-label="Review profiles" className="m-0 list-none border-t p-0">
          {drafts.map((d, i) => (
            <ProfileRow key={d.key} d={d} i={i} count={drafts.length} lists={lists} onChange={apply} />
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

function ProfileRow(props: { d: Draft; i: number; count: number; lists: Lists; onChange: (c: Change) => void }) {
  const { d, i, count, onChange } = props;
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
      <SkillPicker d={d} i={i} skills={props.lists.skills} failed={props.lists.skillsFailed} onChange={(skills) => edit({ skills })} />
      <McpPicker d={d} i={i} servers={props.lists.servers} failed={props.lists.serversFailed} onChange={(mcp) => edit({ mcp })} />
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

// Runner skills for one profile. The run copies each picked skill into ./skills. A picked skill that the setup lacks shows a warning.
function SkillPicker(props: { d: Draft; i: number; skills: SkillList; failed: boolean; onChange: (skills: string[]) => void }) {
  const { d, i, skills } = props;
  const runner = useMeta().data?.runner.name ?? "";
  const picked = d.skills;
  const missing = skills ? picked.filter((id) => !skills.has(id)) : [];
  const full = picked.length >= LIMITS.skills;
  const summary = picked.length ? picked.map((id) => skills?.get(id)?.name ?? id).join(", ") : "none";
  const box = (id: string, name: ReactNode, help: ReactNode) => (
    <li key={id}>
      <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
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
    <details id={profileId(i, "skills")} className="col-span-full min-w-0 text-sm" open={missing.length > 0 || undefined}>
      <summary className="cursor-pointer text-ink-2">
        Skills<span className="sr-only"> of profile {i + 1}</span>: <span className="text-foreground">{summary}</span>
      </summary>
      <fieldset className="mt-2 grid min-w-0 gap-2 pl-4">
        <legend className="sr-only">Skills of profile {i + 1}</legend>
        <p className="m-0 text-xs text-muted-foreground">
          The run copies each picked skill from your {runner} setup and tells the model to read it. Skill scripts do not run.
          {full && ` A profile takes at most ${LIMITS.skills} skills.`}
        </p>
        {props.failed && <p className="m-0 text-xs text-destructive">Could not list the skills.</p>}
        {!skills && !props.failed && <p className="m-0 text-xs text-muted-foreground">Loading skills…</p>}
        {skills && skills.size === 0 && <p className="m-0 text-xs text-muted-foreground">{runner} has no skills.</p>}
        <ul className="m-0 grid list-none gap-2 p-0">
          {missing.map((id) =>
            box(
              id,
              <span className="font-mono text-xs">{id}</span>,
              <span className="flex items-start gap-[5px] text-destructive">
                <CircleAlert aria-hidden className="mt-px size-[15px] shrink-0" />
                Not found in {runner}. Runs go on without it.
              </span>,
            ),
          )}
          {[...(skills?.values() ?? [])].map((s) =>
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
      </fieldset>
    </details>
  );
}

const warn = (text: ReactNode) => (
  <span className="flex items-start gap-[5px] text-destructive">
    <CircleAlert aria-hidden className="mt-px size-[15px] shrink-0" />
    {text}
  </span>
);

// MCP servers of the runner setup for one profile. A run allows only the ticked tools of each picked server.
function McpPicker(props: { d: Draft; i: number; servers: ServerList; failed: boolean; onChange: (mcp: McpPick[]) => void }) {
  const { d, i, servers } = props;
  const runner = useMeta().data?.runner.name ?? "";
  const picked = d.mcp;
  const missing = servers ? picked.filter((m) => !servers.has(m.server)) : [];
  const full = picked.length >= LIMITS.mcp;
  const summary = picked.length ? picked.map((m) => `${m.server} (${m.tools.length})`).join(", ") : "none";
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
    <details id={profileId(i, "mcp")} className="col-span-full min-w-0 text-sm" open={missing.length > 0 || undefined}>
      <summary className="cursor-pointer text-ink-2">
        MCP servers<span className="sr-only"> of profile {i + 1}</span>: <span className="text-foreground">{summary}</span>
      </summary>
      <fieldset className="mt-2 grid min-w-0 gap-2 pl-4">
        <legend className="sr-only">MCP servers of profile {i + 1}</legend>
        <p className="m-0 text-xs text-muted-foreground">
          The run starts each picked server from your {runner} setup and allows only the ticked tools. Tool results are untrusted data.
          {full && ` A profile takes at most ${LIMITS.mcp} servers.`}
        </p>
        {props.failed && <p className="m-0 text-xs text-destructive">Could not list the MCP servers.</p>}
        {!servers && !props.failed && <p className="m-0 text-xs text-muted-foreground">Loading MCP servers…</p>}
        {servers && servers.size === 0 && <p className="m-0 text-xs text-muted-foreground">{runner} has no user MCP servers.</p>}
        <ul className="m-0 grid list-none gap-3 p-0">
          {missing.map((m) => row(m.server, undefined))}
          {[...(servers?.values() ?? [])].map((s) => row(s.name, s))}
        </ul>
      </fieldset>
    </details>
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
  const tools = useQuery({
    queryKey: ["mcp-tools", name],
    enabled: !!pick && !!server,
    // Each call can start a process. The list stays until the page reloads.
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: async () => read<McpToolDto[]>(await api.api["mcp-servers"][":name"].tools.$get({ param: { name } })),
  });
  useEffect(() => {
    if (!fresh.current || !pick || !tools.data) return;
    fresh.current = false;
    const readOnly = tools.data.filter((t) => t.readOnlyHint === true).map((t) => t.name);
    onChange(setTools(list, name, readOnly.slice(0, LIMITS.mcpTools)));
  }, [pick, tools.data, list, name, onChange]);
  const known = new Set(tools.data?.map((t) => t.name));
  const gone = tools.data && pick ? pick.tools.filter((t) => !known.has(t)) : [];
  const fullTools = !!pick && pick.tools.length >= LIMITS.mcpTools;
  const tool = (t: string, help: ReactNode) => (
    <li key={t}>
      <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-primary"
          checked={!!pick?.tools.includes(t)}
          disabled={fullTools && !pick?.tools.includes(t)}
          onChange={(e) => pick && onChange(setTools(list, name, toggleSkill(pick.tools, t, e.target.checked)))}
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
              : server.transport === "stdio"
                ? "Local command"
                : `Remote server (${server.transport})`}
          </span>
        </span>
      </label>
      {pick && server && (
        <fieldset className="grid min-w-0 gap-2 pl-6">
          <legend className="sr-only">Tools of {name}</legend>
          {tools.isPending && <p className="m-0 text-xs text-muted-foreground">Loading tools…</p>}
          {tools.error && <p className="m-0 text-xs text-destructive">{tools.error.message}</p>}
          {tools.data && tools.data.length === 0 && <p className="m-0 text-xs text-muted-foreground">The server has no tools.</p>}
          {tools.data && pick.tools.length === 0 && (
            <p className="m-0 text-xs text-muted-foreground">No tool is ticked. Runs skip this server.</p>
          )}
          <ul className="m-0 grid list-none gap-2 p-0">
            {gone.map((t) => tool(t, warn("Not found in the server. Runs go on without it.")))}
            {tools.data?.map((t) =>
              tool(
                t.name,
                <>
                  {t.readOnlyHint !== true && warn("May change data. Review Loop cannot check this.")}
                  {t.description && <span>{t.description}</span>}
                </>,
              ),
            )}
          </ul>
        </fieldset>
      )}
    </li>
  );
}
