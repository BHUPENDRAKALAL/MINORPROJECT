import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/**
 * The side panel behaves like VS Code's side bar (desktop only; phones use the bottom bar):
 *  - drag its right edge to change the width (MIN–MAX),
 *  - drag it narrower than SNAP and it folds to the icon rail; drag the rail's edge out and it opens again,
 *  - Ctrl+B (⌘B on Mac) or the panel button folds/opens it,
 *  - double-click the edge to go back to the default width,
 *  - the edge is keyboard-usable: ←/→ resize, Enter folds/opens, Home resets.
 * Width and folded state are remembered per browser.
 */
export const SIDE_DEFAULT = 240;
export const SIDE_MIN = 200;
export const SIDE_MAX = 440;
const SNAP = 150;
const STEP = 16;
const KEY = "cyrus-side-panel";

interface Saved {
  width: number;
  folded: boolean;
}

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Saved> | null;
    if (raw && typeof raw.width === "number") {
      return { width: clamp(raw.width), folded: !!raw.folded };
    }
  } catch {
    // storage unavailable: use defaults
  }
  return { width: SIDE_DEFAULT, folded: false };
}

const clamp = (w: number) => Math.min(SIDE_MAX, Math.max(SIDE_MIN, Math.round(w)));

export function useSidePanel() {
  const [state, setState] = useState<Saved>(load);
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number; startFolded: boolean } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }, [state]);

  const toggle = useCallback(() => setState((s) => ({ ...s, folded: !s.folded })), []);
  const reset = useCallback(() => setState({ width: SIDE_DEFAULT, folded: false }), []);

  // Ctrl+B / ⌘B, like VS Code. Skipped while typing in a field so it never steals a shortcut there.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "b") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Some pointers can't be captured; dragging still works while the pointer stays on the edge.
      }
      drag.current = { startX: e.clientX, startWidth: state.folded ? 0 : state.width, startFolded: state.folded };
      setResizing(true);
    },
    [state],
  );

  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const raw = d.startWidth + (e.clientX - d.startX);
    // Folding keeps the width it had before the drag, so opening again returns to it (like VS Code).
    if (raw < SNAP) setState((s) => ({ width: d.startFolded ? s.width : d.startWidth, folded: true }));
    else setState({ width: clamp(raw), folded: false });
  }, []);

  const endDrag = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setResizing(false);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // nothing to release
    }
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setState((s) => (s.folded ? s : s.width - STEP < SIDE_MIN ? { ...s, folded: true } : { ...s, width: clamp(s.width - STEP) }));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setState((s) => (s.folded ? { ...s, folded: false } : { ...s, width: clamp(s.width + STEP) }));
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      } else if (e.key === "Home") {
        e.preventDefault();
        reset();
      }
    },
    [toggle, reset],
  );

  return {
    width: state.width,
    folded: state.folded,
    resizing,
    toggle,
    handleProps: {
      role: "separator" as const,
      "aria-orientation": "vertical" as const,
      "aria-label": "Resize the side panel",
      "aria-valuemin": SIDE_MIN,
      "aria-valuemax": SIDE_MAX,
      "aria-valuenow": state.folded ? 0 : state.width,
      title: "Drag to resize · double-click to reset · Ctrl+B to fold",
      tabIndex: 0,
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onDoubleClick: reset,
      onKeyDown,
    },
  };
}
