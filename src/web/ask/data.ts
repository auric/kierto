// Ask server state (plan r2 UI-ASK). Key ['pr', pr, 'asks']: live.ts invalidates it with the PR when a run starts or ends.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AskDto } from "../../shared/dto";
import { api } from "../api";
import { started, useStart } from "../review/data";
import { read } from "../shell/data";

const param = (id: number) => ({ param: { id: String(id) } });

export const askKey = (pr: number) => ["pr", pr, "asks"] as const;

// The unsent question of a PR. Storage can be absent or blocked. Then the box starts empty and keeps nothing.
const draftKey = (pr: number) => `rl:ask:${pr}`;
export function loadDraft(pr: number): string {
  try {
    return localStorage.getItem(draftKey(pr)) ?? "";
  } catch {
    return "";
  }
}
export function saveDraft(pr: number, text: string) {
  try {
    if (text) localStorage.setItem(draftKey(pr), text);
    else localStorage.removeItem(draftKey(pr));
  } catch {}
}

// GET /api/prs/:id/asks: the 20 newest ask runs of the PR with their answers, newest first.
export const useAsks = (pr: number) =>
  useQuery({ queryKey: askKey(pr), queryFn: async () => read<AskDto[]>(await api.api.prs[":id"].asks.$get(param(pr))) });

// POST /api/prs/:id/ask. 202 starts a run. 200 gives the running run of the same question. The new run shows at once.
// A sent question leaves the storage, also when the page left the PR before the answer came. A refused one stays.
export function useStartAsk(pr: number) {
  const qc = useQueryClient();
  return useStart(pr, async (question: string) => {
    const r = await started(await api.api.prs[":id"].ask.$post({ ...param(pr), json: { question } }));
    if (!("run" in r)) return r;
    qc.setQueryData<AskDto[]>(askKey(pr), (old) => [{ run: r.run, answer: null }, ...(old ?? []).filter((a) => a.run.id !== r.run.id)]);
    if (loadDraft(pr).trim() === question) saveDraft(pr, "");
    return r;
  });
}
