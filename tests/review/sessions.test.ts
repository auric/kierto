// Ask your session (docs/plans/session-consult.md part C): the finder on fake transcript folders, the resume command, and the
// session run with the fake CLI, a temp git remote, and a fake Bitbucket. No test reads a real transcript or starts the real CLI.
import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/server/app";
import { writeConfig } from "../../src/server/config";
import { createLive } from "../../src/server/live";
import { createClaudeRunner, resumeArgs } from "../../src/server/review/claude";
import { createConsultRoutes } from "../../src/server/review/consult-routes";
import { createReviewJobs } from "../../src/server/review/jobs";
import { type FindInput, findSessions, HEAD_BYTES, readMeta, TAIL_BYTES } from "../../src/server/review/sessions";
import { createSecrets } from "../../src/server/secrets";
import { createSettings } from "../../src/server/settings";
import {
  type ConsultData,
  type ConsultImportDto,
  consultJsonSchema,
  planAnswer,
  SESSION_MAX_TURNS,
  SESSION_RULES,
  type SessionAnswerDto,
  type SessionListDto,
  sessionTokens,
} from "../../src/shared/consult";
import type { ApiError, RunConflict, RunDetail, RunDto } from "../../src/shared/dto";
import { FAKE_TOKEN, FAKE_USER, startFakeBitbucket } from "../support/fake-bitbucket";
import type { FakeScenario } from "../support/fake-claude";
import { fakeRunner, reviewRemote, stubListTools } from "../support/review-fixture";

process.env.REVIEW_LOOP_SECRETS = "memory";
const SLOW = 120_000;
const PORT = 7317;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SESSION = "s".repeat(64);
const HEADERS = { host: `127.0.0.1:${PORT}`, origin: ORIGIN, "x-rl-session": SESSION, "content-type": "application/json" };
const FIXTURE = join(import.meta.dir, "../../fixtures/claude-synthetic/session-resume.jsonl");
// Message text of the fake transcripts. It must never leave the transcript file.
const CANARY = "TRANSCRIPT-CANARY-5521";
const BRANCH = "feature/lock";

const dirs: string[] = [];
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0)) await f();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});
const fresh = (tag: string) => {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), `rl-sess-${tag}-`)));
  dirs.push(d);
  return d;
};

// ---------- Fake transcripts in the CLI format (docs/plans/session-consult.md section 1) ----------

const L = (o: Record<string, unknown>) => JSON.stringify(o);
const msg = (o: { cwd: string; branch: string; at: string; text?: string; type?: string; extra?: Record<string, unknown> }) =>
  L({
    parentUuid: null,
    isSidechain: false,
    type: o.type ?? "user",
    message: { role: "user", content: o.text ?? CANARY },
    uuid: "00000000-0000-4000-8000-000000000001",
    timestamp: o.at,
    cwd: o.cwd,
    sessionId: "x",
    version: "2.1.301",
    gitBranch: o.branch,
    ...o.extra,
  });
const aiTitle = (t: string) => L({ type: "ai-title", aiTitle: t, sessionId: "x" });
const customTitle = (t: string) => L({ type: "custom-title", customTitle: t, sessionId: "x" });
const continued = (next: string, at: string) => L({ type: "continued-in", timestamp: at, sessionId: "x", continuedInSessionId: next });
const filler = (bytes: number) => {
  const one = L({ type: "attachment", attachment: { text: "x".repeat(900) } });
  return Array.from({ length: Math.ceil(bytes / (one.length + 1)) }, () => one);
};

// Writes <projects>/<folder>/<id>.jsonl. mtime: seconds since the epoch, so the listing order is fixed.
function transcript(projects: string, folder: string, id: string, lines: string[], mtime = 1_700_000_000) {
  mkdirSync(join(projects, folder), { recursive: true });
  const path = join(projects, folder, `${id}.jsonl`);
  writeFileSync(path, `${lines.join("\n")}\n`);
  utimesSync(path, mtime, mtime);
  return path;
}

const input = (projects: string, o: Partial<FindInput> = {}): FindInput => ({
  projectsDir: projects,
  branch: BRANCH,
  clone: null,
  exclude: [],
  ...o,
});

describe("findSessions", () => {
  test("matches the branch in the head or the tail, ranks the clone first, then newest first, with metadata only", async () => {
    const root = fresh("find");
    const projects = join(root, "projects");
    const clone = join(root, "clone");
    const other = join(root, "work", "other-repo");
    transcript(projects, "a", "s-new", [msg({ cwd: other, branch: BRANCH, at: "2026-10-10T10:00:00.000Z" }), aiTitle("Lock the cache")]);
    const inClone = transcript(projects, "b", "s-clone", [
      msg({ cwd: join(clone, "sub"), branch: BRANCH, at: "2026-10-01T10:00:00.000Z" }),
      aiTitle("Generated"),
      customTitle("Renamed by me"),
      aiTitle("Generated later"),
    ]);
    transcript(projects, "a", "s-main", [msg({ cwd: other, branch: "main", at: "2026-10-12T10:00:00.000Z" })]);
    // A session that switched to the branch near its end.
    transcript(projects, "c", "s-switch", [
      msg({ cwd: other, branch: "main", at: "2026-10-05T10:00:00.000Z" }),
      msg({ cwd: other, branch: BRANCH, at: "2026-10-06T10:00:00.000Z" }),
    ]);
    const found = await findSessions(input(projects, { clone }));
    expect(found.map((s) => s.id)).toEqual(["s-clone", "s-new", "s-switch"]);
    const first = found[0];
    expect(first).toEqual({
      id: "s-clone",
      path: inClone,
      title: "Renamed by me",
      bytes: statSync(inClone).size,
      lastAt: Date.parse("2026-10-01T10:00:00.000Z"),
      folder: "sub",
      cwd: join(clone, "sub"),
      branch: BRANCH,
      inClone: true,
    });
    expect(found[1]).toMatchObject({ title: "Lock the cache", folder: "other-repo", inClone: false });
    expect(found[2]?.lastAt).toBe(Date.parse("2026-10-06T10:00:00.000Z"));
    expect(JSON.stringify(found)).not.toContain(CANARY);
    // Without a clone, the order is newest first.
    expect((await findSessions(input(projects))).map((s) => s.id)).toEqual(["s-new", "s-switch", "s-clone"]);
  });

  test("bad lines, nested keys, escaped text, bad names, other files, and subagent folders do not count", async () => {
    const root = fresh("bad");
    const projects = join(root, "projects");
    const cwd = join(root, "w");
    transcript(projects, "a", "nested", [
      "{not json",
      "",
      // The branch only in a nested object, and the key text only inside a message string.
      msg({ cwd, branch: "main", at: "2026-10-01T00:00:00.000Z", extra: { toolUseResult: { gitBranch: BRANCH } } }),
      msg({ cwd, branch: "main", at: "2026-10-01T00:00:01.000Z", text: `"gitBranch":"${BRANCH}"` }),
      L({ type: "assistant", message: { type: "ai-title", aiTitle: "nested title" }, gitBranch: "main", cwd }),
    ]);
    transcript(projects, "a", "titled", [
      "\u0000\u0001 garbage",
      msg({ cwd, branch: BRANCH, at: "2026-10-02T00:00:00.000Z" }),
      L({ type: "assistant", message: { type: "custom-title", customTitle: "nested title" } }),
      L({ type: "ai-title", aiTitle: "  Line one\nline two  " }),
    ]);
    transcript(projects, "a", "bad name", [msg({ cwd, branch: BRANCH, at: "2026-10-03T00:00:00.000Z" })]);
    mkdirSync(join(projects, "a", "titled", "subagents"), { recursive: true });
    writeFileSync(
      join(projects, "a", "titled", "subagents", "agent-1.jsonl"),
      msg({ cwd, branch: BRANCH, at: "2026-10-04T00:00:00.000Z" }),
    );
    writeFileSync(join(projects, "a", "notes.txt"), msg({ cwd, branch: BRANCH, at: "2026-10-04T00:00:00.000Z" }));
    writeFileSync(join(projects, "stray.jsonl"), msg({ cwd, branch: BRANCH, at: "2026-10-04T00:00:00.000Z" }));
    const found = await findSessions(input(projects));
    expect(found.map((s) => [s.id, s.title])).toEqual([["titled", "Line one line two"]]);
    // No projects folder at all.
    expect(await findSessions(input(join(root, "absent")))).toEqual([]);
  });

  test("byte caps: only the head and the tail count, and a cut line at a cap edge is dropped", async () => {
    const root = fresh("caps");
    const projects = join(root, "projects");
    const cwd = join(root, "w");
    const big = (id: string, middle: string[], tail: string[], mtime: number) =>
      transcript(
        projects,
        "big",
        id,
        [
          msg({ cwd, branch: "main", at: "2026-10-01T00:00:00.000Z" }),
          ...filler(HEAD_BYTES * 2),
          ...middle,
          ...filler(TAIL_BYTES * 2),
          ...tail,
        ],
        mtime,
      );
    // The only branch line and the only title sit in the middle, outside both caps.
    big("middle", [msg({ cwd, branch: BRANCH, at: "2026-10-02T00:00:00.000Z" }), customTitle("middle title")], [], 1_700_000_001);
    const tailFile = big("tail", [], [msg({ cwd, branch: BRANCH, at: "2026-10-03T00:00:00.000Z" }), aiTitle("tail title")], 1_700_000_002);
    expect(statSync(tailFile).size).toBeGreaterThan(HEAD_BYTES + TAIL_BYTES);
    const found = await findSessions(input(projects));
    expect(found.map((s) => [s.id, s.title])).toEqual([["tail", "tail title"]]);
    // Small caps: the tail starts inside a long line, so that line does not count.
    const lines = [
      msg({ cwd, branch: "main", at: "2026-10-01T00:00:00.000Z" }),
      msg({ cwd, branch: BRANCH, at: "2026-10-02T00:00:00.000Z", text: "y".repeat(400) }),
    ];
    const path = transcript(projects, "small", "cut", [
      ...lines,
      ...filler(4000),
      msg({ cwd, branch: BRANCH, at: "2026-10-05T00:00:00.000Z", text: "z".repeat(3000) }),
    ]);
    const f = { id: "cut", path, bytes: statSync(path).size, mtime: 0 };
    const m = await readMeta(f, BRANCH, { head: 512, tail: 1024 });
    expect(m.matched).toBe(false);
    expect(m.cwd).toBe(cwd);
    expect(m.lastAt).toBe(Date.parse("2026-10-01T00:00:00.000Z"));
    expect((await readMeta(f, BRANCH, { head: 4096, tail: 1024 })).matched).toBe(true);
  });

  test("continued-in: a newer listed target takes the match and the title; a missing or older target keeps the source", async () => {
    const root = fresh("cont");
    const projects = join(root, "projects");
    const cwd = join(root, "w");
    transcript(projects, "a", "part-1", [
      msg({ cwd, branch: BRANCH, at: "2026-10-01T00:00:00.000Z" }),
      aiTitle("First part"),
      continued("part-2", "2026-10-01T00:00:00.000Z"),
    ]);
    transcript(projects, "b", "part-2", [msg({ cwd, branch: "detached", at: "2026-10-02T00:00:00.000Z" })]);
    transcript(projects, "a", "lost", [
      msg({ cwd, branch: BRANCH, at: "2026-10-03T00:00:00.000Z" }),
      continued("gone-forever", "2026-10-03T00:00:00.000Z"),
    ]);
    transcript(projects, "a", "late", [
      msg({ cwd, branch: BRANCH, at: "2026-10-04T00:00:00.000Z" }),
      continued("early", "2026-10-04T00:00:00.000Z"),
    ]);
    transcript(projects, "a", "early", [msg({ cwd, branch: "main", at: "2026-09-01T00:00:00.000Z" })]);
    // A cycle of two keeps the newer member.
    transcript(projects, "c", "loop-a", [
      msg({ cwd, branch: BRANCH, at: "2026-10-05T00:00:00.000Z" }),
      continued("loop-b", "2026-10-05T00:00:00.000Z"),
    ]);
    transcript(projects, "c", "loop-b", [
      msg({ cwd, branch: BRANCH, at: "2026-10-06T00:00:00.000Z" }),
      continued("loop-a", "2026-10-06T00:00:00.000Z"),
    ]);
    const found = await findSessions(input(projects));
    expect(found.map((s) => [s.id, s.title])).toEqual([
      ["loop-b", null],
      ["late", null],
      ["lost", null],
      ["part-2", "First part"],
    ]);
  });

  test("a transcript whose newest folder is an app run folder is left out", async () => {
    const root = fresh("runs");
    const projects = join(root, "projects");
    const runs = join(root, "data", "runs");
    transcript(projects, "a", "fork", [
      msg({ cwd: join(root, "w"), branch: BRANCH, at: "2026-10-01T00:00:00.000Z" }),
      msg({ cwd: join(runs, "7", "work"), branch: BRANCH, at: "2026-10-02T00:00:00.000Z" }),
    ]);
    transcript(projects, "a", "kept", [msg({ cwd: join(root, "w"), branch: BRANCH, at: "2026-10-01T00:00:00.000Z" })]);
    expect((await findSessions(input(projects, { exclude: [runs] }))).map((s) => s.id)).toEqual(["kept"]);
  });
});

// ---------- The resume command ----------

describe("resumeArgs", () => {
  test("forks always, passes the launch flags again, and gives no agent, MCP server, persistence flag, or permission mode", () => {
    const root = fresh("args");
    const session = join(root, "projects", "a", "s1.jsonl");
    const { args, allowed } = resumeArgs({
      cwd: join(root, "work"),
      appDir: join(root, "app"),
      prompt: "p",
      schema: consultJsonSchema(),
      maxTurns: SESSION_MAX_TURNS,
      resume: session,
    });
    const flag = (name: string) => args[args.indexOf(name) + 1];
    expect(args[0]).toBe("-p");
    expect(flag("--resume")).toBe(session);
    expect(args).toContain("--fork-session");
    for (const f of ["--restricted", "--strict-mcp-config", "--verbose"]) expect(args).toContain(f);
    expect(flag("--output-format")).toBe("stream-json");
    expect(flag("--tools")).toBe("Read,Grep,Glob");
    expect(flag("--allowedTools")).toBe("Read,Grep,Glob");
    expect(flag("--json-schema")).toBe(JSON.stringify(consultJsonSchema()));
    expect(flag("--max-turns")).toBe("12");
    expect(JSON.parse(readFileSync(flag("--mcp-config") as string, "utf8"))).toEqual({ mcpServers: {} });
    for (const f of ["--no-session-persistence", "--permission-mode", "--agents", "--agent", "--bare", "--model", "--effort", "--add-dir"])
      expect(args).not.toContain(f);
    expect([...allowed].sort()).toEqual(["Glob", "Grep", "Read", "StructuredOutput"]);
    expect(() => resumeArgs({ cwd: root, appDir: join(root, "app"), prompt: "p", schema: {}, maxTurns: 1, resume: "s1.jsonl" })).toThrow(
      /absolute .jsonl/,
    );
    expect(() =>
      resumeArgs({ cwd: root, appDir: join(root, "app"), prompt: "p", schema: {}, maxTurns: 1, resume: join(root, "s1.txt") }),
    ).toThrow();
  });

  test("the answer schema is an object with the entries of part B", () => {
    const s = consultJsonSchema() as { type: string; required: string[]; properties: { answers: { items: { required: string[] } } } };
    expect(s.type).toBe("object");
    expect(s.required).toEqual(["answers"]);
    expect(s.properties.answers.items.required).toEqual(["id", "verdict", "reason"]);
    expect(sessionTokens(4001)).toBe(1001);
  });

  test(
    "the runner forks through the fake CLI and gets the structured answer",
    async () => {
      const root = fresh("runner");
      const runner = fakeRunner(root);
      runner.write({ fixture: FIXTURE, consult: { answers: [{ id: "T1", verdict: "accept", reason: "r" }] } });
      const session = transcript(join(root, "projects"), "a", "s1", [msg({ cwd: root, branch: BRANCH, at: "2026-10-01T00:00:00.000Z" })]);
      const work = join(root, "work");
      mkdirSync(work);
      const o = await createClaudeRunner({ command: runner.command }).run({
        cwd: work,
        appDir: join(root, "app"),
        prompt: "text",
        schema: consultJsonSchema(),
        maxTurns: 12,
        resume: session,
      });
      expect(o).toMatchObject({ status: "completed", kind: null });
      expect(o.result?.structured_output).toEqual({ answers: [{ id: "T1", verdict: "accept", reason: "r" }] });
      expect(o.events.map((e) => [e.tool, e.target])).toEqual([["Read", "repo/src/cache/flush.ts"]]);
    },
    SLOW,
  );
});

// ---------- Routes and the session run ----------

type Call = { argv: string[]; cwd: string; stdin: string; childPid?: number };
const flagOf = (argv: string[], name: string) => argv[argv.indexOf(name) + 1] as string;

async function waitFor(pred: () => boolean, ms = 30_000) {
  const end = Date.now() + ms;
  while (!pred() && Date.now() < end) await Bun.sleep(25);
  return pred();
}

async function setup(o: { sessions?: boolean; role?: string } = {}) {
  const root = fresh("run");
  const remote = await reviewRemote(root, { 2: "source" });
  const runner = fakeRunner(root);
  const scenario = (s: Omit<FakeScenario, "record" | "auth" | "fixture"> = {}) => runner.write({ fixture: FIXTURE, ...s });
  scenario();
  const fake = startFakeBitbucket();
  cleanup.push(() => fake.stop());
  const config = join(root, "claude-config");
  const projects = join(config, "projects");
  const clone = join(root, "clone");
  mkdirSync(clone);

  const dir = join(root, "data");
  writeConfig(dir, { baseUrl: fake.url, userSlug: FAKE_USER, notifications: false, markAi: false, sessions: o.sessions ?? true });
  const secrets = createSecrets(null);
  await secrets.set(FAKE_TOKEN);
  const settings = createSettings({ dir, secrets });
  const db = settings.db() as Database;
  const live = createLive();
  const review = createReviewJobs({
    settings,
    live,
    dataDir: dir,
    runnerCommand: runner.command,
    gitRemote: remote.gitRemote,
    listTools: stubListTools,
    claudeConfigDir: config,
  });
  const found: FindInput[] = [];
  const spy = async (i: FindInput) => {
    found.push(i);
    return findSessions(i);
  };
  const app = createApp({ port: PORT, token: SESSION, live, settings, review });
  // The same routes with a spy finder, mounted as app.ts mounts them.
  const spied = createConsultRoutes({ review, settings, live, find: spy });
  cleanup.unshift(async () => {
    await review.stop();
    db.close();
  });

  const { id: pr } = db
    .query(
      `INSERT INTO pull_request (project, repo, pr_id, title, description, author_slug, author_name, my_role, state, source_head, target_head,
        source_branch, target_branch, updated_date, on_dashboard, followed)
      VALUES ('PROJ', 'repo', 2, 'Lock each entry', 'd', $me, 'Jordan Doe', $role, 'OPEN', $source, $target, $branch, 'main', 1000, 1, 1)
      RETURNING id`,
    )
    .get({ me: FAKE_USER, role: o.role ?? "AUTHOR", source: remote.source, target: remote.target, branch: BRANCH }) as { id: number };
  db.query(
    `INSERT INTO comment (pr, comment_id, version, root_id, author_slug, author_name, text, thread_resolved, created_at, updated_at)
    VALUES ($pr, 101, 0, 101, 'asmith', 'Alex Smith', 'Release the lock in a finally block.', 0, 1, 1)`,
  ).run({ pr });
  db.query("INSERT INTO repo_clone (project, repo, path, updated_at) VALUES ('PROJ', 'repo', $path, 1)").run({ path: clone });
  const session = transcript(projects, "c-clone", "11111111-2222-4333-8444-555555555555", [
    msg({ cwd: clone, branch: BRANCH, at: "2026-10-01T10:00:00.000Z" }),
    aiTitle("Lock each entry"),
  ]);
  transcript(projects, "c-other", "99999999-2222-4333-8444-555555555555", [
    msg({ cwd: join(root, "x"), branch: "main", at: "2026-10-02T00:00:00.000Z" }),
  ]);

  const call = async <T>(path: string, init: { method?: string; body?: unknown; via?: "spy" } = {}) => {
    const req = new Request(`${ORIGIN}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: HEADERS,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const res = init.via === "spy" ? await spied.request(new Request(req.url.replace("/api", ""), req)) : await app.request(req);
    return { status: res.status, text: await res.clone().text(), body: (await res.json()) as T };
  };
  const finish = async (id: number) => {
    await review.wait();
    return (await call<RunDetail>(`/api/runs/${id}`)).body;
  };
  const record = join(root, "calls.jsonl");
  const runCalls = (): Call[] =>
    existsSync(record)
      ? readFileSync(record, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l) as Call)
          .filter((c) => Array.isArray(c.argv) && c.argv.includes("-p"))
      : [];
  const hung = () =>
    existsSync(record) &&
    readFileSync(record, "utf8")
      .split("\n")
      .some((l) => l.includes("childPid"));
  return { root, db, pr, dir, clone, session, scenario, call, finish, runCalls, hung, found, review };
}

type Start = RunDto & RunConflict & ApiError;

describe("session routes and runs", () => {
  test(
    "opt-in off: the list and the start refuse, and nothing reads the transcript folder",
    async () => {
      const h = await setup({ sessions: false });
      const list = await h.call<ApiError>(`/prs/${h.pr}/consult/sessions`, { via: "spy" });
      expect(list.status).toBe(409);
      expect(list.body.error).toBe("Ask your session is off. Turn it on in Settings, Clones.");
      const start = await h.call<ApiError>(`/prs/${h.pr}/consult/session`, {
        via: "spy",
        body: { session: "11111111-2222-4333-8444-555555555555", groups: ["reviewers"] },
      });
      expect(start.status).toBe(409);
      expect(h.found).toEqual([]);
      expect(h.runCalls()).toEqual([]);
    },
    SLOW,
  );

  test(
    "the list names the branch sessions with no path; the run forks in a snapshot, and its answer goes through the preview and Apply",
    async () => {
      const logs: string[] = [];
      const spyLog = spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
      cleanup.push(() => spyLog.mockRestore());
      const h = await setup();
      const list = await h.call<SessionListDto>(`/prs/${h.pr}/consult/sessions`, { via: "spy" });
      expect(list.status).toBe(200);
      expect(h.found).toEqual([
        { projectsDir: join(h.root, "claude-config", "projects"), branch: BRANCH, clone: h.clone, exclude: [join(h.dir, "runs")] },
      ]);
      const bytes = statSync(h.session).size;
      expect(list.body).toEqual({
        branch: BRANCH,
        clone: true,
        sessions: [
          {
            id: "11111111-2222-4333-8444-555555555555",
            title: "Lock each entry",
            bytes,
            tokens: sessionTokens(bytes),
            lastAt: Date.parse("2026-10-01T10:00:00.000Z"),
            folder: "clone",
            branch: BRANCH,
            inClone: true,
          },
        ],
      });
      expect(list.text).not.toContain(h.session);
      expect(list.text).not.toContain(CANARY);

      expect(
        (await h.call<ApiError>(`/api/prs/${h.pr}/consult/session`, { body: { session: "../etc", groups: ["reviewers"] } })).status,
      ).toBe(400);
      const unknown = await h.call<ApiError>(`/api/prs/${h.pr}/consult/session`, {
        body: { session: "99999999-2222-4333-8444-555555555555", groups: ["reviewers"] },
      });
      expect(unknown.status).toBe(404);
      expect(
        (
          await h.call<ApiError>(`/api/prs/${h.pr}/consult/session`, {
            body: { session: "11111111-2222-4333-8444-555555555555", groups: ["resolved"] },
          })
        ).status,
      ).toBe(400);

      const start = await h.call<Start>(`/api/prs/${h.pr}/consult/session`, {
        body: { session: "11111111-2222-4333-8444-555555555555", groups: ["reviewers", "findings"] },
      });
      expect(start.status).toBe(202);
      expect(start.body).toMatchObject({ kind: "session", status: "running", profile: "" });
      const d = await h.finish(start.body.id);
      expect(d.run).toMatchObject({
        kind: "session",
        status: "completed",
        errorKind: null,
        summary: { summary: "1 answer" },
        consult: {
          session: "11111111-2222-4333-8444-555555555555",
          title: "Lock each entry",
          bytes,
          tokens: sessionTokens(bytes),
          items: 1,
        },
      });
      expect(d.items).toEqual([]);
      expect(d.events.map((e) => e.tool)).toEqual(["Read"]);
      // The run shows in the run list of the PR.
      expect((await h.call<RunDto[]>(`/api/prs/${h.pr}/runs`)).body.map((r) => r.kind)).toContain("session");

      const [c] = h.runCalls() as [Call];
      expect(flagOf(c.argv, "--resume")).toBe(h.session);
      expect(c.argv).toContain("--fork-session");
      expect(c.argv).not.toContain("--no-session-persistence");
      expect(c.cwd.startsWith(join(h.dir, "runs"))).toBe(true);
      expect(c.cwd.startsWith(h.clone)).toBe(false);
      expect(c.stdin).toContain("### T101");
      expect(c.stdin.endsWith(`${SESSION_RULES}\n`)).toBe(true);
      expect(c.stdin).not.toContain(CANARY);
      expect(c.argv.join(" ")).not.toContain("ANTHROPIC");

      const answer = await h.call<SessionAnswerDto>(`/api/prs/${h.pr}/consult/session/${start.body.id}`);
      expect(answer.status).toBe(200);
      expect(answer.body.entries).toEqual([{ id: "T101", verdict: "reject", reason: "Echo: the session rejects T101." }]);
      expect(Object.keys(answer.body.snapshot)).toEqual(["T101"]);
      const consult = (await h.call<ConsultData>(`/api/prs/${h.pr}/consult`)).body;
      const rows = planAnswer(consult.items, answer.body.entries, answer.body.snapshot);
      expect(rows.map((r) => [r.id, r.act])).toEqual([["T101", "reject"]]);
      const applied = await h.call<ConsultImportDto>(`/api/prs/${h.pr}/consult/import`, {
        body: { entries: answer.body.entries, snapshot: answer.body.snapshot },
      });
      expect(applied.status).toBe(200);
      expect(applied.body.drafts).toBe(1);
      expect((await h.call<ApiError>(`/api/prs/${h.pr}/consult/session/999`)).status).toBe(404);

      // No transcript text reaches the database or the log.
      const dump = JSON.stringify([
        h.db.query("SELECT * FROM review_run").all(),
        h.db.query("SELECT * FROM run_event").all(),
        h.db.query("SELECT * FROM review_item").all(),
      ]);
      expect(dump).not.toContain(CANARY);
      expect(dump).not.toContain(h.session);
      expect(logs.join("\n")).not.toContain(CANARY);
    },
    SLOW,
  );

  test(
    "own PRs only; a running session run takes the slot; cancel ends it",
    async () => {
      const other = await setup({ role: "REVIEWER" });
      const refused = await other.call<ApiError>(`/api/prs/${other.pr}/consult/sessions`);
      expect(refused.status).toBe(409);
      expect(refused.body.error).toBe("Ask your session works only on your own pull requests.");

      const h = await setup();
      h.scenario({ hang: true });
      const body = { session: "11111111-2222-4333-8444-555555555555", groups: ["reviewers"] };
      const first = await h.call<Start>(`/api/prs/${h.pr}/consult/session`, { body });
      expect(first.status).toBe(202);
      // The same start returns the running run. A review waits for the slot.
      expect((await h.call<Start>(`/api/prs/${h.pr}/consult/session`, { body })).status).toBe(200);
      const review = await h.call<Start>(`/api/prs/${h.pr}/review`, { body: undefined, method: "POST" });
      expect(review.status).toBe(409);
      expect(review.body.running).toEqual({ run: first.body.id, pr: h.pr });
      expect(await waitFor(h.hung)).toBe(true);
      expect((await h.call(`/api/runs/${first.body.id}/cancel`, { method: "POST" })).status).toBe(202);
      const d = await h.finish(first.body.id);
      expect(d.run).toMatchObject({ kind: "session", status: "cancelled" });
      expect((await h.call<ApiError>(`/api/prs/${h.pr}/consult/session/${first.body.id}`)).status).toBe(404);
    },
    SLOW,
  );
});
