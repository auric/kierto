// Diff server state (plan r2 UI-DIFF). Keys ['pr', pr, 'diff'] and ['pr', pr, 'diff', path, start]: live.ts invalidates them with the PR.
import {
  type QueryClient,
  queryOptions,
  type UseQueryResult,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type ChangedFile, DIFF_PAGE_ROWS, type DiffIndexDto, type DiffPageDto, type DiffRowDto } from "../../shared/dto";
import { api } from "../api";
import { ApiError, read } from "../shell/data";

const param = (id: number) => ({ param: { id: String(id) } });

export const diffKey = (pr: number) => ["pr", pr, "diff"] as const;
const pageKey = (pr: number, path: string, start: number) => ["pr", pr, "diff", path, start] as const;

// fetch: the local cache does not hold the PR heads. Only a click on "Get the code" or on a file row fetches them (plan r2 section 6).
export type DiffIndex = DiffIndexDto | { fetch: true };

type Res = { ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> };

// GET gives 409 {fetch: true} when the code is missing. Other errors throw as ApiError.
async function readIndex(res: Res): Promise<DiffIndex> {
  if (res.status !== 409) return read<DiffIndexDto>(res);
  const text = await res.text();
  let body: { error?: unknown; fetch?: unknown } = {};
  try {
    body = JSON.parse(text);
  } catch {}
  if (body.fetch === true) return { fetch: true };
  throw new ApiError(409, typeof body.error === "string" ? body.error : text);
}

export const indexQuery = (pr: number) =>
  queryOptions({ queryKey: diffKey(pr), queryFn: async () => readIndex(await api.api.prs[":id"].diff.$get(param(pr))) });

// path: the new path, or the old path of a deleted file.
export const pageQuery = (pr: number, path: string, start: number) =>
  queryOptions({
    queryKey: pageKey(pr, path, start),
    queryFn: async () =>
      read<DiffPageDto>(await api.api.prs[":id"].diff.file.$get({ ...param(pr), query: { path, start: String(start) } })),
  });

export const useDiffIndex = (pr: number, enabled: boolean) => useQuery({ ...indexQuery(pr), enabled });

// The one count of Files, for its head and the summary line: the git index once it loads, else the forge list. null: no list.
export const fileCount = (index: DiffIndex | undefined, files: ChangedFile[] | undefined) =>
  index && !("fetch" in index) ? index.files.length : files?.length || null;

export type Pages = {
  // The rows of the loaded pages up to the first page without data.
  rows: DiffRowDto[];
  // rows hold every row of the file.
  complete: boolean;
  loading: boolean;
  error: Error | null;
  retry: (() => void) | null;
};

function joinPages(rs: UseQueryResult<DiffPageDto>[]): Pages {
  const rows: DiffRowDto[] = [];
  let complete = false;
  for (const r of rs) {
    if (!r.data) return { rows, complete, loading: r.isPending && r.fetchStatus !== "idle", error: r.error, retry: () => r.refetch() };
    for (const x of r.data.rows) rows.push(x);
    complete = r.data.next === null;
  }
  return { rows, complete, loading: false, error: null, retry: null };
}

// The first `pages` pages of one file.
export const useDiffPages = (pr: number, path: string, pages: number) =>
  useQueries({ queries: Array.from({ length: pages }, (_, k) => pageQuery(pr, path, k * DIFF_PAGE_ROWS)), combine: joinPages });

// Cached data unless a live event invalidated it.
export const cachedIndex = (qc: QueryClient, pr: number) => qc.fetchQuery({ ...indexQuery(pr), staleTime: Number.POSITIVE_INFINITY });

// Loads pages from the start until `found` holds or the file ends. total: the row count of the file in the index.
// pages: the count of pages that it needed.
export async function loadUntil(qc: QueryClient, pr: number, path: string, total: number, found: (rows: DiffRowDto[]) => boolean) {
  const rows: DiffRowDto[] = [];
  const last = Math.max(1, Math.ceil(total / DIFF_PAGE_ROWS));
  for (let k = 0; k < last; k++) {
    const p = await qc.fetchQuery({ ...pageQuery(pr, path, k * DIFF_PAGE_ROWS), staleTime: Number.POSITIVE_INFINITY });
    for (const x of p.rows) rows.push(x);
    if (found(rows) || p.next === null) return { pages: k + 1, rows, complete: p.next === null };
  }
  return { pages: last, rows, complete: false };
}

// POST /api/prs/:id/diff/fetch. git fetch of the PR heads into the local cache. A review run fills it too.
// The mutation variable is the path of the file row that started the fetch, or null. onGot runs also when that row unmounted.
export function useGetCode(pr: number, onGot: (index: DiffIndexDto, path: string | null) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_path: string | null) => read<DiffIndexDto>(await api.api.prs[":id"].diff.fetch.$post(param(pr))),
    onSuccess: (index, path) => {
      qc.setQueryData<DiffIndex>(diffKey(pr), index);
      // Pages of earlier heads can be in the cache.
      void qc.invalidateQueries({ queryKey: diffKey(pr), predicate: (q) => q.queryKey.length > 3 });
      onGot(index, path);
    },
  });
}
