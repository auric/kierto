// Autosave for settings sections: one request at a time, and each request sends the newest values.
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Text fields save this long after the last key, or at once when they lose focus.
export const TYPING_MS = 1000;

export type SaverState = { kind: "idle" | "saving" | "saved" } | { kind: "failed"; message: string };

// build: the newest payload, or null when nothing differs from the saved values. put: sends one payload.
// A change during a request waits for it, then the next request sends the values of that moment.
export function createSaver<T>(build: () => T | null, put: (payload: T) => Promise<void>, onState: (s: SaverState) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let again = false;
  // The state at the end of the last run. A run with nothing to send keeps "saved", and it clears a failure.
  let settled: SaverState = { kind: "idle" };
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  function fire(): Promise<void> {
    stop();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      let end: SaverState = settled.kind === "saved" ? settled : { kind: "idle" };
      do {
        again = false;
        const payload = build();
        if (payload === null) continue;
        onState({ kind: "saving" });
        try {
          await put(payload);
          end = { kind: "saved" };
        } catch (e) {
          end = { kind: "failed", message: (e as Error).message };
        }
      } while (again);
      settled = end;
      onState(end);
    })().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    // delay 0: send now. A new request replaces the wait of an earlier one.
    request(delay = 0) {
      stop();
      if (delay > 0) timer = setTimeout(() => void fire(), delay);
      else void fire();
    },
    // Sends a waiting change now. Resolves when no request runs.
    flush(): Promise<void> {
      if (timer) return fire();
      return running ?? Promise.resolve();
    },
    // A change waits, or a request runs.
    busy: () => timer !== null || running !== null,
    // Drops a waiting change. A running request still ends.
    cancel() {
      stop();
      again = false;
    },
  };
}

// The saver of one section. A waiting change goes out when the section unmounts, so closing the settings loses nothing.
export function useSaver<T>(build: () => T | null, put: (payload: T) => Promise<void>) {
  const [state, setState] = useState<SaverState>({ kind: "idle" });
  const fns = useRef({ build, put });
  fns.current = { build, put };
  const [saver] = useState(() =>
    createSaver(
      () => fns.current.build(),
      (p: T) => fns.current.put(p),
      setState,
    ),
  );
  useEffect(
    () => () => {
      void saver.flush();
    },
    [saver],
  );
  return { state, saver };
}

// The live save state of a section. problem: a field with a problem, which stays unsaved until the user fixes it.
export function SaveStatus(props: { id: string; state: SaverState; problem: string | null; saved: string; onRetry: () => void }) {
  const { state } = props;
  const icon = "size-[15px] shrink-0";
  let body: ReactNode = null;
  if (state.kind === "failed")
    body = (
      <>
        <CircleAlert aria-hidden className={cn(icon, "text-destructive")} />
        <span className="text-destructive">Not saved. {state.message}</span>
        <button type="button" className="cursor-pointer rounded font-medium text-pen hover:underline" onClick={props.onRetry}>
          Try again
        </button>
      </>
    );
  else if (state.kind === "saving")
    body = (
      <>
        <LoaderCircle aria-hidden className={cn(icon, "animate-spin")} />
        Saving…
      </>
    );
  else if (props.problem)
    body = (
      <>
        <CircleAlert aria-hidden className={cn(icon, "text-destructive")} />
        <span className="text-destructive">{props.problem}</span>
      </>
    );
  else if (state.kind === "saved")
    body = (
      <>
        <Check aria-hidden className={cn(icon, "text-ok")} />
        {props.saved}
      </>
    );
  return (
    <p id={props.id} role="status" className="m-0 flex min-h-5 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-ink-2">
      {body}
    </p>
  );
}
