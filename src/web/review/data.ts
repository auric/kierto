// Review server state through TanStack Query. Keys: ['brief', pr], ['runs'], ['runs', 'pr', pr], ['run', id], ['raw', id].
// live.ts invalidates ['runs'] and ['run', id] when SSE `changed` names the run.
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BriefDto, BriefInput, ItemActionInput, ItemConflict, ReviewItemDto, RunConflict, RunDetail, RunDto } from "../../shared/dto";
import { api } from "../api";
import { ApiError, read } from "../shell/data";

const param = (id: number) => ({ param: { id: String(id) } });

export const useBrief = (pr: number) =>
  useQuery({ queryKey: ["brief", pr], queryFn: async () => read<BriefDto>(await api.api.prs[":id"].brief.$get(param(pr))) });

// A plain function, so a save from an unmounted composer still ends and updates the cache.
export async function putBrief(qc: QueryClient, pr: number, input: BriefInput) {
  const dto = await read<BriefDto>(await api.api.prs[":id"].brief.$put({ ...param(pr), json: input }));
  qc.setQueryData(["brief", pr], dto);
  return dto;
}

export const usePrRuns = (pr: number) =>
  useQuery({ queryKey: ["runs", "pr", pr], queryFn: async () => read<RunDto[]>(await api.api.prs[":id"].runs.$get(param(pr))) });

// GET /api/runs: the 50 newest runs of all PRs, newest first.
export const useRuns = () => useQuery({ queryKey: ["runs"], queryFn: async () => read<RunDto[]>(await api.api.runs.$get()) });

export const useRun = (id: number | null) =>
  useQuery({
    queryKey: ["run", id],
    enabled: id !== null,
    queryFn: async () => read<RunDetail>(await api.api.runs[":id"].$get(param(id ?? 0))),
  });

// The raw output of an ended run does not change.
export const useRaw = (id: number, enabled: boolean) =>
  useQuery({
    queryKey: ["raw", id],
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const res = await api.api.runs[":id"].raw.$get(param(id));
      if (!res.ok) return read<string>(res);
      return res.text();
    },
  });

export type StartResult = { run: RunDto } | { conflict: RunConflict };

// POST /api/prs/:id/review runs the stored brief. 409 with `running` names the review that holds the only slot (A14).
async function postReview(pr: number): Promise<StartResult> {
  const res = await api.api.prs[":id"].review.$post(param(pr));
  if (res.status !== 409) return { run: await read<RunDto>(res) };
  const text = await res.text();
  let body: Partial<RunConflict> = {};
  try {
    body = JSON.parse(text);
  } catch {}
  if (body.running) return { conflict: body as RunConflict };
  throw new ApiError(409, body.error ?? text);
}

export function useStartReview(pr: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => postReview(pr),
    onSuccess: (r) => {
      if (!("run" in r)) return;
      qc.setQueryData<RunDto[]>(["runs", "pr", pr], (old) => [r.run, ...(old ?? []).filter((x) => x.id !== r.run.id)]);
      qc.invalidateQueries({ queryKey: ["runs"] });
    },
  });
}

export type ItemResult = { item: ReviewItemDto } | { conflict: ItemConflict };

// POST /api/items/:id (WP12). 409 with `item`: the item changed in another page. The page then shows that item.
export async function sendItem(id: number, input: ItemActionInput): Promise<ItemResult> {
  const res = await api.api.items[":id"].$post({ ...param(id), json: input });
  if (res.status !== 409) return { item: await read<ReviewItemDto>(res) };
  const text = await res.text();
  let body: Partial<ItemConflict> = {};
  try {
    body = JSON.parse(text);
  } catch {}
  if (body.item) return { conflict: body as ItemConflict };
  throw new ApiError(409, body.error ?? text);
}

export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => read<{ cancelling: boolean }>(await api.api.runs[":id"].cancel.$post(param(id))),
    onSettled: (_, __, id) => qc.invalidateQueries({ queryKey: ["run", id] }),
  });
}
