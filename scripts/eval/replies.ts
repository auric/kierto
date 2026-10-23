// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The reply eval (docs/plans/review-v2/spec.md section 2.13): `bun run eval -- --replies --real` runs one reply run per case of
// fixtures/eval/replies on a temp repository and a temp database, and scores judgement, action, and cites only. Nothing posts, and
// no run reaches Bitbucket: the settings hold no token, so the PR context reads no build and no other PR.
// Exit codes: 0 done, 1 a failed CLI check or a harness error, 2 a usage error or no --real.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import { writeConfig } from "../../src/server/config";
import { createLive } from "../../src/server/live";
import { profileRevision } from "../../src/server/review/catalog";
import { createClaudeRunner } from "../../src/server/review/claude";
import { createReviewJobs, type ReviewJobs } from "../../src/server/review/jobs";
import { createSecrets } from "../../src/server/secrets";
import { createSettings } from "../../src/server/settings";
import { judgements, type ReplyPayload, replyActions } from "../../src/shared/review";
import { stubListTools } from "../../tests/support/review-fixture";
import { buildRepo, INSTRUCTION_FILE } from "./cases";
import { checkoutState, evalProfile, type Options, parseOptions, runSetup, USAGE, WARNING } from "./run";
import { type ReplyEvalResult, type ReplyRun, scoreReplies } from "./score";

export const REPLIES_DIR = resolve(import.meta.dir, "../../fixtures/eval/replies");
const CASE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const BASE_URL = "https://bitbucket.example.invalid";
const PROJECT = "EVAL";
const lineNo = z.number().int().min(1);

// threads: the stored comments of the PR. minutes: the time of a message after the PR start. me: the message is the user's.
// path, line: the place of an inline thread. run: the Threads line of the reply run. expect: what the replies must hold.
export const replyCaseFile = z.object({
  id: z.string().regex(CASE_ID),
  title: z.string().min(1),
  pr: z.object({ title: z.string().min(1), description: z.string() }),
  threads: z
    .array(
      z.object({
        id: lineNo,
        path: z.string().min(1).optional(),
        line: lineNo.optional(),
        messages: z
          .array(
            z.object({
              id: lineNo,
              author: z.string().min(1),
              me: z.boolean().default(false),
              minutes: z.number().int().min(0),
              text: z.string().min(1),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
  run: z.array(lineNo).min(1),
  expect: z
    .array(
      z.object({
        thread: lineNo,
        judgement: z.array(z.enum(judgements)).min(1),
        action: z.enum(replyActions).optional(),
        cites: z.array(lineNo).default([]),
      }),
    )
    .min(1),
});
export type ReplyCase = z.infer<typeof replyCaseFile> & { dir: string; base: Map<string, string> };

const files = (root: string, dir = root): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(root, p) : [relative(root, p).replaceAll("\\", "/")];
  });

export function loadReplyCases(ids: string, root = REPLIES_DIR): ReplyCase[] {
  const all = readdirSync(root)
    .filter((f) => existsSync(join(root, f, "case.json")))
    .sort();
  const want = ids === "all" ? all : ids.split(",").map((s) => s.trim());
  const unknown = want.filter((id) => !all.includes(id));
  if (unknown.length) throw new Error(`Unknown reply case: ${unknown.join(", ")}. Known cases: ${all.join(", ")}.`);
  return want.map((id) => {
    const dir = join(root, id);
    const c = replyCaseFile.parse(JSON.parse(readFileSync(join(dir, "case.json"), "utf8")));
    if (c.id !== id) throw new Error(`Case ${c.id} is in the folder ${id}.`);
    const base = new Map(
      files(join(dir, "base")).map((p) => {
        // Claude Code reads these files as instructions. A reply case has no use for them.
        if (INSTRUCTION_FILE.test(p.split("/").at(-1) ?? "")) throw new Error(`Case ${c.id}: remove ${p}.`);
        return [p, readFileSync(join(dir, "base", p), "utf8")];
      }),
    );
    return { ...c, dir, base };
  });
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const ME = "eval-user";

async function runCase(
  c: ReplyCase,
  repeat: number,
  o: {
    tmp: string;
    runner: string[] | undefined;
    real: boolean;
    profiles: unknown[];
    profile: string;
    keep: boolean;
    onJobs: (j: ReviewJobs | null) => void;
  },
): Promise<ReplyRun> {
  const root = mkdtempSync(join(o.tmp, `${c.id}-${repeat}-`));
  const fail = (error: string): ReplyRun => ({
    case: c.id,
    repeat,
    run: null,
    status: "error",
    error,
    minutes: null,
    usage: null,
    replies: [],
  });
  try {
    mkdirSync(join(root, "remote"));
    const repo = await buildRepo(c, join(root, "remote"));
    const dir = join(root, "data");
    writeConfig(dir, { baseUrl: BASE_URL, userSlug: ME, notifications: false, profiles: o.profiles as never });
    const settings = createSettings({ dir, secrets: createSecrets(null), jiraSecrets: createSecrets(null, "jira-token") });
    const db = settings.db();
    if (!db) return fail("The temp database did not open.");
    const remote = { url: repo.url, sourceUrl: repo.url, sourceRef: "refs/heads/feature", targetRef: "refs/heads/main", fetchConfig: [] };
    const jobs = createReviewJobs({
      settings,
      live: createLive(),
      dataDir: dir,
      runnerCommand: o.runner,
      listTools: o.real ? undefined : stubListTools,
      gitRemote: async () => remote,
    });
    o.onJobs(jobs);
    try {
      const start = Date.UTC(2026, 0, 1);
      const { id: pr } = db
        .query(
          `INSERT INTO pull_request (project, repo, pr_id, title, description, author_slug, author_name, my_role, state, source_head, target_head,
            source_branch, target_branch, updated_date, on_dashboard, followed)
          VALUES ($project, $repo, 1, $title, $description, $me, 'Eval User', 'AUTHOR', 'OPEN', $head, $base, 'feature/eval', 'main', $now, 1, 1)
          RETURNING id`,
        )
        .get({
          project: PROJECT,
          repo: c.id,
          title: c.pr.title,
          description: c.pr.description,
          me: ME,
          head: repo.head,
          base: repo.base,
          now: start,
        }) as {
        id: number;
      };
      const insert = db.query(
        `INSERT INTO comment (pr, comment_id, version, parent_id, root_id, author_slug, author_name, author_login, text, anchor_json, thread_resolved,
          created_at, updated_at) VALUES ($pr, $id, 0, $parent, $root, $slug, $name, $slug, $text, $anchor, 0, $at, $at)`,
      );
      for (const t of c.threads)
        for (const [i, m] of t.messages.entries()) {
          const slug = m.me ? ME : m.author.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          insert.run({
            pr,
            id: m.id,
            parent: i === 0 ? null : (t.messages[i - 1]?.id ?? null),
            root: t.id,
            slug,
            name: m.me ? "Eval User" : m.author,
            text: m.text,
            anchor: i === 0 && t.path ? JSON.stringify({ path: t.path, line: t.line ?? 1, lineType: "ADDED", fileType: "TO" }) : null,
            at: start + m.minutes * 60_000,
          });
        }
      jobs.saveBrief(db, pr, { note: "", profile: o.profile });
      const started = jobs.draftReplies(db, pr, c.run);
      if (started.status !== 202) {
        const why = "error" in started ? started.error : "conflict" in started ? started.conflict.error : `status ${started.status}`;
        return fail(`The run did not start: ${why}`);
      }
      await jobs.wait();
      const d = jobs.run(db, started.run.id);
      if (!d) return fail("The run row is missing.");
      const r = d.run;
      return {
        case: c.id,
        repeat,
        run: r.id,
        status: r.status,
        error: r.errorText,
        minutes: r.finishedAt === null ? null : (r.finishedAt - r.startedAt) / 60_000,
        usage: r.usage,
        replies: d.items
          .filter((i) => i.kind === "reply")
          .map((i) => {
            const p = i.payload as ReplyPayload;
            return { thread: p.thread, judgement: p.judgement ?? null, action: p.action, cites: p.cites ?? [] };
          }),
      };
    } finally {
      o.onJobs(null);
      await jobs.stop();
      settings.close();
    }
  } catch (e) {
    return fail((e as Error).message);
  } finally {
    if (!o.keep) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
}

export async function mainReplies(argv: string[]): Promise<number> {
  const o = parseOptions(argv);
  if ("error" in o) {
    console.error(`${o.error}\n${USAGE}`);
    return 2;
  }
  let cases: ReplyCase[];
  try {
    cases = loadReplyCases(o.cases);
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
    const lines = [`Reply eval plan: ${count(cases.length, "case")}, ${count(o.repeat, "repeat")}, profile ${o.profile}.`];
    for (const c of cases) lines.push(`  ${c.id}: threads ${c.run.join(", ")}`);
    lines.push(runSetup(p.profile), WARNING, "Add --real to run it.");
    console.log(lines.join("\n"));
    return 2;
  }
  return run(o, cases, p);
}

async function run(o: Options, cases: ReplyCase[], p: Exclude<ReturnType<typeof evalProfile>, { error: string }>): Promise<number> {
  // As run.ts: a missed option still lands in the temp folder, never in the user's data folder or secret store.
  const tmp = mkdtempSync(join(tmpdir(), "rl-eval-replies-"));
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
    const checked = await createClaudeRunner({ command: runner }).check();
    if (!checked.ok) {
      console.error(`The Claude CLI check failed: ${checked.message}`);
      return 1;
    }
    const { commit, dirty } = await checkoutState();
    mkdirSync(o.out, { recursive: true });
    const file = join(o.out, `${new Date().toISOString().replace(/[:.]/g, "-")}-${commit}-replies.json`);
    const result: ReplyEvalResult = {
      format: 1,
      kind: "replies",
      createdAt: new Date().toISOString(),
      commit,
      dirty,
      promptVersion: "reply",
      cliVersion: checked.version,
      runner: o.real ? "real" : "fake",
      profile: { ...p.profile, revision: profileRevision(p.profile) },
      requested: { model: p.profile.model ?? "default", effort: p.profile.effort ?? "default" },
      repeat: o.repeat,
      cases: cases.map((c) => ({ id: c.id, title: c.title, threads: c.run, expect: c.expect })),
      runs: [],
    };
    console.log(`Reply eval: ${count(cases.length, "case")} x ${o.repeat}, profile ${o.profile}, CLI ${checked.version}.`);
    console.log(runSetup(p.profile));
    if (o.real) console.log(WARNING);
    const ctx = {
      tmp,
      runner,
      real: o.real,
      profiles: p.list,
      profile: p.profile.id,
      keep: o.keep,
      onJobs: (j: ReviewJobs | null) => {
        jobs = j;
      },
    };
    for (let repeat = 1; repeat <= o.repeat && !stopping; repeat++)
      for (const c of cases) {
        if (stopping) break;
        const r = await runCase(c, repeat, ctx);
        result.runs.push(r);
        writeFileSync(`${file}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
        renameSync(`${file}.tmp`, file);
        const s = scoreReplies({ ...result, runs: [r] })[c.id];
        const got = r.replies
          .map((x) => `thread ${x.thread}: ${x.judgement ?? "none"}, ${x.action}, cites ${x.cites.join(", ") || "none"}`)
          .join("; ");
        console.log(`${c.id} #${repeat}: ${r.status}${s?.pass ? ", pass" : ", fail"}${r.error ? ` (${r.error})` : ""}. ${got}`);
      }
    for (const [id, s] of Object.entries(scoreReplies(result)))
      console.log(
        s
          ? `${id}: ${s.pass * 100}% pass (judgement ${s.judgement * 100}%, action ${s.action * 100}%, cites ${s.cites * 100}%)`
          : `${id}: no run`,
      );
    console.log(`Result: ${file}`);
    return stopping ? 130 : 0;
  } catch (e) {
    console.error(`The reply eval failed: ${(e as Error).stack ?? e}`);
    return 1;
  } finally {
    process.off("SIGINT", onSigint);
    if (!o.keep) rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
    else console.log(`Kept the temp folders in ${tmp}.`);
  }
}
