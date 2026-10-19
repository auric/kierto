// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Theme and row density. Theme: the system scheme by default, with a manual override. Storage can be blocked, so every access sits in try/catch.
import { useSyncExternalStore } from "react";

export type Theme = "system" | "light" | "dark";

const THEME = "rl-theme";
const DENSITY = "rl-density";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();
// The values without storage. They last until the page reloads.
let memory: { theme: Theme; compact: boolean } = { theme: "system", compact: false };

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

function theme(): Theme {
  const v = read(THEME);
  return v === "dark" || v === "light" ? v : memory.theme;
}

const compact = () => (read(DENSITY) ?? (memory.compact ? "compact" : null)) === "compact";

function apply() {
  const t = theme();
  const root = document.documentElement;
  root.classList.toggle("dark", t === "dark" || (t === "system" && media.matches));
  if (compact()) root.dataset.density = "compact";
  else delete root.dataset.density;
  for (const fn of listeners) fn();
}

export function initTheme() {
  apply();
  media.addEventListener("change", apply);
}

// prototype/v3: system, then light, then dark.
export const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

export function setTheme(next: Theme) {
  memory = { ...memory, theme: next };
  write(THEME, next === "system" ? null : next);
  apply();
}

export const cycleTheme = () => setTheme(NEXT_THEME[theme()]);

export function toggleDensity() {
  const next = !compact();
  memory = { ...memory, compact: next };
  write(DENSITY, next ? "compact" : null);
  apply();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const useTheme = () => useSyncExternalStore(subscribe, theme);
export const useCompact = () => useSyncExternalStore(subscribe, compact);
