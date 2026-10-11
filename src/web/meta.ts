// Product names from GET /api/meta (plan v3 section 2). UI code holds no product name.
import { useQuery } from "@tanstack/react-query";
import type { MetaDto } from "../shared/dto";
import { api } from "./api";
import { read } from "./shell/data";

export const useMeta = () =>
  useQuery({ queryKey: ["meta"], queryFn: async () => read<MetaDto>(await api.api.meta.$get()), staleTime: Number.POSITIVE_INFINITY });

// The shell renders its panes only after meta loads, so the empty fallback never shows.
export const useForge = () => useMeta().data?.forge.name ?? "";
