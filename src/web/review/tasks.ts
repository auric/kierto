// Imported task text (plan r2, task context UI): the pure rules. Brief.tsx holds the requests.
import { JIRA_KEY, type MetaDto, type PrTask, type RunDto, type TaskContextDto } from "../../shared/dto";
import { visitText } from "../pr/threads";

// The issue tracker is the only context source in Release 2. Meta lists it, set up or not. Its id is also the name of its
// SettingsDto field and of its route PUT /api/settings/<id>. null: no tracker, so the UI shows no tracker control.
export type Tracker = { id: TaskContextDto["source"]; name: string; configured: boolean };
export const trackerOf = (meta: MetaDto) => (meta.context[0] as Tracker | undefined) ?? null;

// source null: a fetched task that the PR no longer names. Its text still goes to the review, so the brief shows it with Remove.
export type TaskChip = {
  key: string;
  source: PrTask["source"] | null;
  url: string | null;
  fetched: TaskContextDto | null;
  fetchable: boolean;
};

export function taskChips(tasks: PrTask[], rows: TaskContextDto[], on: boolean): TaskChip[] {
  const fetched = new Map(rows.map((r) => [r.key, r]));
  const out: TaskChip[] = tasks.map((t) => ({
    key: t.key,
    source: t.source,
    url: t.url,
    fetched: fetched.get(t.key) ?? null,
    fetchable: on && JIRA_KEY.test(t.key),
  }));
  const named = new Set(tasks.map((t) => t.key));
  for (const r of rows) if (!named.has(r.key)) out.push({ key: r.key, source: null, url: null, fetched: r, fetchable: false });
  return out;
}

// "Set up" shows only for a PR that names a key in the tracker key format.
export const offerSetup = (tasks: PrTask[], on: boolean) => !on && tasks.some((t) => JIRA_KEY.test(t.key));

// Same order as the server: by key.
export const mergeTask = (rows: TaskContextDto[] | undefined, t: TaskContextDto) =>
  [...(rows ?? []).filter((r) => r.key !== t.key), t].sort((a, b) => (a.key < b.key ? -1 : 1));

// The tracker sends "2026-01-05T09:12:31.000+0000" (REST docs, fixtures). ISO 8601 needs the colon in the offset.
// Other text shows as it is.
export function sourceTime(text: string): string {
  const ms = Date.parse(text.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(ms)
    ? text
    : new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const fetchedText = (t: TaskContextDto, now: number) => `fetched ${visitText(t.fetchedAt, now)}`;

// The server caps and the page limit can leave out comments.
export function commentsText(t: TaskContextDto): string {
  const total = t.commentsTotal;
  if (!total) return "no comments";
  const all = `${total} comment${total === 1 ? "" : "s"}`;
  return t.comments.length === total ? all : `${t.comments.length} of ${all}`;
}

// The AI summary Context row. The run read the text that was stored when it started.
export function contextLines(rows: TaskContextDto[], run: RunDto, source: string, now: number): string[] {
  return rows.map((t) =>
    t.fetchedAt > run.startedAt
      ? `${t.key} from ${source}, fetched after this run (${visitText(t.fetchedAt, now)})`
      : `${t.key} from ${source}, ${fetchedText(t, now)}`,
  );
}
