// The model and effort that Claude Code uses for a run without --model or --effort.
// Sources: code.claude.com/docs/en/model-config ("Setting your model", "Model aliases", "Adjust effort level"),
// docs/en/settings-reference (effortLevel, modelSettings, maxEffortLevel), docs/en/settings (user scope is ~/.claude/settings.json only).
// The resolver reads only the user settings file. A managed or organization value can override it (integration-check.md B14).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { EFFORTS, type Effort, type RunnerDefaults, type SettingValue } from "../../shared/dto";
import { RUNNER } from "./catalog";
import { claudeConfigDir } from "./skills";

// model-config "Model aliases", Anthropic API column. The app runs only with claude.ai auth. "best" depends on the account, so it has no entry.
const ALIASES: Record<string, string> = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
  fable: "claude-fable-5-1",
};
// model-config "Adjust effort level", item 3: the default effort of each model that supports effort.
const MODEL_EFFORT: Record<string, Effort> = {
  "claude-opus-5-5": "medium",
  "claude-sonnet-5-5": "medium",
  "claude-haiku-5-5": "medium",
  "claude-opus-4-7": "xhigh",
  "claude-fable-5-1": "high",
  "claude-fable-5": "high",
  "claude-opus-5": "high",
  "claude-sonnet-5": "high",
  "claude-opus-4-8": "high",
  "claude-opus-4-6": "high",
  "claude-sonnet-4-6": "high",
};
// settings-reference effortLevel: these models ignore a top-level effortLevel in the user settings file.
const NO_USER_EFFORT = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
// model-config: these models have no xhigh. A higher level runs at the highest supported level below it.
const NO_XHIGH = new Set(["claude-opus-4-6", "claude-sonnet-4-6"]);
// The env block of a settings file can set these. Its precedence over the settings keys is not documented.
const ENV_KEYS = ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_MODEL", "CLAUDE_CODE_EFFORT_LEVEL"] as const;
const FAMILY_ENV = /^ANTHROPIC_DEFAULT_(OPUS|SONNET|HAIKU|FABLE)_MODEL$/;

// Settings files never hold "max" as a level (settings-reference modelSettings).
const level = z.enum(["low", "medium", "high", "xhigh"]).optional().catch(undefined);
const cap = z.enum(EFFORTS).optional().catch(undefined);
const userSettings = z.object({
  model: z.string().optional().catch(undefined),
  effortLevel: level,
  maxEffortLevel: cap,
  modelSettings: z
    .record(z.string(), z.object({ effortLevel: level, maxEffortLevel: cap }).catch({}))
    .optional()
    .catch(undefined),
  env: z.record(z.string(), z.unknown()).optional().catch(undefined),
});
export type UserSettings = z.infer<typeof userSettings>;

// null: the file is absent, unreadable, or not a JSON object.
export function readUserSettings(dir = claudeConfigDir()): UserSettings | null {
  try {
    const r = userSettings.safeParse(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

type Env = Record<string, string | undefined>;
// Windows env names ignore case.
function envGet(env: Env, name: string) {
  if (process.platform !== "win32") return env[name] || undefined;
  for (const [k, v] of Object.entries(env)) if (k.toUpperCase() === name && v) return v;
  return undefined;
}

type Input = { settings: UserSettings; env: Env; sure: boolean };

// The model ID that Claude Code writes as a modelSettings key. null: an unknown alias.
function canonical(model: string, env: Env): string | null {
  const base = model
    .trim()
    .toLowerCase()
    .replace(/\[1m\]$/, "");
  if (base in ALIASES) {
    const pinned = envGet(env, `ANTHROPIC_DEFAULT_${base.toUpperCase()}_MODEL`);
    return pinned ? canonical(pinned, {}) : (ALIASES[base] ?? null);
  }
  if (base === "default" || base === "best" || base === "opusplan" || base === "inherit") return null;
  return base.replace(/-\d{8}$/, "");
}

function defaultModel({ settings, env, sure }: Input): SettingValue | null {
  const fromEnv = envGet(env, "ANTHROPIC_MODEL");
  if (fromEnv) return { value: fromEnv, sure };
  if (settings.model && settings.model !== "default") return { value: settings.model, sure };
  // ANTHROPIC_DEFAULT_MODEL loses to an organization default model. The app cannot see that default.
  const fallback = envGet(env, "ANTHROPIC_DEFAULT_MODEL");
  if (fallback && !["default", "inherit", "opusplan", "haiku"].includes(fallback)) return { value: fallback, sure: false };
  return null;
}

function defaultEffort({ settings, env, sure }: Input, model: string | null): SettingValue | null {
  const forced = envGet(env, "CLAUDE_CODE_EFFORT_LEVEL");
  if (forced && forced !== "auto" && (EFFORTS as readonly string[]).includes(forced)) return { value: forced, sure };
  const id = model ? canonical(model, env) : null;
  if (!id) return null;
  const own = settings.modelSettings?.[id];
  // An unknown model can be newer than Opus 5.5, so the top-level effortLevel applies only to known older models.
  const older = id in MODEL_EFFORT && !NO_USER_EFFORT.has(id);
  const base = own?.effortLevel ?? (older ? settings.effortLevel : undefined) ?? MODEL_EFFORT[id];
  if (!base) return null;
  // settings-reference maxEffortLevel: a modelSettings cap replaces the top-level cap of the same file. "max" sets no cap.
  const limit = own?.maxEffortLevel ?? settings.maxEffortLevel;
  let n = EFFORTS.indexOf(base);
  if (limit) n = Math.min(n, EFFORTS.indexOf(limit));
  if (NO_XHIGH.has(id) && EFFORTS[n] === "xhigh") n--;
  return { value: EFFORTS[n] as Effort, sure: sure && forced !== "auto" };
}

function input(dir: string, env: Env): Input | null {
  const settings = readUserSettings(dir);
  if (!settings) return null;
  // Process env wins over the settings env block here. Claude Code may apply the block over the process env.
  const block: Env = {};
  for (const [k, v] of Object.entries(settings.env ?? {}))
    if (typeof v === "string" && ((ENV_KEYS as readonly string[]).includes(k) || FAMILY_ENV.test(k))) block[k] = v;
  // childEnv removes CLAUDE_CODE_* from the run, so only the settings env block can set CLAUDE_CODE_EFFORT_LEVEL.
  const own: Env = {};
  for (const [k, v] of Object.entries(env)) if (!/^CLAUDE_CODE_/i.test(k)) own[k] = v;
  return { settings, env: { ...block, ...own }, sure: Object.keys(block).length === 0 };
}

// GET /api/meta: the default model, and the default effort per model choice. Key "": no --model.
// models: more model texts, such as the model of each profile. The key is the text as given, so the client finds it.
export function runnerDefaults(dir = claudeConfigDir(), env: Env = process.env, models: readonly string[] = []): RunnerDefaults | null {
  const i = input(dir, env);
  if (!i) return null;
  const model = defaultModel(i);
  const effort: Record<string, SettingValue> = {};
  for (const key of new Set(["", ...RUNNER.models, ...models])) {
    const e = defaultEffort(i, key || (model?.value ?? null));
    if (e) effort[key] = key || model?.sure !== false ? e : { ...e, sure: false };
  }
  return { model, effort };
}

// The effort of a run without --effort. model: the init model, else the --model value, else null. null: unknown or not sure.
export function runEffort(model: string | null, dir = claudeConfigDir(), env: Env = process.env): Effort | null {
  const i = input(dir, env);
  if (!i) return null;
  const m = model ? { value: model, sure: true } : defaultModel(i);
  const e = defaultEffort(i, m?.value ?? null);
  return e?.sure && m?.sure !== false ? (e.value as Effort) : null;
}
