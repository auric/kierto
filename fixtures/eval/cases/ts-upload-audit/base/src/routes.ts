import type { AuditLog } from "./audit";
import type { Request, Response } from "./http";
import { type ProfileStore, profileRoutes } from "./profile/routes";

export type Route = {
  method: "GET" | "POST" | "PUT";
  path: string;
  handle: (req: Request) => Promise<Response>;
};

export function routes(deps: { profiles: ProfileStore; audit: AuditLog }): Route[] {
  const profile = profileRoutes(deps.profiles, deps.audit);
  return [{ method: "PUT", path: "/me/name", handle: profile.rename }];
}
