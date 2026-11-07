import { useCallback, useSyncExternalStore } from "react";

/** Foundry is light by default whatever the system says; dark is something a person chooses. */
export type Theme = "light" | "dark";
const KEY = "cyrus-theme";
const listeners = new Set<() => void>();

function read(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Puts the saved choice on <html data-theme>. Call once before the first render. */
export function applySavedTheme(): void {
  document.documentElement.dataset.theme = read();
}

export function setTheme(t: Theme): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // Without storage the choice lasts until reload.
  }
  document.documentElement.dataset.theme = t;
  listeners.forEach((l) => l());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
  const toggle = useCallback(() => setTheme(theme === "dark" ? "light" : "dark"), [theme]);
  return { theme: theme as Theme, toggle };
}
