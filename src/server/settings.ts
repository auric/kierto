import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type ApiError, type SettingsDto, settingsInput } from "../shared/dto";
import { ForgeError } from "./bitbucket/client";
import { createBitbucketProvider, type ForgeProvider } from "./bitbucket/provider";
import { type Config, dataDir, dbPath, readConfig, writeConfig } from "./config";
import { log } from "./log";
import { createSecrets, type Secrets } from "./secrets";
import { openDb } from "./storage/db";

export type SettingsState = { config: Config; db: Database };

const originOf = (url: string) => new URL(url).origin;

// Accepts only an http(s) base URL without credentials, query, or fragment. Returns it without a trailing slash.
function normalize(raw: string): string | null {
  try {
    const u = new URL(raw);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || u.search || u.hash) return null;
    return (u.origin + u.pathname).replace(/\/+$/, "");
  } catch {
    return null;
  }
}

// Construction does no disk or secret-store access. The first request loads the state.
export function createSettings(opts: { dir?: string; secrets?: Secrets } = {}) {
  const dir = opts.dir ?? dataDir();
  const secrets = opts.secrets ?? createSecrets();
  const listeners: ((s: SettingsState) => void)[] = [];
  let loaded = false;
  let config: Config | null = null;
  let db: Database | null = null;

  const current = () => {
    if (!loaded) {
      config = readConfig(dir);
      loaded = true;
    }
    return config;
  };

  const currentDb = () => {
    const c = current();
    if (c && !db) db = openDb(dbPath(dir, c.baseUrl));
    return db;
  };

  async function dto(): Promise<SettingsDto> {
    const c = current();
    return {
      baseUrl: c?.baseUrl ?? null,
      user: c?.userSlug ?? null,
      tokenStored: c !== null && (await secrets.get()) !== null,
      tokenStorage: secrets.storage(),
      caFile: c?.caFile ?? null,
      notifications: c?.notifications ?? false,
    };
  }

  // Each PUT reads the config, awaits Bitbucket, then writes. Overlapping PUTs would pair a config with the wrong database.
  let saving: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = saving.then(fn);
    saving = run.catch(() => {});
    return run;
  };

  const routes = new Hono()
    .get("/", async (c) => c.json(await dto()))
    .put(
      "/",
      validator("json", (v, c) => {
        const r = settingsInput.safeParse(v);
        return r.success ? r.data : c.json<ApiError>({ error: "Invalid settings." }, 400);
      }),
      (c) =>
        serial(async () => {
          const input = c.req.valid("json");
          const bad = (error: string) => c.json<ApiError>({ error }, 400);

          const baseUrl = normalize(input.baseUrl);
          if (!baseUrl) return bad("Give the base URL only, for example https://host or https://host/context.");
          const prev = current();
          const caFile = input.caFile || undefined;
          const notifications = input.notifications ?? prev?.notifications ?? false;
          // Same connection settings: save without a Bitbucket request, so the notifications toggle works offline.
          if (prev && prev.baseUrl === baseUrl && prev.caFile === caFile && !input.token) {
            config = { ...prev, notifications };
            writeConfig(dir, config);
            return c.json(await dto());
          }
          const sameOrigin = prev !== null && originOf(prev.baseUrl) === originOf(baseUrl);
          const token = input.token || (sameOrigin ? await secrets.get() : null);
          if (!token) return bad("Enter the token. A new Bitbucket URL needs a new token.");

          let provider: ForgeProvider;
          try {
            provider = createBitbucketProvider({ baseUrl, token, caFile });
          } catch (e) {
            // createClient throws a plain Error for the URL scheme, and an fs error with a `code` for the CA file.
            return bad((e as { code?: unknown }).code ? "Cannot read the CA file." : (e as Error).message);
          }
          let userSlug: string;
          try {
            userSlug = await provider.currentUser();
          } catch (e) {
            if (!(e instanceof ForgeError)) throw e;
            log(`Settings check failed: ${e.message}`);
            return bad(e.kind === "auth" ? "Bitbucket rejected the token." : `Bitbucket check failed: ${e.message}`);
          }

          if (input.token) await secrets.set(token);
          const next: Config = { baseUrl, userSlug, caFile, notifications };
          writeConfig(dir, next);
          const oldDb = sameOrigin ? null : db;
          config = next;
          if (oldDb) db = null;
          const state = { config: next, db: currentDb() as Database };
          log(`Settings saved for ${originOf(baseUrl)} as ${userSlug}.`);
          for (const fn of listeners) fn(state);
          oldDb?.close();
          return c.json(await dto());
        }),
    );

  return {
    routes,
    config: current,
    // The database of the configured origin, or null before the first valid PUT.
    db: currentDb,
    // A provider for the current settings, or null without config or token. Throws a plain Error for an unreadable CA file.
    async provider(): Promise<ForgeProvider | null> {
      const c = current();
      const token = c && (await secrets.get());
      return c && token ? createBitbucketProvider({ baseUrl: c.baseUrl, token, caFile: c.caFile }) : null;
    },
    // Runs after a successful PUT that changes baseUrl, token, or caFile, after the new config is written and its database is open.
    onSettingsChanged(fn: (s: SettingsState) => void) {
      listeners.push(fn);
    },
  };
}

export type Settings = ReturnType<typeof createSettings>;
