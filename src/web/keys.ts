// Pure key handling for the M1 keys (prototype/index.html keyboard model). The shell performs the returned effect.

export type Pane = "list" | "detail";
export type MobilePane = "side" | "list" | "detail";

export type KeyState = {
  focus: Pane;
  mobile: MobilePane;
  // PR id of the selected row.
  selected: number | null;
  help: boolean;
  settings: boolean;
};

export type KeyContext = {
  // Row ids of the current list, in display order.
  ids: number[];
  // Focus is in a text field.
  typing: boolean;
  // Focus is on a button that is not a list row. Enter then activates the button.
  onButton: boolean;
  // Settings must stay open: no config, or the memory-mode token is missing.
  settingsLocked: boolean;
};

export type Effect = "focus-filter" | "focus-list" | "focus-detail" | "scroll-down" | "scroll-up" | null;

export type KeyResult = { state: KeyState; effect: Effect; handled: boolean };

const ignore = (state: KeyState): KeyResult => ({ state, effect: null, handled: false });

function back(s: KeyState, ctx: KeyContext): KeyResult {
  if (s.focus !== "detail" && s.mobile !== "detail" && !(s.settings && !ctx.settingsLocked)) return ignore(s);
  const settings = s.settings && ctx.settingsLocked;
  return { state: { ...s, focus: "list", mobile: "list", settings }, effect: "focus-list", handled: true };
}

export function reduceKey(s: KeyState, key: string, ctx: KeyContext): KeyResult {
  const done = (state: KeyState, effect: Effect = null): KeyResult => ({ state, effect, handled: true });

  if (key === "Escape") {
    if (s.help) return done({ ...s, help: false });
    if (ctx.typing) return done({ ...s, focus: "list" }, "focus-list");
    if (s.mobile === "side") return done({ ...s, mobile: "list", focus: "list" }, "focus-list");
    return back(s, ctx);
  }
  if (ctx.typing) return ignore(s);
  if (key === "?") return done({ ...s, help: !s.help });
  if (s.help) return ignore(s);

  switch (key) {
    case "/":
      return done({ ...s, focus: "list", mobile: s.mobile === "detail" || s.mobile === "side" ? "list" : s.mobile }, "focus-filter");
    case "j":
    case "k": {
      const d = key === "j" ? 1 : -1;
      if (s.focus === "detail") return done(s, d > 0 ? "scroll-down" : "scroll-up");
      if (!ctx.ids.length) return done(s);
      const i = s.selected === null ? -1 : ctx.ids.indexOf(s.selected);
      const next = i < 0 ? 0 : Math.max(0, Math.min(ctx.ids.length - 1, i + d));
      return done({ ...s, selected: ctx.ids[next] ?? null, settings: ctx.settingsLocked && s.settings }, "focus-list");
    }
    case "Enter":
    case "ArrowRight":
      if ((key === "Enter" && ctx.onButton) || s.focus !== "list" || s.selected === null || !ctx.ids.includes(s.selected)) return ignore(s);
      return done({ ...s, focus: "detail", mobile: "detail", settings: ctx.settingsLocked && s.settings }, "focus-detail");
    case "ArrowLeft":
      return back(s, ctx);
    default:
      return ignore(s);
  }
}

// Only the keys that work in M1.
export const HELP_KEYS: { keys: string[]; text: string }[] = [
  { keys: ["j", "k"], text: "Next / previous in the focused pane" },
  { keys: ["Enter", "→"], text: "Go into the detail pane" },
  { keys: ["Esc", "←"], text: "Back to the list" },
  { keys: ["/"], text: "Filter the list" },
  { keys: ["?"], text: "Show or hide this sheet" },
];
