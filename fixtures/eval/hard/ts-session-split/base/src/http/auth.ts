import { CSRF_HEADER, checkCsrf, readSessionCookie, type SessionStore, verifyToken } from "../auth/sessions";
import { type Handler, json } from "./server";

// 32 random bytes and an HMAC-SHA256, each 43 base64url characters without padding. Nothing else reaches verifyToken().
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Resolves the session cookie, records the request on the session, and checks the CSRF header of each unsafe method.
export function requireSession(store: SessionStore, keys: readonly Buffer[], next: Handler): Handler {
  return async (req) => {
    const raw = readSessionCookie(req.headers.cookie);
    if (!raw || !TOKEN_FORMAT.test(raw)) return json(401, { error: "Log in first." });
    const id = verifyToken(raw, keys);
    if (!id) return json(401, { error: "Log in first." });
    const session = store.touch(id);
    if (!session) return json(401, { error: "Your session ended. Log in again." });
    if (!SAFE_METHODS.has(req.method) && !checkCsrf(session, req.headers[CSRF_HEADER]))
      return json(403, { error: "The form is out of date. Reload the page." });
    return next({ ...req, session });
  };
}
