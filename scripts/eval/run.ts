// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The review eval harness (docs/plans/review-v2/spec.md section 4.3). fixtures/eval/README.md gives the commands.
// Each case runs the review pipeline of this checkout: a temp git remote, a temp data folder, a temp database with one PR row, and
// memory secrets. No run reaches Bitbucket or the user's data folder. The real CLI runs only with --real.
// Exit codes: 0 done, 1 a failed CLI check or a harness error, 2 a usage error or no --real.
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { writeConfig } from "../../src/server/config";
import { createLive } from "../../src/server/live";
import { type ListTools, profileOf, profileRevision, SHIPPED_PROFILES } from "../../src/server/review/catalog";
import { createClaudeRunner } from "../../src/server/review/claude";
import { git, gitEnv } from "../../src/server/review/git";
import { saveInstructionSettings } from "../../src/server/review/instructions";
import { createReviewJobs, type ReviewJobs } from "../../src/server/review/jobs";
import type { GitRemote } from "../../src/server/review/workspace";
import { createSecrets } from "../../src/server/secrets";
import { createSettings } from "../../src/server/settings";
import { EFFORTS, type Effort, type IssueContext, modelName, profileList, type RunDetail } from "../../src/shared/dto";
import type { AnchoredFinding } from "../../src/shared/review";
import * as review from "../../src/shared/review";
import { stubListTools } from "../../tests/support/review-fixture";
import { buildRepo, type EvalCase, loadCases } from "./cases";
import { summaryText } from "./compare";
import {
  type CaseRun,
  checkOf,
  displayGroup,
  type EvalCaseInfo,
  type EvalItem,
  type EvalResult,
  type Severity,
  score,
  type Volume,
} from "./score";

const REPO = resolve(import.meta.dir, "../..");
export const WARNING = "Each case runs your Claude CLI and uses your plan quota.";
export const DEFAULT_MODEL_WARNING =
  "No --model or --effort: the runs use the default model and effort of your Claude Code settings. The result depends on them.";
const VOLUMES = ["quiet", "balanced", "thorough"] as const;
const MAX_REPEAT = 10;
// No request goes to this origin: the gitRemote option serves the repository.
const BASE_URL = "https://bitbucket.example.invalid";
const PROJECT = "EVAL";
const TASK_KEY = "EVAL-1";
// prompt version 2 adds REVIEW_PROMPT_VERSION (spec.md section 0). Version 1 has none.
const PROMPT_VERSION = String((review as unknown as Record<string, unknown>).REVIEW_PROMPT_VERSION ?? "1");

const USAGE = `Usage: bun run eval -- [--real] [--cases all|id,id] [--profile general] [--modules security,api] [--volume balanced]
  [--model opus] [--effort ${EFFORTS.join("|")}] [--repeat 2] [--out <folder>] [--keep] [--runner <command> <args...>]
--real runs the claude CLI on PATH. --runner runs the given CLI instead and must come last. Without both, the plan prints and the exit code is 2.`;

export type Options = {
  real: boolean;
  runner: string[] | null;
  cases: string;
  profile: string;
  modules: string[] | null;
  volume: Volume | null;
  // null: no flag, so the CLI default applies.
  model: string | null;
  effort: Effort | null;
  repeat: number;
  out: string;
  keep: boolean;
};

export function parseOptions(argv: string[]): Options | { error: string } {
  const at = argv.indexOf("--runner");
  const runner = at < 0 ? null : argv.slice(at + 1);
  if (runner?.length === 0) return { error: "--runner needs a command." };
  const parse = (args: string[]) =>
    parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        real: { type: "boolean", default: false },
        cases: { type: "string", default: "all" },
        profile: { type: "string", default: "general" },
        modules: { type: "string" },
        volume: { type: "string" },
        model: { type: "string" },
        effort: { type: "string" },
        repeat: { type: "string", default: "1" },
        out: { type: "string" },
        keep: { type: "boolean", default: false },
      },
    });
  let v: ReturnType<typeof parse>["values"];
  try {
    v = parse(at < 0 ? argv : argv.slice(0, at)).values;
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (v.real && runner) return { error: "Pass --real or --runner, not both." };
  const repeat = Number(v.repeat);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > MAX_REPEAT) return { error: `--repeat must be 1 to ${MAX_REPEAT}.` };
  const volume = v.volume ?? null;
  if (volume !== null && !(VOLUMES as readonly string[]).includes(volume))
    return { error: `--volume must be one of ${VOLUMES.join(", ")}.` };
  const model = v.model === undefined ? null : modelName.safeParse(v.model);
  if (model && !model.success) return { error: "--model must be a model alias such as opus, or a full model ID such as claude-opus-5-5." };
  const effort = v.effort ?? null;
  if (effort !== null && !(EFFORTS as readonly string[]).includes(effort))
    return { error: `--effort must be one of ${EFFORTS.join(", ")}.` };
  return {
    real: v.real ?? false,
    runner,
    cases: v.cases ?? "all",
    profile: v.profile ?? "general",
    modules: v.modules === undefined ? null : v.modules.split(",").map((s) => s.trim()),
    volume: volume as Volume | null,
    model: model?.data ?? null,
    effort: effort as Effort | null,
    repeat,
    out: resolve(v.out ?? join(REPO, "eval-results")),
    keep: v.keep ?? false,
  };
}

// The profile of the run with the --modules, --volume, --model, and --effort values. A field that this app version does not know is an error, so a
// result file never names a setup that did not run.
function evalProfile(o: Options) {
  const shipped = SHIPPED_PROFILES.find((p) => p.id === o.profile);
  if (!shipped) return { error: `Unknown profile ${o.profile}. Shipped profiles: ${SHIPPED_PROFILES.map((p) => p.id).join(", ")}.` };
  const extra = {
    ...(o.modules && { modules: o.modules }),
    ...(o.volume && { volume: o.volume }),
    ...(o.model && { model: o.model }),
    ...(o.effort && { effort: o.effort }),
  };
  const list = profileList.safeParse(SHIPPED_PROFILES.map((p) => (p.id === o.profile ? { ...p, ...extra } : p)));
  if (!list.success) return { error: `Invalid profile: ${list.error.issues.map((i) => i.message).join("; ")}` };
  const profile = profileOf(list.data, o.profile);
  const lost = Object.keys(extra).filter((k) => !(k in profile));
  if (lost.length) return { error: `This app version has no profile field ${lost.join(", ")} (prompt version ${PROMPT_VERSION}).` };
  if (profile.explain) return { error: `Profile ${o.profile} gives no findings. Pick a review profile.` };
  return { list: list.data, profile };
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function plan(o: Options, cases: EvalCase[]) {
  const lines = [`Eval plan: ${count(cases.length, "case")}, ${count(o.repeat, "repeat")}, profile ${o.profile}.`];
  const w = Math.max(...cases.map((c) => c.id.length));
  for (const c of cases)
    lines.push(
      `  ${c.id.padEnd(w)}  ${c.language.padEnd(10)}  ${String(c.changedLines).padStart(3)} changed lines  ${count(c.bugs.length, "bug")}  ${count(c.traps.length, "trap")}`,
    );
  if (!o.model && !o.effort) lines.push(DEFAULT_MODEL_WARNING);
  lines.push(WARNING, "Add --real to run it.");
  return lines.join("\n");
}

async function checkoutState() {
  const env = gitEnv("/dev/null");
  try {
    const commit = (await git(["-C", REPO, "rev-parse", "--short=12", "HEAD"], { env })).trim();
    const dirty = (await git(["--no-optional-locks", "-C", REPO, "status", "--porcelain"], { env })).trim() !== "";
    return { commit, dirty };
  } catch {
    return { commit: "unknown", dirty: false };
  }
}

type V2Fields = {
  verify?: { verdict?: string };
  finderSeverity?: Severity;
  title?: string;
  trigger?: string;
  module?: string;
};

function items(d: RunDetail, volume: Volume | null): EvalItem[] {
  return d.items.flatMap((it) => {
    if (it.kind !== "finding") return [];
    const p = it.payload as AnchoredFinding & V2Fields;
    const a = it.anchor ?? { ...p.anchor, side: p.side };
    const verdict = p.verify?.verdict ?? null;
    const check = PROMPT_VERSION === "1" ? null : checkOf(verdict);
    return [
      {
        path: a.path,
        side: a.side,
        line: a.line,
        lineEnd: a.lineEnd,
        anchorState: a.state,
        severity: p.severity,
        finderSeverity: p.finderSeverity ?? p.severity,
        verdict,
        check,
        group: displayGroup({ verdict, check, severity: p.severity }, volume),
        status: it.status,
        title: p.title ?? "",
        body: p.body,
        category: p.category,
        module: p.module ?? null,
        trigger: p.trigger ?? null,
        confidence: p.confidence,
        evidenceStatus: p.evidenceStatus,
        agent: p.agent,
      },
    ];
  });
}

const errorRun = (c: EvalCase, repeat: number, error: string): CaseRun => ({
  case: c.id,
  repeat,
  run: null,
  status: "error",
  errorKind: null,
  error,
  model: null,
  effort: null,
  effortDefault: null,
  models: [],
  startedAt: null,
  finishedAt: null,
  minutes: null,
  usage: null,
  items: [],
  dropped: [],
  questions: 0,
});

type Context = {
  tmp: string;
  runner: string[] | undefined;
  listTools: ListTools | undefined;
  profiles: ReturnType<typeof profileList.parse>;
  profile: string;
  volume: Volume | null;
  keep: boolean;
  onJobs: (j: ReviewJobs | null) => void;
};

async function runCase(c: EvalCase, repeat: number, ctx: Context): Promise<{ run: CaseRun; head: string; base: string }> {
  const root = mkdtempSync(join(ctx.tmp, `${c.id}-${repeat}-`));
  let base = "";
  let head = "";
  try {
    mkdirSync(join(root, "remote"));
    const repo = await buildRepo(c, join(root, "remote"));
    base = repo.base;
    head = repo.head;
    const dir = join(root, "data");
    writeConfig(dir, { baseUrl: BASE_URL, userSlug: "eval-reviewer", notifications: false, profiles: ctx.profiles });
    const settings = createSettings({ dir, secrets: createSecrets(null), jiraSecrets: createSecrets(null, "jira-token") });
    const db = settings.db();
    if (!db) throw new Error("The temp database did not open.");
    const remote: GitRemote = {
      url: repo.url,
      sourceUrl: repo.url,
      sourceRef: "refs/heads/feature",
      targetRef: "refs/heads/main",
      fetchConfig: [],
    };
    const jobs = createReviewJobs({
      settings,
      live: createLive(),
      dataDir: dir,
      runnerCommand: ctx.runner,
      listTools: ctx.listTools,
      gitRemote: async () => remote,
    });
    ctx.onJobs(jobs);
    try {
      const { id: pr } = db
        .query(
          `INSERT INTO pull_request (project, repo, pr_id, title, description, author_slug, author_name, my_role, state, source_head,
            target_head, source_branch, target_branch, web_url, updated_date, on_dashboard, followed)
          VALUES ($project, $repo, 1, $title, $description, 'eval-author', 'Eval Author', 'REVIEWER', 'OPEN', $head, $base, 'feature/eval',
            'main', $web, $now, 1, 1) RETURNING id`,
        )
        .get({
          project: PROJECT,
          repo: c.id,
          title: c.pr.title,
          description: c.pr.description,
          head,
          base,
          web: `${BASE_URL}/projects/${PROJECT}/repos/${c.id}/pull-requests/1`,
          now: Date.now(),
        }) as { id: number };
      if (c.task !== undefined) {
        const issue: IssueContext = {
          key: TASK_KEY,
          summary: c.title,
          status: "In Progress",
          description: c.task,
          comments: [],
          commentsTotal: 0,
          truncated: false,
        };
        db.query("INSERT INTO pr_task (pr, key, source, url, ord) VALUES ($pr, $key, 'branch', NULL, 0)").run({ pr, key: TASK_KEY });
        db.query("INSERT INTO task_context (pr, key, source, json, fetched_at) VALUES ($pr, $key, 'jira', $json, $now)").run({
          pr,
          key: TASK_KEY,
          json: JSON.stringify(issue),
          now: Date.now(),
        });
      }
      if (c.instructions !== undefined)
        saveInstructionSettings(db, { project: PROJECT, repo: c.id }, { target: true, local: [], extra: c.instructions });
      jobs.saveBrief(db, pr, { note: "", profile: ctx.profile });
      const started = jobs.review(db, pr);
      if (started.status !== 202) {
        const why = "error" in started ? started.error : "conflict" in started ? started.conflict.error : `status ${started.status}`;
        return { run: errorRun(c, repeat, `The run did not start: ${why}`), head, base };
      }
      await jobs.wait();
      const d = jobs.run(db, started.run.id);
      if (!d) return { run: errorRun(c, repeat, "The run row is missing."), head, base };
      const r = d.run;
      const volume = (r.summary as unknown as { volume?: Volume } | null)?.volume ?? ctx.volume;
      return {
        run: {
          case: c.id,
          repeat,
          run: r.id,
          status: r.status,
          errorKind: r.errorKind,
          error: r.errorText,
          model: r.model,
          effort: r.effort,
          effortDefault: r.effortDefault,
          models: [...new Set([r.model, ...d.events.map((e) => e.model)].filter((m): m is string => m !== null))],
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          minutes: r.finishedAt === null ? null : (r.finishedAt - r.startedAt) / 60_000,
          usage: r.usage,
          items: items(d, volume),
          dropped: (r.summary?.dropped ?? []).map((x) => ({
            path: x.path,
            side: x.side,
            line: x.line,
            lineEnd: x.lineEnd,
            severity: x.severity,
            reason: x.reason,
          })),
          questions: d.items.filter((i) => i.kind === "question").length,
        },
        head,
        base,
      };
    } finally {
      ctx.onJobs(null);
      await jobs.stop();
      settings.close();
    }
  } catch (e) {
    return { run: errorRun(c, repeat, (e as Error).message), head, base };
  } finally {
    if (!ctx.keep) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
}

function save(file: string, r: EvalResult) {
  writeFileSync(`${file}.tmp`, `${JSON.stringify(r, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

export async function main(argv: string[]): Promise<number> {
  const o = parseOptions(argv);
  if ("error" in o) {
    console.error(`${o.error}\n${USAGE}`);
    return 2;
  }
  let cases: EvalCase[];
  try {
    cases = loadCases(o.cases);
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  const p = evalProfile(o);
  if ("error" in p) {
    console.error(p.error);
    return 2;
  }
  if (!o.real && !o.runner) {
    console.log(plan(o, cases));
    return 2;
  }

  // The run sets these before any app module reads them. A missed option then still lands in the temp folder, never in the
  // user's data folder or secret store.
  const tmp = mkdtempSync(join(tmpdir(), "rl-eval-"));
  process.env.REVIEW_LOOP_DATA_DIR = tmp;
  process.env.REVIEW_LOOP_SECRETS = "memory";
  let jobs: ReviewJobs | null = null;
  let stopping = false;
  const onSigint = () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.error("Stopping after this case. Press Ctrl+C again to quit at once.");
    void jobs?.stop();
  };
  process.on("SIGINT", onSigint);
  try {
    const runner = o.runner ?? undefined;
    // The auth route check of the app: authMethod must be claude.ai (claude.ts).
    const checked = await createClaudeRunner({ command: runner }).check();
    if (!checked.ok) {
      console.error(`The Claude CLI check failed: ${checked.message}`);
      return 1;
    }
    const { commit, dirty } = await checkoutState();
    mkdirSync(o.out, { recursive: true });
    const file = join(o.out, `${new Date().toISOString().replace(/[:.]/g, "-")}-${commit}.json`);
    const profile = p.profile;
    const volume = ((profile as { volume?: Volume }).volume ?? null) as Volume | null;
    const requested = { model: profile.model ?? "default", effort: profile.effort ?? "default" };
    const result: EvalResult = {
      format: 1,
      createdAt: new Date().toISOString(),
      commit,
      dirty,
      promptVersion: PROMPT_VERSION,
      cliVersion: checked.version,
      runner: o.real ? "real" : "fake",
      profile: { ...profile, revision: profileRevision(profile) },
      volume,
      requested,
      repeat: o.repeat,
      cases: [],
      runs: [],
    };
    const info = new Map<string, EvalCaseInfo>();
    const ctx: Context = {
      tmp,
      runner,
      // The fake CLI reaches no documentation server. A real run lists their tools as the app does.
      listTools: o.real ? undefined : stubListTools,
      profiles: p.list,
      profile: profile.id,
      volume,
      keep: o.keep,
      onJobs: (j) => {
        jobs = j;
      },
    };
    console.log(
      `Eval: ${count(cases.length, "case")} x ${o.repeat}, profile ${profile.id}, model ${requested.model}, effort ${requested.effort}, prompt version ${PROMPT_VERSION}, CLI ${checked.version}.`,
    );
    if (!o.model && !o.effort) console.log(DEFAULT_MODEL_WARNING);
    if (o.real) console.log(WARNING);
    const total = cases.length * o.repeat;
    let n = 0;
    for (let repeat = 1; repeat <= o.repeat && !stopping; repeat++)
      for (const c of cases) {
        if (stopping) break;
        n++;
        const { run, head, base } = await runCase(c, repeat, ctx);
        if (!info.has(c.id) && head) {
          info.set(c.id, {
            id: c.id,
            title: c.title,
            language: c.language,
            changedLines: c.changedLines,
            base,
            head,
            bugs: c.bugs,
            traps: c.traps,
          });
          result.cases = [...info.values()];
        }
        result.runs.push(run);
        save(file, result);
        const s = info.has(c.id) ? score({ ...result, runs: [run] }).cases[c.id] : undefined;
        const recall = s?.recall ? `${Math.round(s.recall.mean * c.bugs.length)}/${c.bugs.length} bugs` : "no score";
        const time = run.minutes === null ? "" : `, ${run.minutes.toFixed(1)} min`;
        const shown = run.items.filter((i) => i.group === "main").length;
        console.log(
          `[${n}/${total}] ${c.id} #${repeat}: ${run.status}${time}, ${shown} shown, ${recall}${run.error ? ` (${run.error})` : ""}`,
        );
      }
    console.log(`\n${summaryText(result)}\nResult: ${file}`);
    return stopping ? 130 : 0;
  } catch (e) {
    console.error(`The eval failed: ${(e as Error).stack ?? e}`);
    return 1;
  } finally {
    process.off("SIGINT", onSigint);
    if (!o.keep) rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
    else console.log(`Kept the temp folders in ${tmp}.`);
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
