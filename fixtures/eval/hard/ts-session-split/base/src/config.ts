export type Config = {
  port: number;
  // The first key signs new tokens. All keys verify tokens, so a retired key keeps working until its sessions end.
  sessionKeys: Buffer[];
  secureCookies: boolean;
  cookieDomain?: string;
  databaseUrl: string;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const keys = (env.SESSION_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => Buffer.from(k, "base64"));
  if (keys.length === 0 || keys.some((k) => k.length < 32)) throw new Error("SESSION_KEYS needs one or more base64 keys of 32 bytes or more");
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  return {
    port: Number(env.PORT ?? 8080),
    sessionKeys: keys,
    secureCookies: env.INSECURE_COOKIES !== "1",
    cookieDomain: env.COOKIE_DOMAIN || undefined,
    databaseUrl: env.DATABASE_URL,
  };
}
