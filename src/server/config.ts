import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { MAX_TASK_RULES, profileList, settingsInput, taskRuleInput } from "../shared/dto";
import { log } from "./log";

// No secret goes into this file.
const config = z.object({
  baseUrl: z.string(),
  userSlug: z.string(),
  caFile: z.string().optional(),
  notifications: z.boolean(),
  // Absent: on. Posts built from AI items start with AI_MARK (src/server/publish/plan.ts).
  markAi: z.boolean().optional(),
  // Absent: on. Posted findings start with their severity in bold (src/server/publish/plan.ts).
  markSeverity: z.boolean().optional(),
  // Absent: DEFAULT_TASK_RULES (src/server/tasks/rules.ts).
  taskRules: z
    .array(taskRuleInput.extend({ timedOut: z.boolean().optional() }))
    .max(MAX_TASK_RULES)
    .optional(),
  taskLink: z.string().optional(),
  // A broken value reads as absent, so the rest of the config stays in use.
  // Absent: 60 s.
  checkSeconds: settingsInput.shape.checkSeconds.catch(undefined),
  // Absent: SHIPPED_PROFILES (src/server/review/catalog.ts).
  profiles: profileList.optional().catch(undefined),
  // Absent: a config from before PROFILES_VERSION. settings.ts upgrades its unedited shipped profiles.
  profilesVersion: z.number().optional().catch(undefined),
  // Absent: no Jira connection. The Jira token lives in the secret store under "jira-token".
  jira: z.object({ baseUrl: z.string(), caFile: z.string().optional() }).optional().catch(undefined),
});

export type Config = z.infer<typeof config>;

// Version 2: the shipped turn caps went from 40 and 12 to 100 and 50.
export const PROFILES_VERSION = 2;

export function dataDir(): string {
  const env = process.env;
  if (env.REVIEW_LOOP_DATA_DIR) return env.REVIEW_LOOP_DATA_DIR;
  if (process.platform === "win32") return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "review-loop");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "review-loop");
  return join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "review-loop");
}

export function readConfig(dir: string): Config | null {
  let text: string;
  try {
    text = readFileSync(join(dir, "config.json"), "utf8");
  } catch {
    return null;
  }
  try {
    return config.parse(JSON.parse(text));
  } catch {
    log(`Ignored an invalid config.json in ${dir}.`);
    return null;
  }
}

export function writeConfig(dir: string, value: Config) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "config.json");
  writeFileSync(`${file}.tmp`, `${JSON.stringify({ ...value, profilesVersion: PROFILES_VERSION }, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

// One database per instance origin, so no table needs an instance column.
export function dbPath(dir: string, baseUrl: string): string {
  const hash = createHash("sha256").update(new URL(baseUrl).origin).digest("hex").slice(0, 16);
  return join(dir, `db-${hash}.sqlite`);
}
