import { csrfToken, issueToken, remainingMs, type SessionStore, sessionCookie } from "../auth/sessions";
import type { Config } from "../config";
import type { UserRepo } from "../users/repo";
import { type Handler, json } from "./server";

// GET /account/sessions. Runs behind requireSession().
export function listSessions(store: SessionStore): Handler {
  return async (req) => {
    const me = req.session;
    if (!me) return json(401, { error: "Log in first." });
    const now = Date.now();
    return json(200, {
      current: me.id.slice(0, 8),
      sessions: store.listForUser(me.userId).map((s) => ({
        id: s.id.slice(0, 8),
        userAgent: s.userAgent,
        ipPrefix: s.ipPrefix,
        lastSeenAt: new Date(s.lastSeenAt).toISOString(),
        endsInSeconds: Math.round(remainingMs(s, now) / 1000),
      })),
    });
  };
}

type PasswordBody = { current?: unknown; next?: unknown };

// POST /account/password. Ends every other session of the user and gives the current session a new ID.
export function changePassword(store: SessionStore, users: UserRepo, config: Config): Handler {
  return async (req) => {
    const me = req.session;
    if (!me) return json(401, { error: "Log in first." });
    const body = (req.body ?? {}) as PasswordBody;
    if (typeof body.current !== "string" || typeof body.next !== "string" || body.next.length < 12)
      return json(400, { error: "Give the current password and a new one of 12 characters or more." });
    const ok = await users.changePassword(me.userId, body.current, body.next);
    if (!ok) return json(403, { error: "The current password is wrong." });
    store.revokeUser(me.userId, "password-change", me.id);
    const next = store.rotate(me.id);
    if (!next) return json(401, { error: "Your session ended. Log in again." });
    const token = issueToken(next.id, config.sessionKeys[0] as Buffer);
    const cookie = sessionCookie(token, next, { secure: config.secureCookies, domain: config.cookieDomain }, Date.now());
    return json(200, { csrf: csrfToken(next) }, { "set-cookie": cookie });
  };
}
