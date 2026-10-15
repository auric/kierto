// Session consult server state and per-viewer storage (docs/plans/session-consult.md parts A and B). Key ['pr', pr, 'consult']:
// live.ts invalidates it with the PR. Storage can be off or full, so each read and write has a fallback.
import { useQuery } from "@tanstack/react-query";
import { type ConsultData, type ConsultGroup, type ConsultImportDto, type ConsultUndoDto, consultGroups } from "../../shared/consult";
import { api } from "../api";
import { read } from "../shell/data";

const param = (id: number) => ({ param: { id: String(id) } });

export const consultKey = (pr: number) => ["pr", pr, "consult"] as const;

// GET /api/prs/:id/consult: the header and the item blocks of all groups. It reads the git cache, so it runs only while a dialog is open.
export const useConsultData = (pr: number, enabled: boolean) =>
  useQuery({
    queryKey: consultKey(pr),
    enabled,
    staleTime: 0,
    queryFn: async () => read<ConsultData>(await api.api.prs[":id"].consult.$get(param(pr))),
  });

export const postImport = async (pr: number, entries: unknown[], snapshot: Record<string, string> | null) =>
  read<ConsultImportDto>(await api.api.prs[":id"].consult.import.$post({ ...param(pr), json: { entries, snapshot } }));

export const postUndo = async (pr: number, run: number) =>
  read<ConsultUndoDto>(await api.api.prs[":id"].consult[":run"].undo.$post({ param: { id: String(pr), run: String(run) } }));

// ---------- Per viewer ----------

const GROUPS = "rl:consult-groups";
const snapKey = (pr: number) => `rl:consult:${pr}`;

// The ticked groups of the copy dialog. Default: all.
export function loadGroups(): Set<ConsultGroup> {
  try {
    const raw = JSON.parse(localStorage.getItem(GROUPS) ?? "null") as unknown;
    if (Array.isArray(raw)) return new Set(consultGroups.filter((g) => raw.includes(g)));
  } catch {}
  return new Set(consultGroups);
}
export function saveGroups(groups: ReadonlySet<ConsultGroup>) {
  try {
    localStorage.setItem(GROUPS, JSON.stringify([...groups]));
  } catch {}
}

// The item keys at the last copy of this PR. null: no copy in this browser.
export function loadSnapshot(pr: number): Record<string, string> | null {
  try {
    const raw = JSON.parse(localStorage.getItem(snapKey(pr)) ?? "null") as { keys?: unknown } | null;
    const keys = raw?.keys;
    if (keys && typeof keys === "object" && Object.values(keys).every((v) => typeof v === "string")) return keys as Record<string, string>;
  } catch {}
  return null;
}
export function saveSnapshot(pr: number, keys: Record<string, string>) {
  try {
    localStorage.setItem(snapKey(pr), JSON.stringify({ at: Date.now(), keys }));
  } catch {}
}
