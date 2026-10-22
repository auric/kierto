import type { SessionStore } from "../auth/sessions";

export const SWEEP_INTERVAL_MS = 60_000;

// Ends expired sessions and drops old grace IDs each minute, so the store holds only live sessions.
export function startSweeper(store: SessionStore, log: (message: string) => void): () => void {
  const timer = setInterval(() => {
    const ended = store.sweep();
    if (ended > 0) log(`session sweep: ${ended} ended, ${store.size} live`);
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
