// Server state through TanStack Query. Keys: ['prs'], ['pr', id], ['status'], ['settings'].
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SyncStatus } from "../../server/sync/engine";
import type { CheckpointDto, FollowState, PrRow, SettingsDto, SettingsInput } from "../../shared/dto";
import { api } from "../api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    // The server restarted and the page holds an old session token.
    readonly stale = false,
  ) {
    super(message);
  }
}

// A rejected fetch means that the local server does not answer.
export const isStopped = (e: unknown) => e instanceof TypeError;
export const isStale = (e: unknown) => e instanceof ApiError && e.stale;

// The hc client response. Its type is not a DOM Response.
type Res = { ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> };

// Retries only failures that can pass: not a stopped server, not an answer from the server.
export const retry = (n: number, e: unknown) => !isStopped(e) && !(e instanceof ApiError) && n < 2;

async function read<T>(res: Res): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  const text = await res.text();
  if (res.status === 403 && text === "session_stale") throw new ApiError(403, "The service restarted. Reload the page.", true);
  let message = text || `Request failed (${res.status}).`;
  try {
    message = (JSON.parse(text) as { error?: string }).error ?? message;
  } catch {}
  throw new ApiError(res.status, message);
}

export type Status = { sync: SyncStatus; dashboard: CheckpointDto | null };

export const usePrs = () => useQuery({ queryKey: ["prs"], queryFn: async () => read<PrRow[]>(await api.api.prs.$get()) });
export const useStatus = () => useQuery({ queryKey: ["status"], queryFn: async () => read<Status>(await api.api.status.$get()) });
export const useSettings = () =>
  useQuery({ queryKey: ["settings"], queryFn: async () => read<SettingsDto>(await api.api.settings.$get()) });

export function useCheckNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => read<SyncStatus>(await api.api.sync.$post()),
    onSuccess: (sync) => qc.setQueryData<Status>(["status"], (old) => (old ? { ...old, sync } : old)),
  });
}

export function useFollowUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (url: string) => read<FollowState>(await api.api.follow.$post({ json: { url } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prs"] }),
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SettingsInput) => read<SettingsDto>(await api.api.settings.$put({ json: input })),
    onSuccess: (dto) => {
      qc.setQueryData(["settings"], dto);
      qc.invalidateQueries({ queryKey: ["prs"] });
      qc.invalidateQueries({ queryKey: ["status"] });
    },
  });
}
