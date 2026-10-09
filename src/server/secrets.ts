import type { TokenStorage } from "../shared/dto";
import { log, redact } from "./log";

// Same service and name as scripts/gate0/set-token.ts.
const KEY = { service: "review-loop", name: "bitbucket-token" };

export type SecretBackend = Pick<typeof Bun.secrets, "get" | "set" | "delete">;

// Bun.secrets on Linux is not verified (U5). Any backend error switches to memory for the rest of the process.
export function createSecrets(backend: SecretBackend | null = process.env.REVIEW_LOOP_SECRETS === "memory" ? null : Bun.secrets) {
  let os = backend;
  let memory: string | null = null;
  const fallback = (e: unknown) => {
    os = null;
    log(`Secret store failed (${(e as Error).name}). The token stays in memory only.`);
  };

  return {
    storage: (): TokenStorage => (os ? "os" : "memory"),
    async get(): Promise<string | null> {
      if (memory === null && os) {
        try {
          memory = await os.get(KEY);
        } catch (e) {
          fallback(e);
        }
      }
      if (memory) redact(memory);
      return memory || null;
    },
    async set(token: string) {
      redact(token);
      memory = token;
      if (!os) return;
      try {
        await os.set({ ...KEY, value: token });
      } catch (e) {
        fallback(e);
      }
    },
  };
}

export type Secrets = ReturnType<typeof createSecrets>;
