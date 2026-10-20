// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import { describe, expect, test } from "bun:test";
import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { changedFilters, diffRefresh } from "../../src/web/live";

const KEYS: QueryKey[] = [
  ["prs"],
  ["pr", 1],
  ["pr", 1, "diff"],
  ["pr", 1, "diff", "src/a.ts", 0],
  ["pr", 2],
  ["pr", 2, "diff"],
  ["brief", 1],
];

// The keys that the filters mark stale in a cache that holds every key of KEYS.
async function stale(filters: Parameters<QueryClient["invalidateQueries"]>[0][], index: unknown = { files: [] }) {
  const qc = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  for (const k of KEYS) qc.setQueryData(k, k.length === 3 && k[2] === "diff" ? index : {});
  for (const f of filters) await qc.invalidateQueries(f);
  return KEYS.filter((k) => qc.getQueryState(k)?.isInvalidated).map((k) => JSON.stringify(k));
}

describe("live event keys", () => {
  test("a read or sync event of a PR never touches its diff keys", async () => {
    expect(await stale(changedFilters({ prs: [1] }))).toEqual(['["prs"]', '["pr",1]', '["brief",1]']);
  });

  test("a PR event refetches a diff index that asks for the code", async () => {
    expect(await stale(changedFilters({ prs: [1] }), { fetch: true })).toContain('["pr",1,"diff"]');
  });

  test("a source head change refetches the diff index and pages of that PR only", async () => {
    const f = diffRefresh(1, "aaa", "bbb");
    expect(f).not.toBeNull();
    expect(await stale(f ? [f] : [])).toEqual(['["pr",1,"diff"]', '["pr",1,"diff","src/a.ts",0]']);
  });

  test("the first head and an equal head refetch no diff", () => {
    expect(diffRefresh(1, undefined, "aaa")).toBeNull();
    expect(diffRefresh(1, "aaa", "aaa")).toBeNull();
    expect(diffRefresh(1, "aaa", undefined)).toBeNull();
  });
});
