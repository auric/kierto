import { SessionStore } from "./auth/sessions";
import { loadConfig } from "./config";
import { changePassword, listSessions } from "./http/account";
import { requireSession } from "./http/auth";
import { login } from "./http/login";
import { logout } from "./http/logout";
import type { Handler } from "./http/server";
import { startSweeper } from "./jobs/sweeper";
import { serve } from "./serve";
import { pgUsers } from "./users/pg";

const config = loadConfig();
const store = new SessionStore();
const users = pgUsers(config.databaseUrl);
startSweeper(store, (m) => console.log(m));

const guarded = (h: Handler) => requireSession(store, config.sessionKeys, h);

serve(config.port, {
  "POST /login": login(store, users, config),
  "POST /logout": guarded(logout(store, config)),
  "GET /account/sessions": guarded(listSessions(store)),
  "POST /account/password": guarded(changePassword(store, users, config)),
});
