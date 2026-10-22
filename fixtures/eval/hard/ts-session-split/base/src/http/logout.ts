import { clearedCookie, type SessionStore } from "../auth/sessions";
import type { Config } from "../config";
import { type Handler, json } from "./server";

// Runs behind requireSession(), so req.session is set.
export function logout(store: SessionStore, config: Config): Handler {
  return async (req) => {
    if (req.session) store.revoke(req.session.id, "logout");
    return json(204, null, { "set-cookie": clearedCookie({ secure: config.secureCookies, domain: config.cookieDomain }) });
  };
}
