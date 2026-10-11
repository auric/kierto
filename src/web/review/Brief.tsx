// Review button and review brief (prototype/v3 reviewBtn, briefHtml): task IDs, your note, the profile, then Start.
// The note is the user's instruction. The server keeps the pull request text out of the prompt (plan v3 WP10).
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, CircleAlert, Download, LoaderCircle, RefreshCw, Settings2, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { type BriefDto, type BriefInput, MAX_NOTE, type MetaDto, type ProfileId, type PrTask, type TaskContextDto } from "../../shared/dto";
import { api } from "../api";
import { webLink } from "../pr/Header";
import { ApiError, read } from "../shell/data";
import { Hint } from "../shell/Hint";
import { taskHint } from "../shell/model";
import { putBrief } from "./data";
import type { BriefState } from "./model";
import { commentsText, fetchedText, mergeTask, offerSetup, sourceTime, taskChips, trackerOf } from "./tasks";

// The note saves this long after the last key. Start, Cancel, Esc, and a profile change save at once.
const SAVE_MS = 600;
const icon = "size-[15px] shrink-0";

// Plan v3 section 7: runner unavailable and wrong login route show a note at the button. The inbox keeps working.
function runnerNote(meta: MetaDto): { short: string; message: string } | null {
  const c = meta.runner.check;
  if (!c || c.ok) return null;
  return c.kind === "auth"
    ? { short: "Review needs the subscription login", message: `${c.message} Run: ${meta.runner.login}` }
    : { short: `${meta.runner.name} is not available`, message: c.message };
}

// extra: buttons before the Review button, such as Draft replies (WP18).
export function ReviewButton(props: { state: BriefState; open: boolean; meta: MetaDto; extra?: ReactNode; onClick: () => void }) {
  const note = runnerNote(props.meta);
  return (
    <div className="mt-px flex flex-wrap items-center justify-end gap-2">
      {note && (
        <Hint label={note.message}>
          <span id="review-note" className="inline-flex items-center gap-1.5 text-xs text-destructive">
            <CircleAlert aria-hidden className={icon} />
            {note.short}
            <span className="sr-only">. {note.message}</span>
          </span>
        </Hint>
      )}
      {props.extra}
      <Hint label={props.state.hint}>
        <Button
          id="review-btn"
          size="sm"
          className="pr-2 pl-3.5"
          aria-expanded={props.open}
          aria-controls={props.open ? "brief" : undefined}
          aria-describedby={note ? "review-note" : undefined}
          aria-keyshortcuts="Shift+R"
          onClick={props.onClick}
        >
          Review · {props.state.name}
          <ChevronDown aria-hidden data-icon="inline-end" className="rl-chev-d" />
        </Button>
      </Hint>
    </div>
  );
}

const SOURCE: Record<PrTask["source"], string> = { branch: "branch", title: "title", description: "description" };

const taskKey = (pr: number) => ["pr", pr, "task-context"] as const;
const keyParam = (pr: number, key: string) => ({ param: { id: String(pr), key } });

// GET reads the local database. live.ts refetches it when SSE `changed` names the PR.
// The server shares one param validator with the :key routes, so the client type asks for a key. This path has no key.
export const useTaskContext = (pr: number) =>
  useQuery({
    queryKey: taskKey(pr),
    queryFn: async () => read<TaskContextDto[]>(await api.api.prs[":id"]["task-context"].$get(keyParam(pr, ""))),
  });

// The only request from the brief that reaches the tracker, through the server.
async function fetchTask(qc: QueryClient, pr: number, key: string) {
  const dto = await read<TaskContextDto>(await api.api.prs[":id"]["task-context"][":key"].$post(keyParam(pr, key)));
  qc.setQueryData<TaskContextDto[]>(taskKey(pr), (old) => mergeTask(old, dto));
}

async function removeTask(qc: QueryClient, pr: number, key: string) {
  const res = await api.api.prs[":id"]["task-context"][":key"].$delete(keyParam(pr, key));
  if (!res.ok) await read(res);
  qc.setQueryData<TaskContextDto[]>(taskKey(pr), (old) => old?.filter((t) => t.key !== key));
}

// setup: the server has no tracker source (409), so the error offers the settings.
type TaskError = { key: string; message: string; setup: boolean };

const chipBtn =
  "inline-grid w-6 cursor-pointer place-items-center border-l text-ink-2 last:rounded-r-[4px] hover:bg-hover hover:text-foreground aria-busy:cursor-progress";

// The Task row of the brief: task ID chips with Fetch, Fetch again and Remove, then the imported text folds (plan r2, task context UI).
function TaskChips({ pr, tasks, meta, onSettings }: { pr: number; tasks: PrTask[]; meta: MetaDto; onSettings: () => void }) {
  const qc = useQueryClient();
  const tracker = trackerOf(meta);
  const data = useTaskContext(pr).data;
  const rows = (tracker && data) || [];
  const on = tracker?.configured === true;
  const source = tracker?.name ?? "";
  const chips = taskChips(tasks, rows, on);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<TaskError[]>([]);
  const [said, setSaid] = useState("");
  const now = Date.now();

  const setUp = () => {
    onSettings();
    // The settings render in the same click. Focus then lands on the tracker URL field.
    requestAnimationFrame(() => document.getElementById("tracker-url")?.focus());
  };
  const run = async (key: string, act: "fetch" | "remove") => {
    if (busy.has(key)) return;
    setBusy((b) => new Set(b).add(key));
    setErrors((es) => es.filter((e) => e.key !== key));
    try {
      if (act === "fetch") await fetchTask(qc, pr, key);
      else await removeTask(qc, pr, key);
      setSaid(act === "fetch" ? `Fetched ${key} from ${source}.` : `Removed the ${key} text.`);
      // Remove takes its own button away, and the chip too when the PR no longer names the task.
      if (act === "remove")
        requestAnimationFrame(() => (document.getElementById(`tk-fetch-${key}`) ?? document.getElementById("brief-note"))?.focus());
    } catch (e) {
      const message = (e as Error).message;
      const setup = e instanceof ApiError && e.status === 409;
      setErrors((es) => [...es.filter((x) => x.key !== key), { key, message, setup }]);
      setSaid(`${key}: ${message}`);
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(key);
        return n;
      });
    }
  };

  if (!chips.length) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
        <span className="mr-1.5 font-semibold">Task</span>
        <span className="text-ink-2">No task ID found.</span>
        <button type="button" className="cursor-pointer rounded text-sm font-medium text-pen hover:underline" onClick={onSettings}>
          Set up task IDs
        </button>
      </div>
    );
  }
  const chip = "inline-flex items-baseline gap-1.5 px-2 py-0.5 text-xs whitespace-nowrap text-muted-foreground";
  const fetched = chips.flatMap((c) => (c.fetched ? [c.fetched] : []));
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
        <span className="mr-1.5 font-semibold">Task</span>
        {chips.map((t) => {
          const url = webLink(t.url);
          const body = (
            <>
              <code translate="no" className={cn("font-mono text-xs", url ? "text-pen" : "text-ink-2")}>
                {t.key}
              </code>
              <span>{t.source ? `· from ${SOURCE[t.source]}` : "· no longer in this pull request"}</span>
            </>
          );
          const wait = busy.has(t.key);
          return (
            <span key={t.key} className="inline-flex items-stretch rounded-[5px] border has-[a:hover]:border-rule-strong">
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open ${t.key} in a new tab`}
                  className={cn(chip, "rounded-[4px] [&:hover>code]:underline")}
                >
                  {body}
                  <span className="sr-only">, opens a new tab</span>
                </a>
              ) : (
                <span
                  className={chip}
                  title={t.source ? taskHint({ key: t.key, source: t.source }) : "The pull request no longer names this task."}
                >
                  {body}
                </span>
              )}
              {t.fetchable && (
                <Hint label={t.fetched ? `Fetch ${t.key} again` : `Fetch ${t.key} from ${source}`}>
                  <button
                    id={`tk-fetch-${t.key}`}
                    type="button"
                    className={chipBtn}
                    aria-label={t.fetched ? `Fetch ${t.key} again` : `Fetch ${t.key} from ${source}`}
                    aria-busy={wait || undefined}
                    onClick={() => void run(t.key, "fetch")}
                  >
                    {wait ? (
                      <LoaderCircle aria-hidden className={cn(icon, "animate-spin")} />
                    ) : t.fetched ? (
                      <RefreshCw aria-hidden className={icon} />
                    ) : (
                      <Download aria-hidden className={icon} />
                    )}
                  </button>
                </Hint>
              )}
              {t.fetched && (
                <Hint label={`Remove the ${t.key} text`}>
                  <button
                    type="button"
                    className={chipBtn}
                    aria-label={`Remove the ${t.key} text`}
                    aria-busy={wait || undefined}
                    onClick={() => void run(t.key, "remove")}
                  >
                    <X aria-hidden className={icon} />
                  </button>
                </Hint>
              )}
            </span>
          );
        })}
        {tracker && offerSetup(tasks, on) && (
          <button
            type="button"
            className="inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-[5px] px-1.5 text-xs text-ink-2 hover:bg-hover hover:text-foreground"
            onClick={setUp}
          >
            <Settings2 aria-hidden className={icon} />
            Set up {source}
          </button>
        )}
      </div>
      {errors.map((e) => (
        <p key={e.key} className="m-0 flex items-start gap-1.5 text-xs text-destructive">
          <CircleAlert aria-hidden className={icon} />
          <span>
            <code translate="no" className="font-mono">
              {e.key}
            </code>
            : {e.message}
            {e.setup && (
              <>
                {" "}
                <button type="button" className="cursor-pointer rounded font-medium text-pen hover:underline" onClick={setUp}>
                  Set up {source}
                </button>
              </>
            )}
          </span>
        </p>
      ))}
      {/* One live region for fetch results and errors. It stays in the page, so each change is read. */}
      <p role="status" className="sr-only">
        {said}
      </p>
      {fetched.map((t) => (
        <TaskFold key={t.key} t={t} source={source} now={now} />
      ))}
    </div>
  );
}

// The imported text, read-only. Plain text: wiki markup and HTML show as typed. Closed until the user opens it.
function TaskFold({ t, source, now }: { t: TaskContextDto; source: string; now: number }) {
  const meta = [t.status, commentsText(t), fetchedText(t, now)].filter(Boolean).join(", ");
  return (
    <details data-task={t.key} className="group min-w-0 text-sm">
      <summary className="-ml-1.5 flex min-w-0 items-center gap-2 rounded px-1.5 py-1 hover:bg-hover">
        <ChevronRight aria-hidden className={cn("rl-chev text-muted-foreground", icon)} />
        <code translate="no" className="flex-none font-mono text-xs text-ink-2">
          {t.key}
        </code>
        <span className="min-w-0 truncate font-medium group-open:whitespace-normal">{t.summary}</span>
        <span className="rl-wide-pane ml-auto flex-none text-xs text-muted-foreground">{meta}</span>
      </summary>
      <div className="mt-1 mb-1.5 ml-[7px] grid max-w-[72ch] gap-3 border-l border-rule-strong pl-[22px] [overflow-wrap:anywhere]">
        <p className="m-0 text-xs text-muted-foreground">
          {/* The summary line hides the same words in a narrow pane (.rl-wide-pane). */}
          From {source}
          <span className="hidden @max-[560px]/detail:inline">, {meta}</span>.
          {t.truncated && " Review Loop cut this text at its size limits."}
        </p>
        <p className="m-0 whitespace-pre-wrap">{t.description?.trim() || "No description."}</p>
        {t.comments.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the comments of one fetch keep their order.
          <div key={i} className="grid gap-0.5">
            <p className="m-0 text-xs text-muted-foreground">
              <span className="font-medium text-ink-2">{c.author}</span>, {sourceTime(c.created)}
            </p>
            <p className="m-0 whitespace-pre-wrap">{c.body}</p>
          </div>
        ))}
      </div>
    </details>
  );
}

export function BriefComposer(props: {
  pr: number;
  brief: BriefDto;
  tasks: PrTask[];
  meta: MetaDto;
  // The running review on another PR, as words. The server still decides (A14).
  busy: string | null;
  starting: boolean;
  onStart: () => void;
  onClose: () => void;
  onSettings: () => void;
}) {
  const { pr, meta } = props;
  const qc = useQueryClient();
  const [note, setNote] = useState(props.brief.note);
  const [profile, setProfile] = useState<ProfileId>(props.brief.profile);
  const latest = useRef<BriefInput>({ note: props.brief.note, profile: props.brief.profile });
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return true;
    dirty.current = false;
    try {
      await putBrief(qc, pr, latest.current);
      return true;
    } catch (e) {
      toast.add({ title: "The brief was not saved", description: (e as Error).message });
      return false;
    }
  }, [qc, pr]);
  // Closing the brief or leaving the PR saves the last change.
  useEffect(
    () => () => {
      void flush();
    },
    [flush],
  );

  // The brief opens with focus in the note, the main input, and the caret at its end.
  useLayoutEffect(() => {
    const ta = area.current;
    if (!ta) return;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.closest("section")?.scrollIntoView({ block: "nearest" });
  }, []);

  const changeNote = (v: string) => {
    setNote(v);
    latest.current = { ...latest.current, note: v };
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_MS);
  };
  const changeProfile = (v: ProfileId) => {
    setProfile(v);
    latest.current = { ...latest.current, profile: v };
    dirty.current = true;
    // The Review button names the profile at once.
    qc.setQueryData<BriefDto>(["brief", pr], (old) => old && { ...old, profile: v });
    void flush();
  };
  const start = async () => {
    if (props.starting) return;
    if (await flush()) props.onStart();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void start();
    }
  };

  // Ctrl+Enter starts the review from any control of the brief.
  return (
    <section
      id="brief"
      aria-labelledby="brief-title"
      className="mt-1.5 mb-0.5 grid gap-3.5 rounded-lg border border-rule-strong px-4 pt-3.5 pb-4"
      onKeyDown={onKeyDown}
    >
      <h2 id="brief-title" className="m-0 text-[15px] font-bold">
        Review brief
      </h2>
      <TaskChips pr={pr} tasks={props.tasks} meta={meta} onSettings={props.onSettings} />
      <div className="rl-bf-main grid gap-x-7 gap-y-3.5">
        <Field className="content-start gap-1.5">
          <FieldLabel htmlFor="brief-note" className="text-sm font-semibold">
            Your note
          </FieldLabel>
          <Textarea
            ref={area}
            id="brief-note"
            rows={7}
            maxLength={MAX_NOTE}
            spellCheck
            value={note}
            aria-describedby="brief-note-help"
            placeholder="Paste the task text and its acceptance criteria. Then say what to check first."
            className="field-sizing-fixed resize-y bg-pane leading-normal"
            onChange={(e) => changeNote(e.target.value)}
          />
          <FieldDescription id="brief-note-help" className="text-xs">
            Saved for this pull request. {meta.runner.short} reads your note as your instruction. It reads the pull request text as data
            only.
          </FieldDescription>
        </Field>
        <FieldSet className="min-w-0 gap-1">
          <FieldLegend variant="label" className="mb-1 text-sm font-semibold">
            Profile
          </FieldLegend>
          {meta.profiles.map((p) => (
            <label
              key={p.id}
              className="-mx-1.5 grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-2 rounded-[5px] px-1.5 py-[5px] hover:bg-hover"
            >
              <input
                type="radio"
                name={`brief-profile-${pr}`}
                value={p.id}
                checked={profile === p.id}
                className="m-0 mt-[3px] accent-foreground"
                onChange={() => changeProfile(p.id)}
              />
              <span className="text-sm font-semibold">{p.name}</span>
              <span className="col-start-2 text-xs text-muted-foreground">{p.note}</span>
            </label>
          ))}
        </FieldSet>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <Button size="sm" disabled={props.starting} aria-keyshortcuts="Control+Enter" title="Key: Ctrl+Enter" onClick={() => void start()}>
          {props.starting && <LoaderCircle aria-hidden data-icon="inline-start" className="animate-spin" />}
          Start review
        </Button>
        <Button
          size="sm"
          variant="outline"
          title="Key: Esc"
          onClick={() => {
            void flush();
            props.onClose();
          }}
        >
          Cancel
        </Button>
        <span className="ml-1.5 text-xs text-muted-foreground">{props.busy ?? "Ctrl+Enter starts the review. Esc closes the brief."}</span>
      </div>
    </section>
  );
}
