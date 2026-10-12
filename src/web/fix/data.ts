// Fix it server state (plan r3 UI-FIX). Keys ["pr", pr, "fixes"] and ["pr", pr, "clone"]: a live `changed` that names the PR
// refreshes both. A commit or an undo names the PR too.
import { type QueryClient, useQuery } from "@tanstack/react-query";
import type { CloneDto, CloneRowDto, FixCommitDto, FixCommitInput, FixConflict, FixDto } from "../../shared/dto";
import { api } from "../api";
import { type RunStart, runBody, started, useStart } from "../review/data";
import { read } from "../shell/data";

const param = (id: number) => ({ param: { id: String(id) } });

export const fixesKey = (pr: number) => ["pr", pr, "fixes"] as const;
export const cloneKey = (pr: number) => ["pr", pr, "clone"] as const;

// GET /api/prs/:id/fixes: the newest fix runs, newest first.
export const useFixes = (pr: number, enabled: boolean) =>
  useQuery({
    queryKey: fixesKey(pr),
    enabled,
    queryFn: async () => read<FixDto[]>(await api.api.prs[":id"].fixes.$get(param(pr))),
  });

// GET /api/prs/:id/clone runs git in the clone, never a network command.
export const getClone = async (pr: number) => read<CloneDto>(await api.api.prs[":id"].clone.$get(param(pr)));
export const useClone = (pr: number, enabled: boolean) => useQuery({ queryKey: cloneKey(pr), enabled, queryFn: () => getClone(pr) });

// 400: the server refuses the path, with the reason.
export const putClone = async (pr: number, path: string) =>
  read<CloneDto>(await api.api.prs[":id"].clone.$put({ ...param(pr), json: { path } }));

export async function dropClone(pr: number) {
  const res = await api.api.prs[":id"].clone.$delete(param(pr));
  if (!res.ok) await read(res);
}

// GET /api/clones: every clone folder, with no git command. A save or a clear of a clone changes it.
export const clonesKey = ["clones"] as const;
export const useClones = (enabled = true) =>
  useQuery({ queryKey: clonesKey, enabled, queryFn: async () => read<CloneRowDto[]>(await api.api.clones.$get()) });

// A clone change shows in the clone list and in the clone check of each PR. except: a PR whose clone state the caller sets.
export const clonesChanged = (qc: QueryClient, except?: number) => {
  void qc.invalidateQueries({ queryKey: clonesKey });
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "pr" && q.queryKey[2] === "clone" && q.queryKey[1] !== except });
};

// null: the folder opened. path: no file manager opened it (501), so the user copies the path.
export async function openCloneFolder(pr: number): Promise<{ error: string; path: string } | null> {
  const res = await api.api.prs[":id"].clone["open-folder"].$post(param(pr));
  if (res.status === 501) return (await res.json()) as { error: string; path: string };
  if (!res.ok) await read(res);
  return null;
}

// POST /api/prs/:id/fix-run. Absent threads: each thread with a valid or partly valid reply draft.
export const useStartFix = (pr: number) =>
  useStart(pr, async (o: RunStart) => started(await api.api.prs[":id"]["fix-run"].$post({ ...param(pr), json: runBody(o) })));

// 409 with problems: a clone check failed. 409 without problems: another refusal, such as a failed hook with the stderr tail;
// then the edits stay staged. 502: the forge did not give the pull request, so the user can try again.
export type CommitOutcome = { ok: FixCommitDto } | { status: 409 | 502; error: string; problems: FixConflict["problems"] };

export async function commitFix(run: number, input: FixCommitInput): Promise<CommitOutcome> {
  const res = await api.api["fix-runs"][":id"].commit.$post({ ...param(run), json: input });
  if (res.ok) return { ok: (await res.json()) as FixCommitDto };
  if (res.status !== 409 && res.status !== 502) return read<never>(res);
  const text = await res.text();
  let body: Partial<FixConflict> = {};
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: res.status, error: body.error ?? text, problems: body.problems ?? [] };
}

export const undoFix = async (id: number) => read<FixCommitDto>(await api.api["fix-commits"][":id"].undo.$post(param(id)));
