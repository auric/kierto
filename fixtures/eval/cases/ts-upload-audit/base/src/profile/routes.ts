import type { AuditLog } from "../audit";
import type { Request, Response } from "../http";
import { readJson } from "../json";

export type ProfileStore = {
  setDisplayName(userId: string, name: string): Promise<void>;
};

export function profileRoutes(store: ProfileStore, audit: AuditLog) {
  return {
    // PUT /me/name with {"name": "..."}
    async rename(req: Request): Promise<Response> {
      if (!req.user) return { status: 401 };
      const body = await readJson(req.body, 4096);
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (name.length < 1 || name.length > 80) return { status: 400, body: { error: "The name must have 1 to 80 characters." } };
      await store.setDisplayName(req.user.id, name);
      await audit.record({ actor: req.user.id, action: "profile.rename", target: req.user.id, at: new Date() });
      return { status: 204 };
    },
  };
}
