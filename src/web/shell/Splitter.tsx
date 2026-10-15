// The separator between the list and the detail (plan pr-view-v4 4.3). The keys work only while it has focus.
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { clampList, LIST_MAX, LIST_MIN } from "./layout";

const STEP = 16;
const BIG_STEP = 64;

// width: the current list width in px. onWidth: a new width to keep. onReset: back to the default width.
export function Splitter(props: { width: number; onWidth: (w: number) => void; onReset: () => void }) {
  // A drag sets --list-w on the app element on each move and keeps the width only at the end, so the shell renders once.
  const drag = useRef<{ x: number; w0: number; w: number; app: HTMLElement } | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const [said, setSaid] = useState("");
  const width = live ?? props.width;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const app = e.currentTarget.closest<HTMLElement>(".rl-app");
    if (e.button !== 0 || !app) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w0: props.width, w: props.width, app };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.w = clampList(d.w0 + e.clientX - d.x);
    d.app.style.setProperty("--list-w", `${d.w}px`);
    setLive(d.w);
  };
  const onPointerEnd = () => {
    const d = drag.current;
    drag.current = null;
    setLive(null);
    // A click without a move keeps no width, so the default still follows the sidebar.
    if (d && d.w !== d.w0) props.onWidth(d.w);
  };
  const set = (w: number) => {
    const v = clampList(w);
    props.onWidth(v);
    setSaid(`List width ${v} pixels.`);
  };
  const reset = () => {
    props.onReset();
    setSaid("List width reset.");
  };
  const keys: Record<string, (big: boolean) => void> = {
    ArrowLeft: (big) => set(width - (big ? BIG_STEP : STEP)),
    ArrowRight: (big) => set(width + (big ? BIG_STEP : STEP)),
    Home: () => set(LIST_MIN),
    End: () => set(LIST_MAX),
    Enter: reset,
  };
  // The shell key handler never sees these keys.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const fn = keys[e.key];
    if (!fn || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    fn(e.shiftKey);
  };

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: an <hr> takes no focus and no keys. A focusable separator is a widget. */}
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-controls="rows"
        aria-label="List width. Arrow keys resize. Enter resets."
        aria-valuemin={LIST_MIN}
        aria-valuemax={LIST_MAX}
        aria-valuenow={width}
        title="Drag to resize. Double-click resets."
        className="rl-split"
        data-drag={live === null ? undefined : ""}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDoubleClick={reset}
        onKeyDown={onKeyDown}
      />
      <span role="status" className="sr-only">
        {said}
      </span>
    </>
  );
}
