// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Scoring of an eval result file (docs/plans/review-v2/spec.md section 4.3). Pure: no file, no process, no clock.
import type { RunUsage } from "../../src/shared/dto";
import type { AnchorState, Coverage, Side } from "../../src/shared/review";
import type { RunStatus } from "../../src/shared/run-log";
import type { EvalBug, EvalSet, EvalTrap } from "./cases";

export type Severity = "blocker" | "major" | "minor" | "nit";
export type Volume = "quiet" | "balanced" | "thorough";
// null: a run without a verify phase (prompt version 1).
export type Check = "checked" | "unsure" | "unchecked";
// main: the main Drafts list. fold: a fold under it. hidden: refuted or duplicate, shown only in the run record.
export type Group = "main" | "fold" | "hidden";

const RANK: Record<Severity, number> = { nit: 0, minor: 1, major: 2, blocker: 3 };

// One finding item of a run. path, side, line, lineEnd: the anchor that the app stored.
export type EvalItem = {
  path: string;
  side: Side;
  line: number;
  lineEnd: number;
  anchorState: AnchorState;
  severity: Severity;
  finderSeverity: Severity;
  verdict: string | null;
  check: Check | null;
  group: Group;
  status: string;
  title: string;
  body: string;
  category: string;
  module: string | null;
  trigger: string | null;
  confidence: string;
  evidenceStatus: string;
  agent: string | null;
};

export type EvalDropped = { path: string; side: Side; line: number; lineEnd: number | null; severity: Severity; reason: string };

// status error: the harness failed before or around the run, see error.
export type CaseRun = {
  case: string;
  repeat: number;
  run: number | null;
  status: RunStatus | "error";
  errorKind: string | null;
  error: string | null;
  model: string | null;
  effort: string | null;
  effortDefault: string | null;
  // The init model and the subagent models of the run. Absent in files made before this field existed.
  models?: string[];
  startedAt: number | null;
  finishedAt: number | null;
  minutes: number | null;
  usage: RunUsage | null;
  // The coverage of the run summary. Skipped or unavailable entries make a run incomplete. Absent in files made before this field existed.
  coverage?: Coverage | null;
  items: EvalItem[];
  dropped: EvalDropped[];
  questions: number;
};

export type EvalCaseInfo = {
  id: string;
  title: string;
  language: string;
  changedLines: number;
  base: string;
  head: string;
  bugs: EvalBug[];
  traps: EvalTrap[];
};

export type EvalResult = {
  format: 1;
  createdAt: string;
  commit: string;
  dirty: boolean;
  promptVersion: string;
  cliVersion: string;
  runner: "real" | "fake";
  profile: Record<string, unknown> & { id: string; name: string; revision: string };
  volume: Volume | null;
  // The --model and --effort values of the run, or "default" for no flag. Absent in files made before this field existed.
  requested?: { model: string; effort: string };
  // The case set. Absent in files made before this field existed: v1.
  set?: EvalSet;
  // Set by eval:rescore, which replaces the bugs and traps of each case with the current fixture.
  rescoredAt?: string;
  repeat: number;
  cases: EvalCaseInfo[];
  runs: CaseRun[];
};

// spec.md section 1.7: the check state of a candidate from its verdict.
export const checkOf = (verdict: string | null): Check =>
  verdict === "confirmed" ? "checked" : verdict === "unsure" ? "unsure" : "unchecked";

// spec.md section 1.4. check null: prompt version 1 has no verify phase and no volume, so the app shows every finding.
export function displayGroup(i: { verdict: string | null; check: Check | null; severity: Severity }, volume: Volume | null): Group {
  if (i.verdict === "refuted" || i.verdict === "duplicate") return "hidden";
  if (i.check === null) return "main";
  const v = volume ?? "balanced";
  if (v === "thorough") return "main";
  if (v === "quiet") return i.check !== "unsure" && RANK[i.severity] >= RANK.major ? "main" : "fold";
  return i.check !== "unsure" && i.severity !== "nit" ? "main" : "fold";
}

// Both ends inclusive (spec.md section 4.3).
export const overlaps = (a: [number, number], b: [number, number]) => a[0] <= b[1] && b[0] <= a[1];
type Spot = { path: string; side: Side; lines: [number, number] };
// An item on the main place or on any alt place of a bug or trap matches it.
const matches = (i: EvalItem, r: Spot & { alt?: Spot[] }) =>
  [r, ...(r.alt ?? [])].some((p) => i.path === p.path && i.side === p.side && overlaps([i.line, i.lineEnd], p.lines));

export const METRICS = [
  "recall",
  "precision",
  "trapRate",
  "noise",
  "falsePositives",
  "severityOk",
  "candidateRecall",
  "minutes",
  "costUsd",
  "notCompleted",
] as const;
export type Metric = (typeof METRICS)[number];
export type Stat = { mean: number; min: number; max: number } | null;
export type Score = { suite: Record<Metric, Stat>; cases: Record<string, Record<Metric, Stat>> };

// The counts of one run of one case.
type Tally = {
  bugs: number;
  found: number;
  shown: number;
  shownMatched: number;
  traps: number;
  trapHits: number;
  noise: number;
  severityOk: number;
  candidates: number;
  minutes: number | null;
  costUsd: number | null;
  notCompleted: number;
};

function tally(c: EvalCaseInfo, r: CaseRun): Tally {
  const shown = r.items.filter((i) => i.group === "main");
  const found = c.bugs.filter((b) => shown.some((i) => matches(i, b)));
  let severityOk = 0;
  for (const b of found) {
    const best = Math.max(...shown.filter((i) => matches(i, b)).map((i) => RANK[i.severity]));
    if (best >= RANK[b.severityMin]) severityOk++;
  }
  const bugHit = (i: EvalItem) => c.bugs.some((b) => matches(i, b));
  const trapHit = (i: EvalItem) => c.traps.some((t) => matches(i, t));
  return {
    bugs: c.bugs.length,
    found: found.length,
    shown: shown.length,
    shownMatched: shown.filter(bugHit).length,
    traps: c.traps.length,
    trapHits: shown.filter((i) => !bugHit(i) && trapHit(i)).length,
    noise: shown.filter((i) => !bugHit(i) && !trapHit(i)).length,
    severityOk,
    candidates: c.bugs.filter((b) => r.items.some((i) => matches(i, b))).length,
    minutes: r.minutes,
    costUsd: r.usage ? r.usage.costUsd : null,
    notCompleted: r.status === "completed" ? 0 : 1,
  };
}

const ratio = (a: number, b: number) => (b === 0 ? null : a / b);
const sum = (ts: Tally[], k: keyof Tally) => ts.reduce((s, t) => s + (t[k] ?? 0), 0);
// null when no run reports the value.
const meanOf = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

// The metrics of a set of case runs, pooled: recall is all found bugs over all bugs, noise and time are per case run.
function metrics(ts: Tally[]): Record<Metric, number | null> {
  return {
    recall: ratio(sum(ts, "found"), sum(ts, "bugs")),
    precision: ratio(sum(ts, "shownMatched"), sum(ts, "shown")),
    trapRate: ratio(sum(ts, "trapHits"), sum(ts, "traps")),
    noise: ratio(sum(ts, "noise"), ts.length),
    falsePositives: ratio(sum(ts, "shown") - sum(ts, "shownMatched"), ts.length),
    severityOk: ratio(sum(ts, "severityOk"), sum(ts, "found")),
    candidateRecall: ratio(sum(ts, "candidates"), sum(ts, "bugs")),
    minutes: meanOf(ts.map((t) => t.minutes)),
    costUsd: meanOf(ts.map((t) => t.costUsd)),
    notCompleted: sum(ts, "notCompleted"),
  };
}

// The mean, min, and max over repeats. A repeat with no value for the metric does not count.
function stats(perRepeat: Record<Metric, number | null>[]): Record<Metric, Stat> {
  const out = {} as Record<Metric, Stat>;
  for (const m of METRICS) {
    const v = perRepeat.map((r) => r[m]).filter((x): x is number => x !== null);
    out[m] = v.length ? { mean: v.reduce((s, x) => s + x, 0) / v.length, min: Math.min(...v), max: Math.max(...v) } : null;
  }
  return out;
}

export function score(r: EvalResult): Score {
  const byId = new Map(r.cases.map((c) => [c.id, c]));
  const runs = r.runs.flatMap((x) => {
    const c = byId.get(x.case);
    return c ? [{ repeat: x.repeat, case: c.id, t: tally(c, x) }] : [];
  });
  const repeats = [...new Set(runs.map((x) => x.repeat))].sort((a, b) => a - b);
  const suite = stats(repeats.map((n) => metrics(runs.filter((x) => x.repeat === n).map((x) => x.t))));
  const cases: Record<string, Record<Metric, Stat>> = {};
  for (const c of r.cases) {
    const mine = runs.filter((x) => x.case === c.id);
    if (mine.length) cases[c.id] = stats(mine.map((x) => metrics([x.t])));
  }
  return { suite, cases };
}
