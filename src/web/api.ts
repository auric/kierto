import { hc } from "hono/client";
import type { AppType } from "../server/app";

// The server writes the session token into the page it serves (BRIEF 3.6).
export const sessionToken = document.querySelector<HTMLMetaElement>('meta[name="rl-session"]')?.content ?? "";

export const api = hc<AppType>("/", { headers: { "X-RL-Session": sessionToken } });
