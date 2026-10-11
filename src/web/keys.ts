// Pure key handling (prototype/v3 keyboard model). The shell performs the returned effect.

export type Pane = "list" | "detail";
export type MobilePane = "side" | "list" | "detail";

export type KeyState = {
  focus: Pane;
  mobile: MobilePane;
  // PR id of the selected row.
  selected: number | null;
  help: boolean;
  settings: boolean;
  // ms: the time of a "g" press that waits for its second key.
  chord: number | null;
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
  // ms.
  now: number;
  // The open layer of the detail that Esc closes first: the review brief, the post confirm, or the run log (prototype/v3 Esc order).
  // A triage edit, a line field, and a reply box close themselves on Esc.
  layer?: Layer;
};

export type Layer = "brief" | "confirm" | "log" | null;

export type Effect =
  | "focus-filter"
  | "focus-list"
  | "open-cause"
  | "thread-next"
  | "thread-prev"
  | "thread-toggle"
  | "next-new"
  | "prev-new"
  | "next-your"
  | "files"
  | "commits"
  | "show-in-diff"
  | "overview"
  | "drafts"
  | "log"
  | "rerun"
  | "rereview"
  | "ask"
  | "brief"
  | "accept"
  | "edit"
  | "discard"
  | "post"
  | "close-brief"
  | "close-confirm"
  | "close-log"
  | null;

export type KeyResult = { state: KeyState; effect: Effect; handled: boolean };

// prototype/v3: the second key of a chord counts within 1.2 s.
const CHORD_MS = 1200;

const ignore = (state: KeyState): KeyResult => ({ state, effect: null, handled: false });

function back(s: KeyState, ctx: KeyContext): KeyResult {
  if (s.focus !== "detail" && s.mobile !== "detail" && !(s.settings && !ctx.settingsLocked)) return ignore(s);
  const settings = s.settings && ctx.settingsLocked;
  return { state: { ...s, focus: "list", mobile: "list", settings }, effect: "focus-list", handled: true };
}

// Keys that act on the PR in the detail pane. They move focus there.
const DETAIL: Record<string, Effect> = {
  n: "next-new",
  N: "prev-new",
  y: "next-your",
  o: "thread-toggle",
  "1": "overview",
  "2": "drafts",
  "3": "log",
  r: "rerun",
  R: "brief",
  c: "rereview",
  q: "ask",
  a: "accept",
  e: "edit",
  d: "discard",
  p: "post",
};
// Plan r2 UI-DIFF: g d shows the current inline thread or draft in the diff.
const CHORD: Record<string, Effect> = { f: "files", c: "commits", d: "show-in-diff" };

export function reduceKey(state: KeyState, key: string, ctx: KeyContext): KeyResult {
  const done = (next: KeyState, effect: Effect = null): KeyResult => ({ state: next, effect, handled: true });
  const chord = state.chord !== null && ctx.now - state.chord < CHORD_MS;
  const s = state.chord === null ? state : { ...state, chord: null };
  const hasPr = s.selected !== null && ctx.ids.includes(s.selected) && !(s.settings && ctx.settingsLocked);
  const inDetail = { ...s, focus: "detail" as const, mobile: "detail" as const, settings: false };

  if (key === "Escape") {
    if (s.help) return done({ ...s, help: false });
    if (ctx.layer) return done(s, `close-${ctx.layer}`);
    if (ctx.typing) return done({ ...s, focus: "list" }, "focus-list");
    if (s.mobile === "side") return done({ ...s, mobile: "list", focus: "list" }, "focus-list");
    return back(s, ctx);
  }
  if (ctx.typing) return ignore(s);
  if (key === "?") return done({ ...s, help: !s.help });
  if (s.help) return ignore(s);
  // The second key of "g f", "g c", or "g d". Any other key ends the chord.
  if (chord) return hasPr && CHORD[key] ? done(inDetail, CHORD[key]) : done(s);
  if (key === "Enter" && s.focus === "detail") return ctx.onButton || !hasPr ? ignore(s) : done(s, "thread-toggle");

  switch (key) {
    case "/":
      return done({ ...s, focus: "list", mobile: s.mobile === "detail" || s.mobile === "side" ? "list" : s.mobile }, "focus-filter");
    case "j":
    case "k": {
      const d = key === "j" ? 1 : -1;
      // plan v3 I14: the detail moves between threads.
      if (s.focus === "detail") return done(s, d > 0 ? "thread-next" : "thread-prev");
      if (!ctx.ids.length) return done(s);
      const i = s.selected === null ? -1 : ctx.ids.indexOf(s.selected);
      const next = i < 0 ? 0 : Math.max(0, Math.min(ctx.ids.length - 1, i + d));
      return done({ ...s, selected: ctx.ids[next] ?? null, settings: ctx.settingsLocked && s.settings }, "focus-list");
    }
    case "Enter":
    case "ArrowRight":
      if ((key === "Enter" && ctx.onButton) || s.focus !== "list" || s.selected === null || !ctx.ids.includes(s.selected)) return ignore(s);
      // prototype/v3: a row opens at the thread that put it in the inbox.
      return done({ ...s, focus: "detail", mobile: "detail", settings: ctx.settingsLocked && s.settings }, "open-cause");
    case "ArrowLeft":
      return back(s, ctx);
    case "g":
      return hasPr ? done({ ...s, chord: ctx.now }) : ignore(s);
    default: {
      const effect = DETAIL[key];
      return effect && hasPr ? done(inDetail, effect) : ignore(s);
    }
  }
}

// Only the keys that work now.
export const HELP_KEYS: { group: string; keys: { keys: string[]; second?: string[]; text: string }[] }[] = [
  {
    group: "Move",
    keys: [
      { keys: ["j", "k"], text: "Next or previous pull request in the list, or thread in the detail" },
      { keys: ["Enter", "→"], text: "Open the pull request at the thread that put it in the inbox" },
      { keys: ["Esc", "←"], text: "Back to the list" },
      { keys: ["/"], text: "Filter the list" },
    ],
  },
  {
    group: "Pull request",
    keys: [
      { keys: ["n", "N"], text: "Next or previous new message" },
      { keys: ["y"], text: "Next thread where it is your turn" },
      { keys: ["o"], text: "Open or close the current thread" },
      { keys: ["g"], second: ["f", "c"], text: "Open and go to Files or Commits" },
      { keys: ["g"], second: ["d"], text: "Show the current inline thread or draft on its line in the diff" },
      { keys: ["1", "2", "3"], text: "Go to the overview, go to the drafts and then the reply drafts, open the run log" },
      { keys: ["?"], text: "Show or hide this list" },
    ],
  },
  {
    group: "AI review",
    keys: [
      { keys: ["r"], text: "Run the brief of this pull request again. With no brief yet, open the review brief." },
      { keys: ["Shift", "R"], text: "Open the review brief: task, your note, and profile" },
      { keys: ["c"], text: "Review only the commits since the last review. Its open drafts carry over." },
      { keys: ["q"], text: "Ask a question about this pull request. The answer stays here. Nothing posts." },
      { keys: ["Ctrl", "Enter"], text: "Start the review from the brief, or send the question from the Ask box" },
      { keys: ["Esc"], text: "Close an edit, the review brief, the post confirm, or the run log" },
    ],
  },
  {
    group: "Triage and post",
    keys: [
      {
        keys: ["a", "e", "d"],
        text: "Accept, edit, or discard the current draft or question. a again undoes an accept, d again restores.",
      },
      { keys: ["p"], text: "Post the accepted items, after a confirm" },
      { keys: ["Ctrl", "Enter"], text: "In a reply box: show the reply and its destination before it posts" },
    ],
  },
];
