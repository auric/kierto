// Plan r2 UI-JIRA: the pure task text rules of the brief and the AI summary.
import { describe, expect, test } from "bun:test";
import type { MetaDto, PrTask, RunDto, TaskContextDto } from "../../src/shared/dto";
import { commentsText, contextLines, mergeTask, offerSetup, sourceTime, taskChips, trackerOf } from "../../src/web/review/tasks";

const task = (key: string, source: PrTask["source"] = "description"): PrTask => ({ key, source, url: null });
const row = (key: string, o: Partial<TaskContextDto> = {}): TaskContextDto => ({
  key,
  summary: `Summary of ${key}`,
  status: "In Progress",
  description: "Text",
  comments: [],
  commentsTotal: 0,
  truncated: false,
  source: "jira",
  fetchedAt: 1_000,
  ...o,
});
const meta = (context: MetaDto["context"]) => ({ context }) as MetaDto;

describe("taskChips", () => {
  test("offers Fetch only for Jira-format keys while Jira is set up", () => {
    const tasks = [task("ABC-42"), task("abc-1"), task("ABC-0", "branch")];
    expect(taskChips(tasks, [], true).map((c) => [c.key, c.fetchable])).toEqual([
      ["ABC-42", true],
      ["abc-1", false],
      ["ABC-0", false],
    ]);
    expect(taskChips(tasks, [], false).some((c) => c.fetchable)).toBe(false);
  });

  test("joins fetched rows, and keeps a fetched task that the PR no longer names", () => {
    const chips = taskChips([task("ABC-42")], [row("ABC-42"), row("OLD-7")], true);
    expect(chips.map((c) => [c.key, c.source, c.fetched?.key ?? null, c.fetchable])).toEqual([
      ["ABC-42", "description", "ABC-42", true],
      ["OLD-7", null, "OLD-7", false],
    ]);
  });
});

test("offerSetup needs a Jira-format key and no Jira source", () => {
  expect(offerSetup([task("ABC-42")], false)).toBe(true);
  expect(offerSetup([task("ABC-42")], true)).toBe(false);
  expect(offerSetup([task("abc-42")], false)).toBe(false);
  expect(offerSetup([], false)).toBe(false);
});

test("the tracker comes from meta, set up or not, and is absent without a meta entry", () => {
  expect(trackerOf(meta([]))).toBeNull();
  const off = { id: "jira" as const, name: "Jira", configured: false };
  expect(trackerOf(meta([off]))).toEqual(off);
  expect(trackerOf(meta([{ ...off, configured: true }]))?.configured).toBe(true);
});

test("mergeTask replaces the row of the key and keeps the key order", () => {
  const out = mergeTask([row("ABC-1"), row("ABC-9", { fetchedAt: 1 })], row("ABC-9", { fetchedAt: 2 }));
  expect(out.map((r) => [r.key, r.fetchedAt])).toEqual([
    ["ABC-1", 1_000],
    ["ABC-9", 2],
  ]);
  expect(mergeTask(undefined, row("ABC-5")).map((r) => r.key)).toEqual(["ABC-5"]);
  expect(mergeTask([row("ABC-7")], row("ABC-3")).map((r) => r.key)).toEqual(["ABC-3", "ABC-7"]);
});

test("commentsText names a cut comment list", () => {
  const c = { author: "A", created: "", body: "" };
  expect(commentsText(row("A-1"))).toBe("no comments");
  expect(commentsText(row("A-1", { comments: [c], commentsTotal: 1 }))).toBe("1 comment");
  expect(commentsText(row("A-1", { comments: [c, c], commentsTotal: 3 }))).toBe("2 of 3 comments");
});

test("sourceTime reads the Jira offset form and keeps other text", () => {
  const jira = sourceTime("2026-01-05T09:12:31.000+0000");
  expect(jira).toBe(sourceTime("2026-01-05T09:12:31.000Z"));
  expect(jira).toContain("2026");
  expect(sourceTime("last Tuesday")).toBe("last Tuesday");
  expect(sourceTime("")).toBe("");
});

test("contextLines marks a task fetched after the run started", () => {
  const now = new Date(2026, 9, 11, 15, 0).getTime();
  const at = (h: number, m: number) => new Date(2026, 9, 11, h, m).getTime();
  const run = { startedAt: at(14, 0) } as RunDto;
  expect(contextLines([row("ABC-1", { fetchedAt: at(13, 5) }), row("ABC-2", { fetchedAt: at(14, 30) })], run, "Jira", now)).toEqual([
    "ABC-1 from Jira, fetched today 13:05",
    "ABC-2 from Jira, fetched after this run (today 14:30)",
  ]);
  expect(contextLines([], run, "Jira", now)).toEqual([]);
});
