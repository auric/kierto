import { loadSettings } from "../config";
import type { SettingsRows } from "../db";
import type { Request, Response } from "../http";
import { generalSchema, parseBody } from "./schemas";

// v0 is deprecated since 2.0. Clients should move to /v1/settings.
export function getSettingsV0(rows: SettingsRows) {
  return async (_req: Request): Promise<Response> => {
    const s = await loadSettings(rows);
    return { status: 200, body: { site_name: s.siteName, retry_limit: s.retryLimit, timeout: s.timeoutMs / 1000 } };
  };
}

export function getSettingsV1(rows: SettingsRows) {
  return async (_req: Request): Promise<Response> => {
    const s = await loadSettings(rows);
    return {
      status: 200,
      body: {
        siteName: s.siteName,
        supportEmail: s.supportEmail,
        retryLimit: s.retryLimit,
        timeoutMs: s.timeoutMs,
        notifications: { onFailure: s.notifyOnFailure, channel: s.notifyChannel },
        limits: { maxUploadMb: s.maxUploadMb, maxProjects: s.maxProjects },
      },
    };
  };
}

export function putGeneralV1(rows: SettingsRows) {
  return async (req: Request): Promise<Response> => {
    if (!req.user?.admin) return { status: 403, body: { error: "Only admins can change settings." } };
    const body = parseBody(generalSchema, req.body);
    if (!body.ok) return { status: 400, body: { error: body.error } };
    const saved = await rows.all();
    await rows.save("general", { ...saved.general, ...body.value });
    return { status: 204 };
  };
}
