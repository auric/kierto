// Review button and review brief (prototype/v3 reviewBtn, briefHtml): task IDs, your note, the profile, its run setup, then Start.
// Each review start opens the brief first: the Review button, its profile items, r, and the re-review. Only Start runs it.
// The note is the user's instruction. The server keeps the pull request text out of the prompt (plan v3 WP10).
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  CircleAlert,
  Copy,
  Cpu,
  Download,
  File,
  FileImage,
  FileText,
  FolderOpen,
  LoaderCircle,
  Paperclip,
  Save,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import {
  type KeyboardEvent,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import {
  type AttachmentDto,
  alwaysSkillError,
  type BriefDto,
  type BriefInput,
  MAX_NOTE,
  type MetaDto,
  type ProfileId,
  type PrTask,
  type TaskContextDto,
} from "../../shared/dto";
import { api } from "../api";
import { dialogKeys } from "../fix/CloneDialog";
import { useSkills } from "../meta";
import { read } from "../shell/data";
import { Hint } from "../shell/Hint";
import { putBrief } from "./data";
import { type BriefState, plural, profileOf, profileSetupText } from "./model";
import { RunSplit } from "./RunSplit";
import { keyParam, TaskChips, taskKey, useTaskChips } from "./TaskChips";
import {
  type AttachmentRow,
  attachmentImages,
  attachmentRows,
  attachmentsText,
  canDownload,
  commentsText,
  dropFile,
  fetchedText,
  fileKind,
  fileState,
  imageIds,
  includable,
  putFile,
  saveRoute,
  sizeText,
  sourceTime,
  typeText,
} from "./tasks";

// The Markdown renderer loads on first use, as in Thread.tsx. Plain text shows until then.
const Markdown = lazy(() => import("../pr/Markdown").then((m) => ({ default: m.Markdown })));

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

// The parts are items of the action bar (Header.tsx). extra: buttons before the Review button, such as Draft replies (WP18).
// onOpen: opens the brief, as the r key does. profile: the menu item, a profile for this review only.
export function ReviewButton(props: {
  state: BriefState;
  meta: MetaDto;
  extra?: ReactNode;
  onOpen: (profile?: string) => void;
  // Opens the settings at the brief profile.
  onEditProfile: () => void;
}) {
  const note = runnerNote(props.meta);
  // A profile item moves the focus into the note of the brief, not back to the menu button. Edit profile moves it into the settings.
  const toBrief = useRef(false);
  const toSettings = useRef(false);
  return (
    <>
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
      <RunSplit
        id="review-btn"
        variant="default"
        hint={props.state.hint}
        keys="r"
        describedBy={note ? "review-note" : undefined}
        menu="Review with another profile"
        heading="Profile for this review"
        profiles={props.meta.profiles}
        current={props.state.profile}
        onRun={(profile, menu) => {
          toBrief.current = !!menu;
          props.onOpen(profile);
        }}
        finalFocus={() => {
          const brief = toBrief.current;
          const settings = toSettings.current;
          toBrief.current = false;
          toSettings.current = false;
          return settings ? false : brief ? document.getElementById("brief-note") : true;
        }}
        more={
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                id="review-btn-edit-profile"
                onClick={() => {
                  toSettings.current = true;
                  props.onEditProfile();
                }}
              >
                Edit profile…
                <span className="sr-only"> {props.state.name}</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        }
      >
        Review<span className="@max-[560px]/detail:sr-only"> · {props.state.name}</span>
      </RunSplit>
    </>
  );
}

// Text converted from the rendered HTML shows as Markdown. Rows from before Release 3 hold plain text: wiki markup shows as typed.
// A downloaded attachment image shows in the text, never wider than the text.
function TaskText({ t, text, images }: { t: TaskContextDto; text: string; images: (src: string) => string | null }) {
  const plain = <p className="m-0 whitespace-pre-wrap">{text}</p>;
  return t.format === "markdown" ? (
    <div className="[&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md [&_img]:border">
      <Suspense fallback={plain}>
        <Markdown text={text} images={images} />
      </Suspense>
    </div>
  ) : (
    plain
  );
}

// The imported text, read-only. Closed until the user opens it.
function TaskFold(props: { pr: number; t: TaskContextDto; source: string; now: number; runner: string; announce: (text: string) => void }) {
  const { pr, t, source, now } = props;
  const files = attachmentRows(t).length;
  const meta = [t.status, commentsText(t), files ? attachmentsText(files) : "", fetchedText(t, now)].filter(Boolean).join(", ");
  // Markdown remounts its images on a new resolver. So the resolver changes only with the downloaded image IDs.
  const ids = imageIds(t.files).join(",");
  const images = useMemo(() => attachmentImages(pr, t.key, ids ? ids.split(",") : []), [pr, t.key, ids]);
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
        <TaskText t={t} text={t.description?.trim() || "No description."} images={images} />
        {/* The tracker shows the files after the description, before the comments. */}
        <Attachments pr={pr} t={t} runner={props.runner} announce={props.announce} />
        {t.comments.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the comments of one fetch keep their order.
          <div key={i} className="grid gap-0.5">
            <p className="m-0 text-xs text-muted-foreground">
              <span className="font-medium text-ink-2">{c.author}</span>, {sourceTime(c.created)}
            </p>
            <TaskText t={t} text={c.body} images={images} />
          </div>
        ))}
      </div>
    </details>
  );
}

// ---------- Attachments (plan r3 UI-ATT) ----------

const fileParam = (pr: number, key: string, att: string) => ({ param: { id: String(pr), key, att } });
const fileApi = () => api.api.prs[":id"]["task-context"][":key"].files[":att"];

// One file per request. The server gets it from the tracker; the browser never calls the tracker.
async function downloadFile(qc: QueryClient, pr: number, key: string, att: string) {
  const f = await read<AttachmentDto>(await fileApi().$post(fileParam(pr, key, att)));
  qc.setQueryData<TaskContextDto[]>(taskKey(pr), (old) => putFile(old, key, f));
}

async function includeFile(qc: QueryClient, pr: number, key: string, att: string, include: boolean) {
  const f = await read<AttachmentDto>(await fileApi().$put({ ...fileParam(pr, key, att), json: { include } }));
  qc.setQueryData<TaskContextDto[]>(taskKey(pr), (old) => putFile(old, key, f));
}

async function deleteFile(qc: QueryClient, pr: number, key: string, att: string) {
  const res = await fileApi().$delete(fileParam(pr, key, att));
  if (!res.ok) await read(res);
  qc.setQueryData<TaskContextDto[]>(taskKey(pr), (old) => dropFile(old, key, att));
}

// null: the folder opened. path: no file manager opened it (501), so the user copies the path.
async function openFolder(pr: number, key: string): Promise<{ error: string; path: string } | null> {
  const res = await api.api.prs[":id"]["task-context"][":key"]["open-folder"].$post(keyParam(pr, key));
  if (res.status === 501) return (await res.json()) as { error: string; path: string };
  if (!res.ok) await read(res);
  return null;
}

type FileAct = "download" | "include" | "exclude" | "delete";
const DONE: Record<FileAct, (name: string) => string> = {
  download: (n) => `Downloaded ${n}.`,
  include: (n) => `${n} is included in runs.`,
  exclude: (n) => `${n} is no longer included in runs.`,
  delete: (n) => `Deleted the downloaded ${n}.`,
};
const KIND_ICON = { image: FileImage, text: FileText, file: File } as const;

// The files of one fetched task: Download, Download all, Save, Include in runs, Delete, and Open folder.
function Attachments({ pr, t, runner, announce }: { pr: number; t: TaskContextDto; runner: string; announce: (text: string) => void }) {
  const qc = useQueryClient();
  const rows = attachmentRows(t);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  // The words of the Download all button while it runs.
  const [all, setAll] = useState<string | null>(null);
  const [folder, setFolder] = useState<{ error: string; path: string | null } | null>(null);
  const [asking, setAsking] = useState<AttachmentRow | null>(null);
  // The last asked file stays while the dialog plays its close transition.
  const asked = useRef<AttachmentRow | null>(null);
  if (asking) asked.current = asking;
  // The user ticks the policy box each time. The dialog opens with focus on it.
  const [allowed, setAllowed] = useState(false);
  const allow = useRef<HTMLInputElement>(null);
  const base = `att-${t.key}`;
  if (!rows.length) return null;

  const focus = (...ids: string[]) =>
    requestAnimationFrame(() => {
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) return el.focus();
      }
    });
  const act = async (r: AttachmentRow, what: FileAct, quiet = false) => {
    setBusy((b) => new Set(b).add(r.id));
    setErrors((m) => {
      const n = new Map(m);
      n.delete(r.id);
      return n;
    });
    try {
      if (what === "download") await downloadFile(qc, pr, t.key, r.id);
      else if (what === "delete") await deleteFile(qc, pr, t.key, r.id);
      else await includeFile(qc, pr, t.key, r.id, what === "include");
      if (!quiet) announce(DONE[what](r.filename));
      return true;
    } catch (e) {
      const message = (e as Error).message;
      setErrors((m) => new Map(m).set(r.id, message));
      if (!quiet) announce(`${r.filename}: ${message}`);
      return false;
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(r.id);
        return n;
      });
    }
  };
  // Download and Delete take their own button away.
  const download = async (r: AttachmentRow) => {
    if (await act(r, "download")) focus(`${base}-${r.id}-save`);
  };
  const remove = async (r: AttachmentRow) => {
    if (await act(r, "delete")) focus(`${base}-${r.id}-dl`, `${base}-h`);
  };
  // One request after the other, so the tracker never gets parallel downloads from the app.
  const downloadAll = async () => {
    const todo = rows.filter(canDownload);
    let ok = 0;
    for (const [i, r] of todo.entries()) {
      setAll(`Downloading ${i + 1} of ${todo.length}…`);
      if (await act(r, "download", true)) ok++;
    }
    setAll(null);
    announce(
      ok === todo.length
        ? `Downloaded ${todo.length} files.`
        : `Downloaded ${ok} of ${todo.length} files. Each failed file shows its error.`,
    );
    focus(`${base}-open`, `${base}-h`);
  };
  const open = async () => {
    setFolder(null);
    try {
      const r = await openFolder(pr, t.key);
      if (!r) return announce(`Opened the folder of ${t.key}.`);
      setFolder(r);
      announce(r.error);
      focus(`${base}-copy`);
    } catch (e) {
      const error = (e as Error).message;
      setFolder({ error, path: null });
      announce(error);
    }
  };
  const copyPath = (path: string) =>
    copyText(path).then((ok) =>
      ok ? announce("Copied the folder path.") : toast.add({ title: "The clipboard is blocked here. Select the path and press Ctrl+C." }),
    );
  const confirm = () => {
    const r = asking;
    setAsking(null);
    if (r && allowed) void act(r, "include");
  };

  const todo = rows.filter(canDownload).length;
  const shown = asked.current;
  return (
    <section aria-labelledby={`${base}-h`} className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id={`${base}-h`} tabIndex={-1} className="m-0 inline-flex items-center gap-1.5 text-xs font-semibold text-ink-2">
          <Paperclip aria-hidden className={cn(icon, "text-muted-foreground")} />
          Attachments ({rows.length})
        </h3>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {(todo > 1 || all) && (
            <Button
              id={`${base}-all`}
              variant="outline"
              size="xs"
              disabled={!!all || busy.size > 0}
              focusableWhenDisabled
              className="aria-disabled:cursor-default aria-disabled:opacity-50"
              aria-busy={!!all || undefined}
              onClick={() => void downloadAll()}
            >
              {all ? (
                <LoaderCircle aria-hidden data-icon="inline-start" className="animate-spin" />
              ) : (
                <Download aria-hidden data-icon="inline-start" />
              )}
              {all ?? `Download all (${todo})`}
            </Button>
          )}
          {rows.some((r) => r.file) && (
            <Button id={`${base}-open`} variant="ghost" size="xs" onClick={() => void open()}>
              <FolderOpen aria-hidden data-icon="inline-start" />
              Open folder
            </Button>
          )}
        </span>
      </div>
      {folder && (
        <div className="grid gap-1">
          <p className={cn("m-0 flex items-start gap-1.5 text-xs", folder.path ? "text-ink-2" : "text-destructive")}>
            <CircleAlert aria-hidden className={icon} />
            {folder.error}
          </p>
          {folder.path && (
            <div className="flex min-w-0 items-center gap-1 rounded-md bg-sunken py-0.5 pr-0.5 pl-2.5">
              <code translate="no" className="min-w-0 flex-1 font-mono text-xs [overflow-wrap:anywhere]">
                {folder.path}
              </code>
              <Hint label="Copy the folder path">
                <Button
                  id={`${base}-copy`}
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Copy the folder path"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => void copyPath(folder.path ?? "")}
                >
                  <Copy aria-hidden />
                </Button>
              </Hint>
            </div>
          )}
        </div>
      )}
      <ul className="m-0 grid list-none rounded-md border p-0">
        {rows.map((r) => {
          const f = r.file;
          const Icon = KIND_ICON[fileKind(r)];
          const wait = busy.has(r.id);
          const error = errors.get(r.id);
          const name = <span className="sr-only"> {r.filename}</span>;
          return (
            <li key={r.id} data-att={r.id} className="grid gap-1 border-b px-2.5 py-1.5 last:border-b-0">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <Icon aria-hidden className={cn(icon, "text-muted-foreground")} />
                <span className="grid min-w-0 flex-[1_1_18ch]">
                  <span translate="no" className="truncate font-medium" title={r.filename}>
                    {r.filename}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {sizeText(r.size)}, {typeText(r)}. {fileState(r)}
                  </span>
                </span>
                {f ? (
                  <span className="rl-fade flex flex-wrap items-center gap-x-2 gap-y-1">
                    <a
                      id={`${base}-${r.id}-save`}
                      href={saveRoute(pr, t.key, r.id)}
                      download
                      className={buttonVariants({ variant: "ghost", size: "xs" })}
                    >
                      <Save aria-hidden data-icon="inline-start" />
                      Save{name}
                    </a>
                    {(includable(f) || f.include) && (
                      <span className="inline-flex items-center gap-1.5">
                        <Switch
                          id={`${base}-${r.id}-inc`}
                          size="sm"
                          checked={f.include}
                          disabled={wait}
                          onCheckedChange={(on) => {
                            if (!on) return void act(r, "exclude");
                            setAllowed(false);
                            setAsking(r);
                          }}
                        />
                        <label htmlFor={`${base}-${r.id}-inc`} className="cursor-pointer text-xs text-ink-2">
                          Include{name} in runs
                        </label>
                      </span>
                    )}
                    <Hint label={`Delete the downloaded ${r.filename}`}>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Delete ${r.filename}`}
                        disabled={wait}
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => void remove(r)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </Hint>
                  </span>
                ) : (
                  canDownload(r) && (
                    <Button
                      id={`${base}-${r.id}-dl`}
                      variant="outline"
                      size="xs"
                      disabled={wait || !!all}
                      focusableWhenDisabled
                      className="aria-disabled:cursor-default aria-disabled:opacity-50"
                      aria-busy={wait || undefined}
                      onClick={() => void download(r)}
                    >
                      {wait ? (
                        <LoaderCircle aria-hidden data-icon="inline-start" className="animate-spin" />
                      ) : (
                        <Download aria-hidden data-icon="inline-start" />
                      )}
                      Download{name}
                    </Button>
                  )
                )}
              </div>
              {error && (
                <p className="m-0 flex items-start gap-1.5 text-xs text-destructive">
                  <CircleAlert aria-hidden className={icon} />
                  {error}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <Dialog open={asking !== null} onOpenChange={(on) => !on && setAsking(null)}>
        <DialogContent
          className="sm:max-w-[480px]"
          initialFocus={allow}
          finalFocus={() => (shown ? document.getElementById(`${base}-${shown.id}-inc`) : null)}
          onKeyDown={dialogKeys(() => setAsking(null))}
        >
          {shown && (
            <>
              <DialogHeader>
                <DialogTitle>Include {shown.filename} in runs?</DialogTitle>
                <DialogDescription>
                  {shown.file?.image
                    ? `${runner} can then open this image in every run on this pull request: reviews, reply drafts, questions, and fixes.`
                    : `${runner} can then read this text in every run on this pull request: reviews, reply drafts, questions, and fixes. It reads it as untrusted data.`}
                </DialogDescription>
              </DialogHeader>
              <Alert role="note">
                <ShieldAlert aria-hidden />
                <AlertTitle>Company AI policy</AlertTitle>
                <AlertDescription>
                  {runner} sends the content of the files that it reads to its AI model. Check that your company AI policy allows this for
                  task attachments.
                </AlertDescription>
              </Alert>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  ref={allow}
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={allowed}
                  onChange={(e) => setAllowed(e.target.checked)}
                />
                <span>My company AI policy allows sending this file to an AI service.</span>
              </label>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAsking(null)}>
                  Cancel
                </Button>
                <Button disabled={!allowed} onClick={confirm}>
                  Include in runs
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

// The review that Start begins. once: the profile of the Review menu item, for this review only.
// since: the short source head of the re-review base. commits: the PR commits after it, null when unknown.
export type BriefMode = { kind: "review"; once: ProfileId | null } | { kind: "rereview"; since: string; commits: number | null };

export function BriefComposer(props: {
  pr: number;
  brief: BriefDto;
  tasks: PrTask[];
  meta: MetaDto;
  mode: BriefMode;
  // Why Start cannot begin now, such as a running run. The server still decides (A14).
  blocked: string | null;
  starting: boolean;
  // profile: a profile for this review only. Absent: the brief profile.
  onStart: (profile?: ProfileId) => void;
  // A profile pick in the brief ends the profile for this review only.
  onPick: () => void;
  onClose: () => void;
  onSettings: () => void;
  announce: (text: string) => void;
}) {
  const { pr, meta, mode } = props;
  const qc = useQueryClient();
  const { source, chips } = useTaskChips(pr, props.tasks, meta);
  const now = Date.now();
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
    props.onPick();
    setProfile(v);
    latest.current = { ...latest.current, profile: v };
    dirty.current = true;
    // The Review button names the profile at once.
    qc.setQueryData<BriefDto>(["brief", pr], (old) => old && { ...old, profile: v });
    void flush();
  };
  const once = mode.kind === "review" && mode.once !== profile ? mode.once : null;
  const chosen = profileOf(meta.profiles, once ?? profile);
  // The server check is the real guard. This shows a skill that GET /api/skills already misses.
  const skillList = useSkills(!!chosen?.alwaysSkills.length).data;
  const lost = skillList && chosen?.alwaysSkills.find((id) => !skillList.has(id));
  const blocked = props.blocked ?? (lost ? alwaysSkillError(lost) : null);
  const start = async () => {
    if (props.starting) return;
    if (blocked) {
      toast.add({ title: blocked });
      return;
    }
    if (await flush()) props.onStart(once ?? undefined);
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
      {mode.kind === "rereview" ? (
        <div className="grid gap-1">
          <h2 id="brief-title" className="m-0 text-[15px] font-bold">
            Review changes since{" "}
            <code translate="no" className="font-mono">
              {mode.since}
            </code>
          </h2>
          <p className="m-0 text-sm text-ink-2">
            Reviews only the {mode.commits ? plural(mode.commits, "commit") : "commits"} after{" "}
            <code translate="no" className="font-mono">
              {mode.since}
            </code>
            . The open drafts carry over and get a new check.
          </p>
        </div>
      ) : (
        <h2 id="brief-title" className="m-0 text-[15px] font-bold">
          Review brief
        </h2>
      )}
      <div className="grid gap-1.5">
        <TaskChips
          pr={pr}
          tasks={props.tasks}
          meta={meta}
          id="tk"
          focusTo="brief-note"
          announce={props.announce}
          onSettings={props.onSettings}
        />
        {chips.map(
          (c) =>
            c.fetched && (
              <TaskFold key={c.key} pr={pr} t={c.fetched} source={source} now={now} runner={meta.runner.name} announce={props.announce} />
            ),
        )}
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
                checked={chosen?.id === p.id}
                className="m-0 mt-[3px] accent-foreground"
                onChange={() => changeProfile(p.id)}
              />
              <span className="text-sm font-semibold">{p.name}</span>
              <span className="col-start-2 text-xs text-muted-foreground">{p.note}</span>
            </label>
          ))}
          {/* The words follow the profile pick, so a screen reader reads the new setup. */}
          <div id="brief-setup" aria-live="polite" className="mt-1.5 grid gap-1 border-t pt-2 text-xs text-muted-foreground">
            {once && (
              <p className="m-0 text-ink-2">Only for this review. The brief keeps the {profileOf(meta.profiles, profile)?.name} profile.</p>
            )}
            {chosen && (
              <p className="m-0 flex items-start gap-1.5">
                <Cpu aria-hidden className="mt-px size-[13px] shrink-0" />
                <span>
                  <span className="font-medium text-ink-2">Run setup:</span> {profileSetupText(chosen, meta.runner.defaults)}
                </span>
              </p>
            )}
          </div>
        </FieldSet>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <Button
          size="sm"
          disabled={props.starting || !!blocked}
          focusableWhenDisabled
          className="aria-disabled:cursor-default aria-disabled:opacity-50"
          aria-describedby="brief-foot"
          aria-keyshortcuts="Control+Enter"
          title="Key: Ctrl+Enter"
          onClick={() => void start()}
        >
          {props.starting && <LoaderCircle aria-hidden data-icon="inline-start" className="animate-spin" />}
          {mode.kind === "rereview" ? "Review changes" : "Start review"}
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
        <span id="brief-foot" className="ml-1.5 text-xs text-muted-foreground">
          {blocked ?? "Ctrl+Enter starts the review. Esc closes the brief."}
        </span>
      </div>
    </section>
  );
}
