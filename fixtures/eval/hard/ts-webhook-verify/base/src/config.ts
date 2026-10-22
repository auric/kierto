export type Config = {
  port: number;
  databaseUrl: string;
  carrierToken: Buffer;
};

function required(env: Record<string, string | undefined>, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: Number(env.PORT ?? 8080),
    databaseUrl: required(env, "DATABASE_URL"),
    carrierToken: Buffer.from(required(env, "CARRIER_TOKEN"), "utf8"),
  };
}
