// Task IDs settings (prototype/v3 renderSettings): ordered rules, the task link, and a live preview.
// Each change saves by itself (autosave.tsx). The server runs no remote check here; it checks each pattern in its worker.
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CircleAlert, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PrRow, SettingsDto, SettingsInput, TaskPreviewDto, TaskPreviewError, TaskRule, TaskSource } from "../../shared/dto";
import { api } from "../api";
import { ApiError, read, usePr } from "../shell/data";
import { Hint } from "../shell/Hint";
import { prKey } from "../shell/model";
import { SaveStatus, TYPING_MS, useSaver } from "./autosave";
import {
  ADD_ID,
  type Change,
  change,
  type Draft,
  focusAfter,
  LIMITS,
  linkProblem,
  ruleId,
  ruleProblem,
  SOURCE_NAME,
  sameRules,
  syntaxText,
  TIMEOUT_TEXT,
  toDrafts,
  toRules,
} from "./rules";

const field = "grid min-w-0 gap-[3px] text-xs text-muted-foreground";
const control =
  "h-[30px] w-full min-w-0 rounded-md border border-input bg-pane px-2 text-sm text-foreground aria-invalid:border-destructive focus-visible:outline-offset-0";
const iconBtn =
  "inline-grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-ink-2 hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent";

function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

type Preview = { ok: true; dto: TaskPreviewDto } | { ok: false; rules: TaskPreviewError["rules"] };

// rules null: a rule has a client problem, so no request goes out. A 400 with rule errors is a result, not a failure.
// key: the rules of the answer, as JSON. null while the answer is from earlier rules.
function usePreview(rules: TaskRule[] | null, pr: number | null) {
  const key = useDebounced(rules && JSON.stringify(rules), 300);
  const q = useQuery({
    queryKey: ["task-preview", key, pr],
    enabled: key !== null && pr !== null,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Preview> => {
      const res = await api.api.settings["task-rules"].preview.$post({
        json: { rules: JSON.parse(key as string) as TaskRule[], prs: [pr as number] },
      });
      if (res.status !== 400) return { ok: true, dto: await read<TaskPreviewDto>(res) };
      const body = (await res.json()) as Partial<TaskPreviewError>;
      if (Array.isArray(body.rules)) return { ok: false, rules: body.rules };
      throw new ApiError(400, body.error ?? "The server refused the rules.");
    },
  });
  return { ...q, key: q.isPlaceholderData ? null : key };
}

export function TaskRules({ settings, prs, selected }: { settings: SettingsDto; prs: PrRow[]; selected: number | null }) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState(() => toDrafts(settings.taskRules));
  const [link, setLink] = useState(settings.taskLink ?? "");
  // The newest values. Event handlers set them before the render, so a save in the same handler sends the change.
  const latest = useRef({ drafts, link });
  // The rules, as JSON, that the preview found a syntax error in. They stay unsaved; the link still saves.
  const badRules = useRef<string | null>(null);
  const [pick, setPick] = useState<number | null>(selected);
  const [focus, setFocus] = useState<string | null>(null);
  const pr = prs.find((p) => p.id === pick) ?? prs[0] ?? null;
  const rules = toRules(drafts);
  const problems = drafts.map(ruleProblem);
  const valid = problems.every((p) => p === null);
  const preview = usePreview(valid ? rules : null, pr?.id ?? null);
  const result = valid ? preview.data : undefined;
  const serverRules = result && (result.ok ? result.dto.rules : result.rules);
  const syntax = !!result && !result.ok;
  const linkError = linkProblem(link.trim());
  if (result && preview.key) badRules.current = result.ok ? null : preview.key;

  // The cache holds the newest saved settings, also after a save in another section.
  const current = () => qc.getQueryData<SettingsDto>(["settings"]) ?? settings;
  const { state, saver } = useSaver(
    (): SettingsInput | null => {
      const s = current();
      const r = toRules(latest.current.drafts);
      const l = latest.current.link.trim();
      const rulesOk = latest.current.drafts.every((d) => ruleProblem(d) === null) && badRules.current !== JSON.stringify(r);
      const out: SettingsInput = { baseUrl: s.baseUrl ?? "", caFile: s.caFile ?? "" };
      if (rulesOk && !sameRules(r, s.taskRules)) out.taskRules = r;
      if (!linkProblem(l) && l !== (s.taskLink ?? "")) out.taskLink = l;
      return out.taskRules || out.taskLink !== undefined ? out : null;
    },
    async (input: SettingsInput) => {
      qc.setQueryData(["settings"], await read<SettingsDto>(await api.api.settings.$put({ json: input })));
      void qc.invalidateQueries({ queryKey: ["prs"] });
    },
  );

  // Focus moves after the list renders with the change.
  useEffect(() => {
    if (focus) document.getElementById(focus)?.focus();
    setFocus(null);
  }, [focus]);

  // delay: 0 for a select or a list change; TYPING_MS for a key in a text field.
  const apply = (c: Change, delay = 0) => {
    const next = change(latest.current.drafts, c);
    latest.current = { ...latest.current, drafts: next };
    setDrafts(next);
    if (c.act !== "edit") setFocus(focusAfter(c, next.length));
    saver.request(delay);
  };

  return (
    <section aria-labelledby="h-taskids" className="mt-6 grid max-w-[86ch] gap-3 border-t pt-4">
      <div className="grid gap-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="h-taskids" tabIndex={-1} className="m-0 scroll-mt-4 text-[15px] font-bold outline-none">
            Task IDs
          </h2>
          <SaveStatus
            id="taskids-status"
            state={state}
            problem={
              !valid || syntax
                ? "A marked rule is not saved. Fix it to save it."
                : linkError
                  ? "The task link is not saved. Fix it to save it."
                  : null
            }
            saved="Saved. The inbox finds the task IDs again in the background."
            onRetry={() => saver.request(0)}
          />
        </div>
        <p className="m-0 text-xs text-muted-foreground">
          Changes save as you make them. Text saves when you leave the field or stop typing.
        </p>
      </div>
      <p className="m-0 max-w-[72ch] text-sm text-ink-2">
        Review Loop looks for task IDs in each pull request. The rules run from top to bottom. When two rules find the same ID, the first
        rule names its source. Keys limit the matches to your projects, so UTF-8 or SHA-256 do not count.
      </p>
      <ol aria-label="Task ID rules" className="m-0 list-none border-t p-0">
        {drafts.map((r, i) => (
          <RuleRow
            key={r.id}
            r={r}
            i={i}
            last={i === drafts.length - 1}
            problem={problems[i] ?? null}
            server={serverRules?.[i]}
            onChange={apply}
            onBlur={() => void saver.flush()}
          />
        ))}
      </ol>
      <div>
        <Button id={ADD_ID} variant="outline" size="sm" disabled={drafts.length >= LIMITS.rules} onClick={() => apply({ act: "add" })}>
          <Plus data-icon="inline-start" />
          Add rule
        </Button>
      </div>
      <Field className="max-w-[560px]">
        <FieldLabel htmlFor="task-link">Task link (optional)</FieldLabel>
        <Input
          id="task-link"
          type="url"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          value={link}
          placeholder="https://tracker.example.com/browse/{key}"
          aria-invalid={!!linkError}
          aria-describedby={linkError ? "task-link-error" : undefined}
          onChange={(e) => {
            setLink(e.target.value);
            latest.current = { ...latest.current, link: e.target.value };
            saver.request(TYPING_MS);
          }}
          onBlur={() => void saver.flush()}
        />
        <FieldDescription>Each task ID links to this address. {"{key}"} stands for the ID. Leave it empty for no link.</FieldDescription>
        {linkError && <FieldError id="task-link-error">{linkError}</FieldError>}
      </Field>
      <PreviewBox
        prs={prs}
        pr={pr}
        onPick={setPick}
        state={!valid || syntax ? "errors" : preview.error ? "failed" : result?.ok ? result.dto : null}
        error={preview.error}
      />
    </section>
  );
}

function RuleRow({
  r,
  i,
  last,
  problem,
  server,
  onChange,
  onBlur,
}: {
  r: Draft;
  i: number;
  last: boolean;
  problem: string | null;
  server: { error: string | null; timedOut: boolean } | undefined;
  onChange: (c: Change, delay?: number) => void;
  onBlur: () => void;
}) {
  const n = i + 1;
  const of = <span className="sr-only"> of rule {n}</span>;
  const message = problem ?? (server?.error ? syntaxText(server.error) : r.timedOut || server?.timedOut ? TIMEOUT_TEXT : null);
  type Patch = Partial<Pick<Draft, "source" | "pattern" | "keys">>;
  const edit = (patch: Patch) => onChange({ act: "edit", i, patch });
  const type = (patch: Patch) => onChange({ act: "edit", i, patch }, TYPING_MS);
  return (
    <li className="grid grid-cols-[2ch_8.5rem_minmax(0,1fr)_8rem_auto] items-end gap-x-3 gap-y-1 border-b py-2.5 @max-[559px]:grid-cols-[2ch_minmax(0,1fr)_auto]">
      <span aria-hidden className="text-right text-sm leading-[30px] text-muted-foreground @max-[559px]:row-start-1">
        {n}
      </span>
      <label className={cn(field, "@max-[559px]:row-start-1")}>
        <span>Source{of}</span>
        <select
          id={ruleId(i, "source")}
          className={control}
          value={r.source}
          onChange={(e) => edit({ source: e.target.value as TaskSource })}
        >
          {(Object.keys(SOURCE_NAME) as TaskSource[]).map((s) => (
            <option key={s} value={s}>
              {SOURCE_NAME[s]}
            </option>
          ))}
        </select>
      </label>
      <label className={cn(field, "@max-[559px]:col-[2/-1]")}>
        <span>Pattern{of}</span>
        <input
          id={ruleId(i, "pattern")}
          className={cn(control, "font-mono text-[12.5px]")}
          value={r.pattern}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!!(problem || server?.error)}
          aria-describedby={message ? ruleId(i, "error") : undefined}
          onChange={(e) => type({ pattern: e.target.value })}
          onBlur={onBlur}
        />
      </label>
      <label className={cn(field, "@max-[559px]:col-[2/-1]")}>
        <span>Keys{of}</span>
        <input
          id={ruleId(i, "keys")}
          className={cn(control, "font-mono text-[12.5px]")}
          value={r.keys}
          placeholder="Any key"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => type({ keys: e.target.value })}
          onBlur={onBlur}
        />
      </label>
      <span className="flex gap-0.5 @max-[559px]:col-start-3 @max-[559px]:row-start-1">
        <Hint label="Move up">
          <button
            type="button"
            id={ruleId(i, "up")}
            className={iconBtn}
            aria-label={`Move rule ${n} up`}
            disabled={i === 0}
            onClick={() => onChange({ act: "move", i, d: -1 })}
          >
            <ArrowUp aria-hidden className="size-[15px]" />
          </button>
        </Hint>
        <Hint label="Move down">
          <button
            type="button"
            id={ruleId(i, "down")}
            className={iconBtn}
            aria-label={`Move rule ${n} down`}
            disabled={last}
            onClick={() => onChange({ act: "move", i, d: 1 })}
          >
            <ArrowDown aria-hidden className="size-[15px]" />
          </button>
        </Hint>
        <Hint label="Remove">
          <button
            type="button"
            id={ruleId(i, "remove")}
            className={iconBtn}
            aria-label={`Remove rule ${n}`}
            onClick={() => onChange({ act: "remove", i })}
          >
            <X aria-hidden className="size-[15px]" />
          </button>
        </Hint>
      </span>
      {message && (
        <p
          id={ruleId(i, "error")}
          className="col-[3/-1] m-0 mt-0.5 flex items-start gap-[5px] text-xs text-destructive @max-[559px]:col-[2/-1]"
        >
          <CircleAlert aria-hidden className="mt-px size-[15px] shrink-0" />
          <span>{message}</span>
        </p>
      )}
    </li>
  );
}

function PreviewBox({
  prs,
  pr,
  onPick,
  state,
  error,
}: {
  prs: PrRow[];
  pr: PrRow | null;
  onPick: (id: number) => void;
  // errors: a rule has an error, so no preview runs. null: the first answer is pending.
  state: TaskPreviewDto | "errors" | "failed" | null;
  error: Error | null;
}) {
  const detail = usePr(pr?.id ?? 0, pr !== null);
  const found = typeof state === "object" && state ? (state.prs[0]?.tasks ?? []) : null;
  const description = detail.data?.description?.replace(/\s+/g, " ").trim();
  return (
    <div className="mt-2 grid max-w-[72ch] gap-2 border-t pt-3.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <h3 className="m-0 text-sm font-bold">Preview</h3>
        {prs.length > 0 && pr && (
          <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            Pull request
            <select
              className={cn(control, "h-7 w-auto max-w-[40ch] truncate font-mono text-xs")}
              value={pr.id}
              onChange={(e) => onPick(Number(e.target.value))}
            >
              {prs.map((p) => (
                <option key={p.id} value={p.id}>
                  {prKey(p)}
                  {p.title ? ` ${p.title}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!pr ? (
        <p className="m-0 text-sm text-ink-2">The preview needs a pull request. Pull requests appear after the first check.</p>
      ) : (
        <>
          <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3.5 gap-y-0.5 text-xs">
            <dt className="text-muted-foreground">Branch</dt>
            <dd translate="no" className="m-0 min-w-0 truncate font-mono text-ink-2">
              {pr.sourceBranch ?? "–"}
            </dd>
            <dt className="text-muted-foreground">Title</dt>
            <dd className="m-0 min-w-0 truncate text-ink-2">{pr.title ?? "–"}</dd>
            <dt className="text-muted-foreground">Description</dt>
            <dd className="m-0 min-w-0 truncate text-ink-2">{description || "–"}</dd>
          </dl>
          <div aria-live="polite">
            {state === "errors" ? (
              <p className="m-0 text-sm text-ink-2">Fix the rule errors above to see the preview.</p>
            ) : state === "failed" ? (
              <p className="m-0 text-sm text-destructive">The preview failed: {error?.message ?? "no answer"}.</p>
            ) : found === null ? (
              <p className="m-0 text-sm text-ink-2">Running the rules…</p>
            ) : found.length ? (
              <ul aria-label="Task IDs found" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {found.map((t) => (
                  <li
                    key={t.key}
                    className="inline-flex items-baseline gap-[5px] rounded-[5px] border px-2 py-0.5 text-xs whitespace-nowrap text-muted-foreground"
                  >
                    <code translate="no" className="font-mono text-[12px] text-pen">
                      {t.key}
                    </code>
                    <span>· from {t.source}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-sm text-ink-2">No match.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
