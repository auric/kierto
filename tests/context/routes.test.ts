// Plan r2 S-JIRA: the task context API against the fake Jira. No test calls a real server.
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/server/app";
import { writeConfig } from "../../src/server/config";
import { taskFiles } from "../../src/server/context/task-file";
import { createLive } from "../../src/server/live";
import { createSecrets } from "../../src/server/secrets";
import { createSettings, type Settings } from "../../src/server/settings";
import type { MetaDto, SettingsDto, TaskContextDto } from "../../src/shared/dto";
import { key } from "../support/fake-bitbucket";
import { type FakeJira, ISSUE_KEY, JIRA_TOKEN, startFakeJira } from "../support/fake-jira";

process.env.REVIEW_LOOP_SECRETS = "memory";
const root = mkdtempSync(join(tmpdir(), "rl-context-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const PORT = 7317;
const SESSION = "s".repeat(64);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const HEADERS = { host: `127.0.0.1:${PORT}`, origin: ORIGIN, "x-rl-session": SESSION, "content-type": "application/json" };

let jira: FakeJira;
let dir: string;
let n = 0;
const opened: Settings[] = [];
beforeEach(() => {
  jira = startFakeJira();
  dir = join(root, `case-${n++}`);
});
afterEach(() => {
  jira.stop();
  for (const s of opened.splice(0)) s.close();
});

function setup() {
  writeConfig(dir, { baseUrl: "https://bitbucket.example.test", userSlug: "jdoe", notifications: false });
  const settings = createSettings({ dir, secrets: createSecrets(null), jiraSecrets: createSecrets(null, "jira-token") });
  opened.push(settings);
  const db = settings.db();
  if (!db) throw new Error("no db");
  const pr = (db.query("INSERT INTO pull_request (project, repo, pr_id) VALUES ('PROJ', 'repo', 1) RETURNING id").get() as { id: number })
    .id;
  for (const [i, k] of [ISSUE_KEY, "ABC-404"].entries())
    db.query("INSERT INTO pr_task (pr, key, source, url, ord) VALUES ($pr, $k, 'title', NULL, $i)").run({ pr, k, i });
  const live = createLive();
  const events: unknown[] = [];
  const broadcast = live.broadcast;
  live.broadcast = (event, data) => {
    events.push({ event, data });
    broadcast(event, data);
  };
  const app = createApp({ port: PORT, token: SESSION, live, settings });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(`${ORIGIN}/api${path}`, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
  const connect = () => call("PUT", "/settings/jira", { baseUrl: jira.url, token: JIRA_TOKEN });
  return { settings, db, pr, events, call, connect };
}

describe("task context API", () => {
  test("POST before Jira settings gives 409 and sends no request", async () => {
    const s = setup();
    const res = await s.call("POST", `/prs/${s.pr}/task-context/${ISSUE_KEY}`);
    expect(res.status).toBe(409);
    expect(jira.requests).toEqual([]);
  });

  test("PUT checks the token, saves the URL without the token, and meta lists Jira", async () => {
    const s = setup();
    expect(((await (await s.call("GET", "/meta")).json()) as MetaDto).context).toEqual([{ id: "jira", name: "Jira", configured: false }]);
    const res = await s.connect();
    expect(res.status).toBe(200);
    expect(((await res.json()) as SettingsDto).jira).toEqual({ baseUrl: jira.url, caFile: null, tokenStored: true });
    expect(jira.requests).toEqual(["GET /rest/api/2/myself"]);
    expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).jira).toEqual({ baseUrl: jira.url });
    expect(((await (await s.call("GET", "/meta")).json()) as MetaDto).context).toEqual([{ id: "jira", name: "Jira", configured: true }]);
  });

  test("POST fetches, stores, broadcasts, and the run file holds the issue text", async () => {
    const s = setup();
    await s.connect();
    const res = await s.call("POST", `/prs/${s.pr}/task-context/${ISSUE_KEY}`);
    expect(res.status).toBe(200);
    const dto = (await res.json()) as TaskContextDto;
    expect(dto).toMatchObject({ key: ISSUE_KEY, source: "jira", summary: "Flush the cache before the write lock", commentsTotal: 3 });
    expect(dto.comments.length).toBe(3);
    expect(s.events).toEqual([{ event: "changed", data: { prs: [s.pr] } }]);
    const list = (await (await s.call("GET", `/prs/${s.pr}/task-context`)).json()) as TaskContextDto[];
    expect(list).toEqual([dto]);
    const [file] = taskFiles(s.db, s.pr);
    expect(file?.name).toBe("task.md");
    expect(file?.text).toContain(`## Task ${ISSUE_KEY}: Flush the cache before the write lock`);
    expect(file?.text).toContain("QA: test with an empty cache too.");
  });

  test("bad key 400, key outside the PR 404, unknown PR 404; no Jira request", async () => {
    const s = setup();
    await s.connect();
    const before = jira.requests.length;
    expect((await s.call("POST", `/prs/${s.pr}/task-context/abc-1`)).status).toBe(400);
    expect((await s.call("POST", `/prs/${s.pr}/task-context/XYZ-1`)).status).toBe(404);
    expect((await s.call("POST", `/prs/999/task-context/${ISSUE_KEY}`)).status).toBe(404);
    expect((await s.call("GET", "/prs/999/task-context")).status).toBe(404);
    expect(jira.requests.length).toBe(before);
  });

  test("Jira errors give 502 with fixed texts and store nothing", async () => {
    const s = setup();
    await s.connect();
    const post = async (k = ISSUE_KEY) => {
      const res = await s.call("POST", `/prs/${s.pr}/task-context/${k}`);
      return { status: res.status, error: ((await res.json()) as { error: string }).error };
    };
    expect(await post("ABC-404")).toEqual({ status: 502, error: "Jira has no such issue, or the token may not see it." });
    const issue = `/rest/api/2/issue/${ISSUE_KEY}`;
    jira.routes[key("GET", issue)] = { status: 302, headers: { Location: "https://sso.example.test/login" } };
    expect(await post()).toEqual({ status: 502, error: "Jira answered with a redirect. Check the Jira URL in Settings." });
    jira.routes[key("GET", issue)] = { status: 200, body: { errorMessages: ["BODY-CANARY"] } };
    expect(await post()).toEqual({ status: 502, error: "Jira sent an answer in an unknown format." });
    jira.token = "rotated";
    expect(await post()).toEqual({ status: 502, error: "Jira rejected the token. Check the Jira settings." });
    expect(s.db.query("SELECT COUNT(*) AS n FROM task_context").get()).toEqual({ n: 0 });
    expect(s.events).toEqual([]);
  });

  test("DELETE removes the row and gives 204", async () => {
    const s = setup();
    await s.connect();
    await s.call("POST", `/prs/${s.pr}/task-context/${ISSUE_KEY}`);
    const res = await s.call("DELETE", `/prs/${s.pr}/task-context/${ISSUE_KEY}`);
    expect(res.status).toBe(204);
    expect(await (await s.call("GET", `/prs/${s.pr}/task-context`)).json()).toEqual([]);
    expect((await s.call("DELETE", `/prs/${s.pr}/task-context/${ISSUE_KEY}`)).status).toBe(204);
  });

  test("the Jira token never reaches config.json, the database, a response, or the log", async () => {
    const lines: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      lines.push(a.map(String).join(" "));
    });
    try {
      const s = setup();
      const bodies: string[] = [];
      const wrong = await s.call("PUT", "/settings/jira", { baseUrl: jira.url, token: `${JIRA_TOKEN}-x` });
      expect(wrong.status).toBe(400);
      bodies.push(await wrong.text());
      bodies.push(await (await s.connect()).text());
      bodies.push(await (await s.call("POST", `/prs/${s.pr}/task-context/${ISSUE_KEY}`)).text());
      jira.token = "rotated";
      bodies.push(await (await s.call("POST", `/prs/${s.pr}/task-context/${ISSUE_KEY}`)).text());
      bodies.push(await (await s.call("GET", "/settings")).text());
      for (const b of bodies) expect(b).not.toContain(JIRA_TOKEN);
      s.settings.close();
      for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f)).includes(JIRA_TOKEN)).toBe(false);
      expect(lines.some((l) => l.startsWith("Jira fetch failed: auth 401"))).toBe(true);
      for (const l of lines) expect(l).not.toContain(JIRA_TOKEN);
    } finally {
      spy.mockRestore();
    }
  });
});
