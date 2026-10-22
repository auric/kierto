export type RetryPolicy = { maxAttempts: number; baseDelayMs: number };

export type Config = {
  databaseUrl: string;
  gatewayUrl: string;
  gatewayKey: string;
  payments: { retry: RetryPolicy };
};

function required(env: Record<string, string | undefined>, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function int(env: Record<string, string | undefined>, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer from ${min} to ${max}, not ${raw}`);
  return n;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    databaseUrl: required(env, "DATABASE_URL"),
    gatewayUrl: required(env, "GATEWAY_URL"),
    gatewayKey: required(env, "GATEWAY_KEY"),
    payments: {
      // All gateway callers share this policy. The ranges keep the longest wait at 2000 ms x 2^3 = 16 s.
      retry: {
        maxAttempts: int(env, "PAYMENT_RETRY_ATTEMPTS", 3, 1, 5),
        baseDelayMs: int(env, "PAYMENT_RETRY_BASE_MS", 200, 50, 2_000),
      },
    },
  };
}
