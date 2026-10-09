// A message counts as read when 50% of it is visible in the detail pane and the tab is visible (plan section 2).
import { useCallback, useEffect, useRef } from "react";
import type { CommentDto } from "../../shared/dto";
import { sendRead } from "../shell/data";
import { createAck } from "./ack";

// Returns a ref callback for each unread message element. The element needs data-id.
export function useAck(pr: number, comments: CommentDto[]) {
  const ack = useRef<ReturnType<typeof createAck> | null>(null);
  const io = useRef<IntersectionObserver | null>(null);
  const nodes = useRef(new Set<Element>());

  useEffect(() => {
    const a = createAck((items) => void sendRead(pr, items).catch(() => {}));
    ack.current = a;
    const observer = new IntersectionObserver(
      (entries) => {
        if (document.visibilityState !== "visible") return;
        for (const e of entries) if (e.isIntersecting && e.intersectionRatio >= 0.5) a.seen(Number((e.target as HTMLElement).dataset.id));
      },
      // The detail pane scrolls inside [data-scroll]. Its box is the viewport for the 50% rule.
      { root: document.querySelector("[data-scroll]"), threshold: 0.5 },
    );
    io.current = observer;
    for (const n of nodes.current) observer.observe(n);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") return a.flush();
      // Observing again reports the current intersections.
      for (const n of nodes.current) {
        observer.unobserve(n);
        observer.observe(n);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", a.flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", a.flush);
      observer.disconnect();
      a.flush();
      io.current = null;
      ack.current = null;
    };
  }, [pr]);

  // After each commit, the rendered versions are the versions on screen.
  useEffect(() => {
    ack.current?.setRendered(comments.filter((c) => c.unread));
  }, [comments]);

  return useCallback((el: HTMLElement | null) => {
    if (!el) return;
    nodes.current.add(el);
    io.current?.observe(el);
    return () => {
      nodes.current.delete(el);
      io.current?.unobserve(el);
    };
  }, []);
}
