// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Explain server state (docs/plans/review-v2/spec.md section 3.2). Key ['pr', pr, 'explain']: live.ts invalidates it with the PR
// when a run starts or ends.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ExplainDto } from "../../shared/dto";
import { api } from "../api";
import { started, useStart } from "../review/data";
import { read } from "../shell/data";

const param = (id: number) => ({ param: { id: String(id) } });

export const explainKey = (pr: number) => ["pr", pr, "explain"] as const;

// GET /api/prs/:id/explain: the newest explain run with its result, or null. Reading starts no run (AC-X7).
export const useExplain = (pr: number) =>
  useQuery({ queryKey: explainKey(pr), queryFn: async () => read<ExplainDto | null>(await api.api.prs[":id"].explain.$get(param(pr))) });

// POST /api/prs/:id/explain. profile: a profile for this run only. 202 starts a run, 200 gives the running run or the stored result.
// A new run shows at once, with the shown walkthrough as the previous one.
export function useStartExplain(pr: number) {
  const qc = useQueryClient();
  return useStart(pr, async (profile: string | null) => {
    const r = await started(await api.api.prs[":id"].explain.$post({ ...param(pr), query: profile ? { profile } : {} }));
    if (!("run" in r)) return r;
    if (r.run.status === "running")
      qc.setQueryData<ExplainDto | null>(explainKey(pr), (old) => {
        const previous = old?.result ? { run: old.run, result: old.result } : old?.previous;
        return { run: r.run, result: null, ...(previous && { previous }) };
      });
    void qc.invalidateQueries({ queryKey: explainKey(pr) });
    return r;
  });
}
