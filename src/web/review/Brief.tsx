// Review button and review brief (prototype/v3 reviewBtn, briefHtml): task IDs, your note, the profile, then Start.
// The note is the user's instruction. The server keeps the pull request text out of the prompt (plan v3 WP10).
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, CircleAlert, Download, LoaderCircle } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { type BriefDto, type BriefInput, MAX_NOTE, type MetaDto, type ProfileId, type PrTask } from "../../shared/dto";
import { webLink } from "../pr/Header";
import { Hint } from "../shell/Hint";
import { taskHint } from "../shell/model";
import { putBrief } from "./data";
import type { BriefState } from "./model";

// The note saves this long after the last key. Start, Cancel, Esc, and a profile change save at once.
const SAVE_MS = 600;
const icon = "size-[15px] shrink-0";

// Plan v3 section 7: runner unavailable and wrong login route show a note at the button. The inbox keeps working.
function runnerNote(meta: MetaDto): { short: string; message: string } | null {
  const c = meta.runner.check;
  if (!c || c.ok) return null;
  return c.kind === "auth"
    ? { short: "Review needs the subscription login", message: c.message }
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

function TaskChips({ tasks, onSettings }: { tasks: PrTask[]; onSettings: () => void }) {
  if (!tasks.length) {
    return (
      <>
        <span className="text-ink-2">No task ID found.</span>
        <button type="button" className="cursor-pointer rounded text-sm font-medium text-pen hover:underline" onClick={onSettings}>
          Set up task IDs
        </button>
      </>
    );
  }
  const chip = "inline-flex items-baseline gap-1.5 rounded-[5px] border px-2 py-0.5 text-xs whitespace-nowrap text-muted-foreground";
  return (
    <>
      {tasks.map((t) => {
        const url = webLink(t.url);
        const body = (
          <>
            <code translate="no" className={cn("font-mono text-xs", url ? "text-pen" : "text-ink-2")}>
              {t.key}
            </code>
            <span>· from {SOURCE[t.source]}</span>
          </>
        );
        return url ? (
          <a
            key={t.key}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open ${t.key} in a new tab`}
            className={cn(chip, "hover:border-rule-strong [&:hover>code]:underline")}
          >
            {body}
            <span className="sr-only">, opens a new tab</span>
          </a>
        ) : (
          <span key={t.key} className={chip} title={taskHint(t)}>
            {body}
          </span>
        );
      })}
      {/* Release 2 (plan v3 section 8): a tracker connector imports the task text. */}
      <Hint label="Arrives with an issue tracker connector.">
        <button
          type="button"
          aria-disabled="true"
          className="inline-flex h-6 cursor-default items-center gap-1.5 rounded-[5px] px-1.5 text-xs text-muted-foreground"
        >
          <Download aria-hidden className={icon} />
          Fetch the task text
        </button>
      </Hint>
    </>
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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
        <span className="mr-1.5 font-semibold">Task</span>
        <TaskChips tasks={props.tasks} onSettings={props.onSettings} />
      </div>
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
