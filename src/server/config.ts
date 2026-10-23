// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
  // Absent: a config from before PROFILES_VERSION. settings.ts upgrades the unedited fields of its shipped profiles.
  profilesVersion: z.number().optional().catch(undefined),
  // Absent: no Jira connection. The Jira token lives in the secret store under "jira-token".
  jira: z.object({ baseUrl: z.string(), caFile: z.string().optional() }).optional().catch(undefined),
  // Absent: off. On: each run reads the global CLAUDE.md of the Claude config folder (src/server/review/instructions.ts).
  globalInstructions: z.boolean().optional().catch(undefined),
  // Absent: off. On: "Ask your session" lists the transcripts of the Claude config folder (src/server/review/sessions.ts).
  sessions: z.boolean().optional().catch(undefined),
  // Absent: on. Off: the user acknowledged the company AI policy for task attachments, so "Include in runs" does not ask.
  askAttachments: z.boolean().optional().catch(undefined),
});

export type Config = z.infer<typeof config>;

// Version 2: the shipped turn caps went from 40 and 12 to 100 and 50.
// Version 3: General and Security got language checks. General and Over-engineering got new prompts.
// Version 4: no shipped value changed. The upgrade goes field by field, so profiles with other edits also get the version 3 values.
// Version 5: review v2 (docs/plans/review-v2/spec.md section 1.2). General became Review with modules, a volume, a verify phase, and
// efforts. Unedited Security and Over-engineering profiles retire.
// Version 6: Explain this PR (spec.md section 3). Explain got the walkthrough prompt, a note, effort medium, and a turn cap of 60.
export const PROFILES_VERSION = 6;

export function dataDir(): string {
  const env = process.env;
  if (env.REVIEW_LOOP_DATA_DIR) return env.REVIEW_LOOP_DATA_DIR;
  if (process.platform === "win32") return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "review-loop");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "review-loop");
  return join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "review-loop");
}

// A copy of config.json before the app drops a part of it. The next save writes the file without that part.
// An older copy with other text stays: the copy goes to the first free name config.json.bak, config.json.1.bak, and so on.
const MAX_BACKUPS = 100;
function backup(dir: string, text: string): string | null {
  for (let i = 0; i < MAX_BACKUPS; i++) {
    const file = join(dir, i ? `config.json.${i}.bak` : "config.json.bak");
    if (!existsSync(file)) {
      writeFileSync(file, text);
      return file;
    }
    if (readFileSync(file, "utf8") === text) return file;
  }
  return null;
}

export function readConfig(dir: string): Config | null {
  let text: string;
  try {
    text = readFileSync(join(dir, "config.json"), "utf8");
  } catch {
    return null;
  }
  const kept = (what: string) => {
    let copy: string | null = null;
    try {
      copy = backup(dir, text);
    } catch (e) {
      log(`Could not copy config.json in ${dir}: ${(e as Error).message}`);
    }
    log(`Ignored ${what} in config.json in ${dir}. ${copy ? `The original file is in ${copy}.` : "No copy was made."}`);
  };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    kept("the whole file: it is not valid JSON");
    return null;
  }
  const r = config.safeParse(raw);
  if (!r.success) {
    kept(`the whole file: ${[...new Set(r.error.issues.map((i) => String(i.path[0] ?? "the top level")))].join(", ")} is invalid`);
    return null;
  }
  // A key with .catch(undefined) reads as absent when its value is invalid.
  const given = raw as Record<string, unknown>;
  const dropped = Object.keys(config.shape).filter((k) => given[k] !== undefined && r.data[k as keyof Config] === undefined);
  if (dropped.length) kept(`the invalid ${dropped.join(", ")}`);
  return r.data;
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
