import { readFile } from "node:fs/promises";
import type { SettingsRows } from "./db";

export type Settings = {
  siteName: string;
  supportEmail: string;
  retryLimit: number;
  timeoutMs: number;
  notifyOnFailure: boolean;
  notifyChannel: "email" | "chat" | "none";
  maxUploadMb: number;
  maxProjects: number;
};

export const DEFAULTS: Settings = {
  siteName: "Build Board",
  supportEmail: "support@example.test",
  retryLimit: 3,
  timeoutMs: 30_000,
  notifyOnFailure: true,
  notifyChannel: "email",
  maxUploadMb: 20,
  maxProjects: 50,
};

// config/overrides.json is optional. A missing file gives no overrides.
async function overrides(path: string): Promise<Partial<Settings>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
  return JSON.parse(text) as Partial<Settings>;
}

export async function loadSettings(rows: SettingsRows, path = "config/overrides.json"): Promise<Settings> {
  const saved = await rows.all();
  return { ...DEFAULTS, ...(await overrides(path)), ...saved.general };
}
