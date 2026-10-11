import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { MAX_TASK_RULES, taskRuleInput } from "../shared/dto";
import { log } from "./log";

// No secret goes into this file.
const config = z.object({
  baseUrl: z.string(),
  userSlug: z.string(),
  caFile: z.string().optional(),
  notifications: z.boolean(),
  // Absent: on. Posts built from AI items start with AI_MARK (src/server/publish/plan.ts).
  markAi: z.boolean().optional(),
  // Absent: DEFAULT_TASK_RULES (src/server/tasks/rules.ts).
  taskRules: z
    .array(taskRuleInput.extend({ timedOut: z.boolean().optional() }))
    .max(MAX_TASK_RULES)
    .optional(),
  taskLink: z.string().optional(),
});

export type Config = z.infer<typeof config>;

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
  writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

// One database per instance origin, so no table needs an instance column.
export function dbPath(dir: string, baseUrl: string): string {
  const hash = createHash("sha256").update(new URL(baseUrl).origin).digest("hex").slice(0, 16);
  return join(dir, `db-${hash}.sqlite`);
}
