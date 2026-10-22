import type { SettingsRows } from "./db";
import type { Route } from "./http";
import { routes } from "./routes";

// The server package calls this once at startup.
export function createApp(rows: SettingsRows): Route[] {
  return routes(rows);
}
