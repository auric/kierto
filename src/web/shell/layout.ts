// Panel preferences of this viewer (plan pr-view-v4 4.3 and 4.4): the list width and the sidebar choice.
// They stay in localStorage only, never in the URL. Storage can be missing or blocked, so every access sits in try/catch.

export const LIST_MIN = 280;
export const LIST_MAX = 560;
// The default list width: 368 px next to the full sidebar, 320 px next to the rail.
export const listDefault = (rail: boolean) => (rail ? 320 : 368);
export const clampList = (w: number) => Math.round(Math.min(LIST_MAX, Math.max(LIST_MIN, w)));

// "auto": the rail below 1440 px (decision D4). "rail" and "full": the choice of the viewer, at every wide window.
export type SidePref = "auto" | "rail" | "full";
export const railOn = (pref: SidePref, wide: boolean) => pref === "rail" || (pref === "auto" && !wide);

const LIST_KEY = "rl-list-w";
const SIDE_KEY = "rl-side";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// The localStorage getter itself throws when the browser blocks site data.
function local(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// null: no stored width, so the default applies.
export function readListWidth(store: Store | null = local()): number | null {
  try {
    const v = Number(store?.getItem(LIST_KEY) || Number.NaN);
    return Number.isFinite(v) ? clampList(v) : null;
  } catch {
    return null;
  }
}

// null removes the stored width.
export function writeListWidth(w: number | null, store: Store | null = local()) {
  try {
    if (w === null) store?.removeItem(LIST_KEY);
    else store?.setItem(LIST_KEY, String(clampList(w)));
  } catch {}
}

export function readSide(store: Store | null = local()): SidePref {
  try {
    const v = store?.getItem(SIDE_KEY);
    return v === "rail" || v === "full" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function writeSide(pref: SidePref, store: Store | null = local()) {
  try {
    if (pref === "auto") store?.removeItem(SIDE_KEY);
    else store?.setItem(SIDE_KEY, pref);
  } catch {}
}
