// Server state through TanStack Query. Keys: ['prs'], ['pr', id], ['status'], ['settings'], ['meta'], ['task-preview', ...].
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast";
import type { CheckpointDto, ClaimedEvent, FollowState, PrDetail, PrRow, SettingsDto, SettingsInput, SyncStatus } from "../../shared/dto";
import { api } from "../api";
import type { AckItem } from "../pr/ack";

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

export async function read<T>(res: Res): Promise<T> {
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

export const usePr = (id: number, enabled = true) =>
  useQuery({
    queryKey: ["pr", id],
    enabled,
    queryFn: async () => read<PrDetail>(await api.api.prs[":id"].$get({ param: { id: String(id) } })),
  });

// plan v3 section 2: the last visit. The detail keeps the previous value for "N new since".
export const sendSeen = async (id: number) =>
  read<{ id: number; seenAt: number }>(await api.api.prs[":id"].seen.$post({ param: { id: String(id) } }));

export const claimEvents = async () => read<ClaimedEvent[]>(await api.api.notifications.claim.$post());

// keepalive: the request also completes when the page closes.
export const sendRead = async (pr: number, items: AckItem[]) =>
  read<{ updated: number }>(await api.api.read.$post({ json: { pr, items } }, { init: { keepalive: true } }));

export function useFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, followed }: { id: number; followed: boolean }) =>
      read<FollowState>(await api.api.prs[":id"].follow.$post({ param: { id: String(id) }, json: { followed } })),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["prs"] });
      qc.invalidateQueries({ queryKey: ["pr", id] });
    },
  });
}

const postArchive = async (id: number, archived: boolean) =>
  read<FollowState>(await api.api.prs[":id"].archive.$post({ param: { id: String(id) }, json: { archived } }));

// The PR leaves the list before the request, so its detail unmounts and never refetches into a 404.
// Hook-level callbacks run also after the detail unmounts. Per-call callbacks would not.
export function useArchive() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["prs"] });
  return useMutation({
    mutationFn: ({ id }: { id: number; label: string }) => postArchive(id, true),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ["prs"] });
      qc.setQueryData<PrRow[]>(["prs"], (old) => old?.filter((p) => p.id !== id));
    },
    onSuccess: (_, { id, label }) =>
      toast.add({
        title: `Archived ${label}`,
        description: "It no longer shows in any view.",
        actionProps: {
          children: "Undo",
          onClick: () => postArchive(id, false).then(refresh, (e: Error) => toast.add({ title: "Undo failed", description: e.message })),
        },
      }),
    onError: (e) => toast.add({ title: "Archive failed", description: e.message }),
    onSettled: refresh,
  });
}

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
