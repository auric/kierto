// A message counts as read when 50% of it is visible in the detail pane and the tab is visible (plan section 2).
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import type { CommentDto } from "../../shared/dto";
import { isStale, sendRead } from "../shell/data";
import { createAck, isSeen } from "./ack";

// ponytail: 1% steps catch a message up to 50 times the pane height. A taller one needs per-element thresholds.
const THRESHOLDS = Array.from({ length: 101 }, (_, i) => i / 100);

// Observing again reports the current intersections.
function reobserve(observer: IntersectionObserver, nodes: Set<Element>) {
  for (const n of nodes) {
    observer.unobserve(n);
    observer.observe(n);
  }
}

// Returns a ref callback for each unread message element. The element needs data-id.
export function useAck(pr: number, comments: CommentDto[]) {
  const ack = useRef<ReturnType<typeof createAck> | null>(null);
  const io = useRef<IntersectionObserver | null>(null);
  const nodes = useRef(new Set<Element>());
  // A mutation, so a stale session reaches the "service restarted" banner through the mutation cache.
  const read = useMutation({ mutationFn: ({ items }: { items: Parameters<typeof sendRead>[1] }) => sendRead(pr, items) });
  const mutate = useRef(read.mutateAsync);
  mutate.current = read.mutateAsync;

  useEffect(() => {
    const a = createAck((items) => mutate.current({ items }), { fatal: isStale });
    ack.current = a;
    const observer = new IntersectionObserver(
      (entries) => {
        if (document.visibilityState !== "visible") return;
        for (const e of entries) if (isSeen(e)) a.seen(Number((e.target as HTMLElement).dataset.id));
      },
      // The detail pane scrolls inside [data-scroll]. Its box is the viewport for the 50% rule.
      { root: document.querySelector("[data-scroll]"), threshold: THRESHOLDS },
    );
    io.current = observer;
    for (const n of nodes.current) observer.observe(n);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") return a.flush();
      reobserve(observer, nodes.current);
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
    // PrDetail remounts per PR, so one tracker per mount is one per PR.
  }, []);

  // After each commit, the rendered versions are the versions on screen.
  useEffect(() => {
    ack.current?.setRendered(comments.filter((c) => c.unread));
    // A new version keeps the DOM node, so the observer does not report a visible message again.
    if (io.current) reobserve(io.current, nodes.current);
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
