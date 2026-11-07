import { useId } from "react";

/**
 * The Cyrus logo mark ("Eclipse": a ring with a solid disc in front of it), from brand/cyrus-mark.svg.
 * To change the logo, replace this one file and public/favicon.svg.
 * Drawn in currentColor so it follows the theme's ink colour. The mask id is unique per copy,
 * because several marks can be on one page.
 */
export function BrandMark({ className = "logo" }: { className?: string }) {
  const maskId = `cyrus-cut-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="white" />
          <circle cx="60" cy="60" r="34" fill="black" />
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        <circle cx="42" cy="42" r="33" fill="none" stroke="currentColor" strokeWidth="7" />
      </g>
      <circle cx="60" cy="60" r="27" fill="currentColor" />
    </svg>
  );
}
