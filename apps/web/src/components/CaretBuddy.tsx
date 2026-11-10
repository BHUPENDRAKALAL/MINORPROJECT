import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { SpriteName } from "../app/nav";

/** Characters with a moving sprite sheet in the 96 px size (the 48 px set is missing some, e.g. wave). */
const MOVING: SpriteName[] = ["apprentice", "designer", "reviewer", "smith", "ask", "cheer", "blocked", "wave"];

/**
 * A small pixel character that takes the place of the text cursor: it stands where the next letter goes,
 * runs along while you type (its frames loop and it bobs) and stands still when you stop. The real cursor
 * is hidden only while the character shows, so the field works the same without it; screen readers never see it.
 */
export function CaretBuddy({ input, sprite }: { input: RefObject<HTMLInputElement | null>; sprite: SpriteName }) {
  const [x, setX] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const stopAt = useRef<number | undefined>(undefined);
  const name = MOVING.includes(sprite) ? sprite : "apprentice";

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    // A hidden copy of the text, in the same font, to find out how far along the cursor is.
    const mirror = document.createElement("span");
    mirror.setAttribute("aria-hidden", "true");
    Object.assign(mirror.style, { position: "absolute", top: "0", left: "-9999px", visibility: "hidden", whiteSpace: "pre" });
    document.body.appendChild(mirror);

    const place = () => {
      if (document.activeElement !== el || el.readOnly || el.disabled) return setX(null);
      const cs = getComputedStyle(el);
      mirror.style.font = cs.font;
      mirror.style.letterSpacing = cs.letterSpacing;
      let at = el.value.length;
      try {
        // Email and number fields don't report the cursor position; the end of the text is close enough.
        if (el.selectionStart !== null) at = el.selectionDirection === "backward" ? el.selectionStart : (el.selectionEnd ?? at);
      } catch {
        /* see above */
      }
      const before = el.value.slice(0, at);
      mirror.textContent = el.type === "password" ? "•".repeat(before.length) : before;
      const padL = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
      const right = el.offsetWidth - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
      setX(Math.max(padL, Math.min(padL + mirror.getBoundingClientRect().width - el.scrollLeft, right)));
    };
    const typed = () => {
      setRunning(true);
      window.clearTimeout(stopAt.current);
      stopAt.current = window.setTimeout(() => setRunning(false), 650);
      place();
    };
    const onSelection = () => document.activeElement === el && place();

    el.addEventListener("focus", place);
    el.addEventListener("blur", place);
    el.addEventListener("input", typed);
    el.addEventListener("keyup", place);
    el.addEventListener("click", place);
    el.addEventListener("scroll", place);
    document.addEventListener("selectionchange", onSelection);
    place();
    return () => {
      window.clearTimeout(stopAt.current);
      el.removeEventListener("focus", place);
      el.removeEventListener("blur", place);
      el.removeEventListener("input", typed);
      el.removeEventListener("keyup", place);
      el.removeEventListener("click", place);
      el.removeEventListener("scroll", place);
      document.removeEventListener("selectionchange", onSelection);
      mirror.remove();
    };
  }, [input]);

  return (
    <span className={`caret-buddy${x === null ? "" : " is-on"}${running ? " is-running" : ""}`} style={{ "--x": `${x ?? 0}px` } as CSSProperties} aria-hidden="true">
      <span className={`sprite sprite-96 sheet-${name}-96`} />
    </span>
  );
}
