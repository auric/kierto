import type { UserService } from "../users/service";
import type { UserPatch } from "../users/types";

export type Request = { params: Record<string, string>; body: unknown };
export type Response = { status: number; body: unknown };

const isPatch = (b: unknown): b is UserPatch =>
  typeof b === "object" &&
  b !== null &&
  Object.entries(b).every(([k, v]) => ["name", "email", "teamId"].includes(k) && typeof v === "string");

export function routes(users: UserService) {
  return {
    async getUser(req: Request): Promise<Response> {
      const user = await users.getUser(req.params.id ?? "");
      return user ? { status: 200, body: user } : { status: 404, body: { error: "not found" } };
    },

    async patchUser(req: Request): Promise<Response> {
      if (!isPatch(req.body)) return { status: 400, body: { error: "invalid patch" } };
      const user = await users.updateUser(req.params.id ?? "", req.body);
      return user ? { status: 200, body: user } : { status: 404, body: { error: "not found" } };
    },

    async getTeam(req: Request): Promise<Response> {
      return { status: 200, body: await users.teamOf(req.params.id ?? "") };
    },
  };
}
