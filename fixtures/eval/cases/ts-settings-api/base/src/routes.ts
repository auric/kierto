import { getSettingsV0, getSettingsV1, putGeneralV1 } from "./api/settings";
import type { SettingsRows } from "./db";
import type { Route } from "./http";

export function routes(rows: SettingsRows): Route[] {
  return [
    { method: "GET", path: "/v0/settings", handle: getSettingsV0(rows) },
    { method: "GET", path: "/v1/settings", handle: getSettingsV1(rows) },
    { method: "PUT", path: "/v1/settings/general", handle: putGeneralV1(rows) },
  ];
}
