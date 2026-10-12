import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app";
import { dbPath, PROFILES_VERSION, readConfig } from "../src/server/config";
import { createLive } from "../src/server/live";
import { log } from "../src/server/log";
import { type Profile, SHIPPED_PROFILES } from "../src/server/review/catalog";
import { createSecrets, type SecretBackend } from "../src/server/secrets";
import { createSettings, type Settings } from "../src/server/settings";
import type { SettingsDto } from "../src/shared/dto";
import { FAKE_TOKEN, type FakeBitbucket, fixture, key, startFakeBitbucket, TEST_CA_FILE } from "./support/fake-bitbucket";
import { type FakeJira, JIRA_TOKEN, startFakeJira } from "./support/fake-jira";
import { DASHBOARD_PATH } from "./support/scenarios";

const DEFAULT_RULES = (["branch", "title", "description"] as const).map((source) => ({
  source,
  pattern: String.raw`[A-Z][A-Z0-9]+-\d+`,
  timedOut: false,
}));

process.env.REVIEW_LOOP_SECRETS = "memory";
const root = mkdtempSync(join(tmpdir(), "rl-settings-"));
process.env.REVIEW_LOOP_DATA_DIR = root;
afterAll(() => rmSync(root, { recursive: true, force: true }));

const PORT = 7317;
const SESSION = "s".repeat(64);
const ORIGIN = `http://127.0.0.1:${PORT}`;

let fake: FakeBitbucket;
let dir: string;
let n = 0;
beforeEach(() => {
  fake = startFakeBitbucket({ routes: { [key("GET", DASHBOARD_PATH)]: fixture("dashboard-pull-requests-page.json") } });
  dir = join(root, `case-${n++}`);
});
const opened: Settings[] = [];
afterEach(() => {
  fake.stop();
  for (const s of opened.splice(0)) s.close();
});

function setup(backend?: SecretBackend) {
  const settings = createSettings({ dir, secrets: backend ? createSecrets(backend) : undefined });
  opened.push(settings);
  const app = createApp({ port: PORT, token: SESSION, live: createLive(), settings });
  const call = (method: string, body?: unknown) =>
    app.request(`${ORIGIN}/api/settings`, {
      method,
      headers: { host: `127.0.0.1:${PORT}`, origin: ORIGIN, "x-rl-session": SESSION, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    settings,
    get: async () => (await (await call("GET")).json()) as SettingsDto,
    put: (body: unknown) => call("PUT", body),
  };
}

describe("settings API", () => {
  test("GET without config gives the not-configured shape", async () => {
    const s = setup();
    expect(await s.get()).toEqual({
      baseUrl: null,
      user: null,
      tokenStored: false,
      tokenStorage: "memory",
      caFile: null,
      notifications: false,
      markAi: true,
      taskRules: DEFAULT_RULES,
      taskLink: null,
      checkSeconds: 60,
      profiles: SHIPPED_PROFILES,
      jira: { baseUrl: null, caFile: null, tokenStored: false },
    });
    expect(existsSync(dir)).toBe(false);
  });

  test("valid PUT against the fake server stores the settings", async () => {
    const s = setup();
    const changed: string[] = [];
    s.settings.onSettingsChanged((st) => changed.push(st.config.baseUrl));
    const res = await s.put({ baseUrl: `${fake.url}/`, token: FAKE_TOKEN, notifications: true });
    expect(res.status).toBe(200);
    const expected = {
      baseUrl: fake.url,
      user: "jdoe",
      tokenStored: true,
      tokenStorage: "memory" as const,
      caFile: null,
      notifications: true,
      markAi: true,
      taskRules: DEFAULT_RULES,
      taskLink: null,
      checkSeconds: 60,
      profiles: SHIPPED_PROFILES,
      jira: { baseUrl: null, caFile: null, tokenStored: false },
    };
    expect(await res.json()).toEqual(expected);
    expect(await s.get()).toEqual(expected);
    expect(changed).toEqual([fake.url]);
    expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf8"))).toEqual({
      baseUrl: fake.url,
      userSlug: "jdoe",
      notifications: true,
      profilesVersion: PROFILES_VERSION,
    });
    expect(s.settings.db()).not.toBeNull();
    expect(await (await s.settings.provider())?.currentUser()).toBe("jdoe");
  });

  test("same origin without token reuses the stored token", async () => {
    const s = setup();
    expect((await s.put({ baseUrl: fake.url, token: FAKE_TOKEN })).status).toBe(200);
    const before = fake.requests.length;
    expect((await s.put({ baseUrl: fake.url, caFile: TEST_CA_FILE })).status).toBe(200);
    expect(fake.requests.length).toBe(before + 1);
    expect((await s.get()).caFile).toBe(TEST_CA_FILE);
  });

  test("overlapping PUTs run one at a time, so the config and the database stay a pair", async () => {
    const s = setup();
    expect((await s.put({ baseUrl: fake.url, token: FAKE_TOKEN })).status).toBe(200);
    fake.routes[key("GET", DASHBOARD_PATH)] = { ...fixture<object>("dashboard-pull-requests-page.json"), delayMs: 200 };
    const other = startFakeBitbucket({ routes: { [key("GET", DASHBOARD_PATH)]: fixture("dashboard-pull-requests-page.json") } });
    try {
      const toOther = s.put({ baseUrl: other.url, token: FAKE_TOKEN });
      const tokenOnly = s.put({ baseUrl: fake.url, token: FAKE_TOKEN });
      expect((await toOther).status).toBe(200);
      expect((await tokenOnly).status).toBe(200);
    } finally {
      other.stop();
    }
    expect(s.settings.config()?.baseUrl).toBe(fake.url);
    expect(s.settings.db()?.filename).toBe(dbPath(dir, fake.url));
  });

  test("notifications-only PUT saves without a Bitbucket request", async () => {
    const s = setup();
    const changed: boolean[] = [];
    s.settings.onSettingsChanged((st) => changed.push(st.config.notifications));
    expect((await s.put({ baseUrl: fake.url, token: FAKE_TOKEN })).status).toBe(200);
    const before = fake.requests.length;
    fake.stop();
    const res = await s.put({ baseUrl: `${fake.url}/`, notifications: true });
    expect(res.status).toBe(200);
    expect((await res.json()).notifications).toBe(true);
    expect(fake.requests.length).toBe(before);
    expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).notifications).toBe(true);
    expect(changed).toEqual([false]);
  });

  test("markAi saves without a Bitbucket request and persists across a restart", async () => {
    const s = setup();
    expect((await s.put({ baseUrl: fake.url, token: FAKE_TOKEN })).status).toBe(200);
    expect((await s.get()).markAi).toBe(true);
    const before = fake.requests.length;
    const res = await s.put({ baseUrl: fake.url, markAi: false });
    expect(res.status).toBe(200);
    expect((await res.json()).markAi).toBe(false);
    expect(fake.requests.length).toBe(before);
    // A PUT without markAi keeps the stored value.
    expect((await s.put({ baseUrl: fake.url, notifications: true })).status).toBe(200);
    expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).markAi).toBe(false);
    s.settings.close();
    const again = setup();
    expect(await again.get()).toMatchObject({ markAi: false, notifications: true });
    expect(again.settings.config()?.markAi).toBe(false);
  });

  test("GET gives the four shipped profiles with their full prompts", async () => {
    const { profiles } = await setup().get();
    expect(profiles.map((p) => p.id)).toEqual(["general", "over", "security", "explain"]);
    expect(profiles[0]?.prompt).toStartWith("Find defects in the change");
    expect(profiles).toEqual(SHIPPED_PROFILES);
  });

  const custom = {
    id: "perf",
    name: "Performance",
    note: "Hot paths",
    prompt: "Find slow code.",
    explain: false,
    docs: false,
    maxTurns: 20,
    skills: [],
    mcp: [],
  };

  test("saved profiles and checkSeconds persist offline, with no secret in config.json", async () => {
    const s = setup();
    expect((await s.put({ baseUrl: fake.url, token: FAKE_TOKEN })).status).toBe(200);
    const before = fake.requests.length;
    fake.stop();
    const res = await s.put({ baseUrl: fake.url, profiles: [custom], checkSeconds: 300 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ profiles: [custom], checkSeconds: 300 });
    expect(fake.requests.length).toBe(before);
    const text = readFileSync(join(dir, "config.json"), "utf8");
    expect(text).not.toContain(FAKE_TOKEN);
    expect(JSON.parse(text)).toMatchObject({ profiles: [custom], checkSeconds: 300 });
    expect(s.settings.profiles()).toEqual([custom]);
    expect(s.settings.checkMs()).toBe(300_000);
    // A PUT without the fields keeps them.
    expect((await s.put({ baseUrl: fake.url, notifications: true })).status).toBe(200);
    s.settings.close();
    const again = setup();
    expect(await again.get()).toMatchObject({ profiles: [custom], checkSeconds: 300 });
  });

  test("invalid profile lists and intervals give 400 and store nothing", async () => {
    const s = setup();
    expect((await s.put({ baseUrl: fake.url, token: FAKE_TOKEN })).status).toBe(200);
    for (const body of [
      { profiles: [custom, { ...custom, name: "Other" }] },
      { profiles: [{ ...custom, maxTurns: 1 }] },
      { profiles: [] },
      { profiles: [{ ...custom, id: "Bad ID" }] },
      { checkSeconds: 45 },
    ]) {
      const res = await s.put({ baseUrl: fake.url, ...body });
      expect(res.status).toBe(400);
    }
    expect(readConfig(dir)).not.toHaveProperty("profiles");
    expect(readConfig(dir)).not.toHaveProperty("checkSeconds");
  });

  test("profiles null restores the shipped profiles", async () => {
    const s = setup();
    expect((await s.put({ baseUrl: fake.url, token: FAKE_TOKEN, profiles: [custom] })).status).toBe(200);
    expect((await s.get()).profiles).toEqual([custom]);
    const res = await s.put({ baseUrl: fake.url, profiles: null });
    expect(res.status).toBe(200);
    expect((await res.json()).profiles).toEqual(SHIPPED_PROFILES);
    expect(readConfig(dir)).not.toHaveProperty("profiles");
  });

  test("a hand-broken profiles block falls back to the shipped profiles and keeps the rest", async () => {
    const s = setup();
    expect((await s.put({ baseUrl: fake.url, token: FAKE_TOKEN, notifications: true })).status).toBe(200);
    s.settings.close();
    const file = join(dir, "config.json");
    const broken = { ...JSON.parse(readFileSync(file, "utf8")), profiles: [{ id: "x" }], checkSeconds: "fast" };
    writeFileSync(file, JSON.stringify(broken));
    const again = setup();
    expect(await again.get()).toMatchObject({ baseUrl: fake.url, notifications: true, profiles: SHIPPED_PROFILES, checkSeconds: 60 });
  });

  test("an old config gets the new caps on unedited shipped profiles and keeps edited ones", async () => {
    const s = setup();
    expect((await s.put({ baseUrl: fake.url, token: FAKE_TOKEN })).status).toBe(200);
    s.settings.close();
    const file = join(dir, "config.json");
    const [general, over, security, explain] = SHIPPED_PROFILES as [Profile, Profile, Profile, Profile];
    const oldGeneral = { ...general, maxTurns: 40 };
    const editedOver = { ...over, maxTurns: 40, note: "My note" };
    const ownSecurity = { ...security, maxTurns: 30 };
    const oldExplain = { ...explain, maxTurns: 12 };
    const { profilesVersion, ...old } = JSON.parse(readFileSync(file, "utf8"));
    expect(profilesVersion).toBe(PROFILES_VERSION);
    writeFileSync(file, JSON.stringify({ ...old, profiles: [oldGeneral, editedOver, ownSecurity, oldExplain, custom] }));
    const upgraded = [general, editedOver, ownSecurity, explain, custom];
    const again = setup();
    expect((await again.get()).profiles).toEqual(upgraded);
    // A save stamps the version, so a cap of 40 set after the update stays.
    expect((await again.put({ baseUrl: fake.url, notifications: true })).status).toBe(200);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ profiles: upgraded, profilesVersion: PROFILES_VERSION });
    expect((await again.put({ baseUrl: fake.url, profiles: [oldGeneral] })).status).toBe(200);
    again.settings.close();
    expect((await setup().get()).profiles).toEqual([oldGeneral]);
  });

  test("401 gives 400 and stores nothing", async () => {
    const s = setup();
    const res = await s.put({ baseUrl: fake.url, token: "wrong-token" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("rejected");
    expect(existsSync(join(dir, "config.json"))).toBe(false);
    expect((await s.get()).tokenStored).toBe(false);
    expect(await s.settings.provider()).toBeNull();
  });

  test("GET never holds the token", async () => {
    const s = setup();
    const res = await s.put({ baseUrl: fake.url, token: FAKE_TOKEN });
    expect(await res.text()).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(await s.get())).not.toContain(FAKE_TOKEN);
  });

  test("foreign origin without token gives 400", async () => {
    const s = setup();
    expect((await s.put({ baseUrl: fake.url, token: FAKE_TOKEN })).status).toBe(200);
    const before = fake.requests.length;
    // Same server, other origin.
    const res = await s.put({ baseUrl: fake.url.replace("127.0.0.1", "localhost") });
    expect(res.status).toBe(400);
    expect(fake.requests.length).toBe(before);
    expect((await s.get()).baseUrl).toBe(fake.url);
  });

  test("plain http to a non-loopback host gives 400", async () => {
    const s = setup();
    const res = await s.put({ baseUrl: "http://bitbucket.invalid", token: FAKE_TOKEN });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("https");
    expect(existsSync(join(dir, "config.json"))).toBe(false);
  });

  test("missing CA file gives 400", async () => {
    const s = setup();
    const res = await s.put({ baseUrl: fake.url, token: FAKE_TOKEN, caFile: join(root, "missing-ca.pem") });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("CA file");
    expect(fake.requests.length).toBe(0);
  });

  test("bad JSON body and URL with extra parts give 400", async () => {
    const s = setup();
    expect((await s.put({ baseUrl: 5 })).status).toBe(400);
    expect((await s.put({ baseUrl: `${fake.url}/?x=1`, token: FAKE_TOKEN })).status).toBe(400);
    expect((await s.put({ baseUrl: "ftp://host", token: FAKE_TOKEN })).status).toBe(400);
  });

  test("a throwing secrets backend reports memory", async () => {
    const fail = () => Promise.reject(new Error("no keyring"));
    const s = setup({ get: fail, set: fail, delete: fail });
    expect((await s.get()).tokenStorage).toBe("os");
    expect((await s.put({ baseUrl: fake.url, token: FAKE_TOKEN })).status).toBe(200);
    const got = await s.get();
    expect(got.tokenStorage).toBe("memory");
    expect(got.tokenStored).toBe(true);
  });
});

test("after a PUT the token is absent from the data dir and the log", async () => {
  const lines: string[] = [];
  const capture = (...a: unknown[]) => {
    lines.push(a.map(String).join(" "));
  };
  const spies = [spyOn(console, "log").mockImplementation(capture), spyOn(console, "error").mockImplementation(capture)];
  try {
    const s = setup();
    expect((await s.put({ baseUrl: fake.url, token: "wrong-token" })).status).toBe(400);
    expect((await s.put({ baseUrl: fake.url, token: FAKE_TOKEN })).status).toBe(200);
    log(`token is ${FAKE_TOKEN}`);
    s.settings.db()?.run("INSERT INTO sync_checkpoint (scope, updated_at) VALUES ('dashboard', 0)");
    const files = readdirSync(dir);
    expect(files).toContain("config.json");
    expect(files.some((f) => f.endsWith(".sqlite"))).toBe(true);
    for (const f of files) expect(readFileSync(join(dir, f)).includes(FAKE_TOKEN)).toBe(false);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain(FAKE_TOKEN);
    expect(lines).toContain("token is [redacted]");
  } finally {
    for (const s of spies) s.mockRestore();
  }
});

describe("Jira settings (plan r2 S-JIRA)", () => {
  let jira: FakeJira;
  beforeEach(() => {
    jira = startFakeJira();
  });
  afterEach(() => jira.stop());

  function jiraSetup(backend?: SecretBackend) {
    const settings = createSettings({ dir, secrets: createSecrets(null), jiraSecrets: createSecrets(backend ?? null, "jira-token") });
    opened.push(settings);
    const app = createApp({ port: PORT, token: SESSION, live: createLive(), settings });
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await app.request(`${ORIGIN}/api/settings${path}`, {
        method,
        headers: { host: `127.0.0.1:${PORT}`, origin: ORIGIN, "x-rl-session": SESSION, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as SettingsDto & { error?: string } };
    };
    const config = () => JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    return { settings, call, config, bitbucket: () => call("PUT", "", { baseUrl: fake.url, token: FAKE_TOKEN }) };
  }

  test("Jira needs the Bitbucket settings first", async () => {
    const s = jiraSetup();
    expect((await s.call("PUT", "/jira", { baseUrl: jira.url, token: JIRA_TOKEN })).status).toBe(409);
    expect(jira.requests).toEqual([]);
  });

  test("a Bitbucket PUT keeps the jira block", async () => {
    const s = jiraSetup();
    await s.bitbucket();
    expect((await s.call("PUT", "/jira", { baseUrl: `${jira.url}/`, token: JIRA_TOKEN })).body.jira).toEqual({
      baseUrl: jira.url,
      caFile: null,
      tokenStored: true,
    });
    expect((await s.call("PUT", "", { baseUrl: fake.url, notifications: true })).status).toBe(200);
    expect((await s.call("PUT", "", { baseUrl: fake.url, token: FAKE_TOKEN, markAi: false })).status).toBe(200);
    expect(s.config().jira).toEqual({ baseUrl: jira.url });
    expect((await s.call("GET", "")).body.jira.tokenStored).toBe(true);
  });

  test("same origin reuses the stored token; a new origin needs one", async () => {
    const s = jiraSetup();
    await s.bitbucket();
    await s.call("PUT", "/jira", { baseUrl: jira.url, token: JIRA_TOKEN });
    const r = await s.call("PUT", "/jira", { baseUrl: `${jira.url}/jira` });
    expect(r.status).toBe(400);
    jira.routes[key("GET", "/jira/rest/api/2/myself")] = { status: 200, body: { name: "jdoe" } };
    expect((await s.call("PUT", "/jira", { baseUrl: `${jira.url}/jira` })).status).toBe(200);
    expect(s.config().jira).toEqual({ baseUrl: `${jira.url}/jira` });
    const other = startFakeJira();
    try {
      expect((await s.call("PUT", "/jira", { baseUrl: other.url })).body.error).toContain("A new Jira URL needs a new token.");
      expect(other.requests).toEqual([]);
    } finally {
      other.stop();
    }
  });

  test("a wrong token, http to a non-loopback host, a redirect, and a missing CA file give 400 and store nothing", async () => {
    const s = jiraSetup();
    await s.bitbucket();
    expect((await s.call("PUT", "/jira", { baseUrl: jira.url, token: "wrong" })).body.error).toBe("Jira rejected the token.");
    expect((await s.call("PUT", "/jira", { baseUrl: "http://jira.example.test", token: JIRA_TOKEN })).body.error).toBe(
      "The Jira URL must use https.",
    );
    expect((await s.call("PUT", "/jira", { baseUrl: jira.url, token: JIRA_TOKEN, caFile: join(dir, "none.pem") })).status).toBe(400);
    jira.routes[key("GET", "/rest/api/2/myself")] = { status: 302, headers: { Location: "https://sso.example.test/" } };
    expect((await s.call("PUT", "/jira", { baseUrl: jira.url, token: JIRA_TOKEN })).body.error).toBe(
      "Jira check failed: redirect 302: /rest/api/2/myself",
    );
    expect(s.config().jira).toBeUndefined();
    expect((await s.call("GET", "")).body.jira).toEqual({ baseUrl: null, caFile: null, tokenStored: false });
  });

  test("an empty baseUrl disconnects Jira and deletes the token from the store", async () => {
    const store = new Map<string, string>();
    const backend: SecretBackend = {
      get: async (o) => store.get(o.name) ?? null,
      set: async (o) => void store.set(o.name, o.value),
      delete: async (o) => store.delete(o.name),
    };
    const s = jiraSetup(backend);
    await s.bitbucket();
    await s.call("PUT", "/jira", { baseUrl: jira.url, token: JIRA_TOKEN });
    expect([...store.entries()]).toEqual([["jira-token", JIRA_TOKEN]]);
    const r = await s.call("PUT", "/jira", { baseUrl: "" });
    expect(r.status).toBe(200);
    expect(r.body.jira).toEqual({ baseUrl: null, caFile: null, tokenStored: false });
    expect(store.size).toBe(0);
    expect(s.config().jira).toBeUndefined();
    expect(s.config().baseUrl).toBe(fake.url);
    expect(await s.settings.jira()).toBeNull();
  });
});
