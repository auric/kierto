// Theme: the system scheme by default, with a manual override. Storage can be blocked, so every access sits in try/catch.
import { useSyncExternalStore } from "react";

const KEY = "rl-theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function stored(): "dark" | "light" | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

const isDark = () => (stored() ?? (media.matches ? "dark" : "light")) === "dark";

function apply() {
  document.documentElement.classList.toggle("dark", isDark());
  for (const fn of listeners) fn();
}

export function initTheme() {
  apply();
  media.addEventListener("change", apply);
}

export function toggleTheme() {
  try {
    localStorage.setItem(KEY, isDark() ? "light" : "dark");
  } catch {
    // Without storage the override lasts until the page reloads.
    document.documentElement.classList.toggle("dark");
    for (const fn of listeners) fn();
    return;
  }
  apply();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const useDark = () => useSyncExternalStore(subscribe, () => document.documentElement.classList.contains("dark"));
