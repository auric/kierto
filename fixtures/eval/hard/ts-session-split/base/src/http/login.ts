import { csrfToken, issueToken, type SessionStore, sessionCookie } from "../auth/sessions";
import type { Config } from "../config";
import type { UserRepo } from "../users/repo";
import { type Handler, json } from "./server";

type LoginBody = { email?: unknown; password?: unknown };

export function login(store: SessionStore, users: UserRepo, config: Config): Handler {
  return async (req) => {
    const body = (req.body ?? {}) as LoginBody;
    if (typeof body.email !== "string" || typeof body.password !== "string") return json(400, { error: "Give an email and a password." });
    const user = await users.checkPassword(body.email, body.password);
    if (!user) return json(401, { error: "The email or the password is wrong." });
    const session = store.create(user.id, req.headers["user-agent"] ?? "", req.ip);
    const token = issueToken(session.id, config.sessionKeys[0] as Buffer);
    const cookie = sessionCookie(token, session, { secure: config.secureCookies, domain: config.cookieDomain }, Date.now());
    return json(200, { userId: user.id, csrf: csrfToken(session) }, { "set-cookie": cookie });
  };
}
