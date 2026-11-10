import { useId } from "react";

/**
 * The Cyrus logo mark (from brand/cyrus-mark.svg): a bright disc with a green crescent rim,
 * three claw marks and a small lime moon. To change the logo, replace this file, brand/cyrus-mark.svg
 * and public/favicon.svg. The faint outline (in the theme's ink) keeps the disc visible on a light page.
 * The clip id is unique per copy, because several marks can be on one page.
 */
export function BrandMark({ className = "logo" }: { className?: string }) {
  const clipId = `cyrus-face-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clipId}>
          <circle cx="34" cy="30" r="24" />
        </clipPath>
      </defs>
      <circle cx="31.2" cy="32.8" r="25.4" fill="#1f7a4a" />
      <circle cx="34" cy="30" r="24" fill="#f3f3ec" stroke="currentColor" strokeOpacity="0.16" strokeWidth="0.8" />
      <g clipPath={`url(#${clipId})`} fill="#14160f">
        <path d="M46 11 L17.0 34.33 L12 41 L19.24 36.87 Z" />
        <path d="M53 16 L22.2 41.66 L17 49 L24.76 44.46 Z" />
        <path d="M57.5 25 L29.7 48.35 L25 55 L32.0 50.85 Z" />
      </g>
      <circle cx="21.5" cy="18.5" r="3.7" fill="#d4e43b" stroke="#14160f" strokeWidth="1.2" />
    </svg>
  );
}
