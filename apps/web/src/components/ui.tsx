// Adapted from Foundry (Apache-2.0), see src/vendor/foundry/LICENSE
// React versions of Foundry's dashboard macros (_ui.html) and shapes. Colour comes from the stylesheet, never from here.
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Family, IconName, SpriteName } from "../app/nav";
import { APP_NAME } from "../lib/brand";
import { BrandMark } from "./BrandMark";

export { BrandMark };

import approved from "../vendor/foundry/stickers/approved.png";
import blocked from "../vendor/foundry/stickers/blocked.png";
import briefReceived from "../vendor/foundry/stickers/brief_received.png";
import celebrate from "../vendor/foundry/stickers/celebrate.png";
import needsInput from "../vendor/foundry/stickers/needs_input.png";
import revise from "../vendor/foundry/stickers/revise.png";
import shipped from "../vendor/foundry/stickers/shipped.png";
import wave from "../vendor/foundry/stickers/wave.png";
import working from "../vendor/foundry/stickers/working.png";

const FAMILIES = ["lime", "ember", "azure", "orchid", "sun"] as const;
const GRID_CELL = 64;
const CUT_OUT = "M0 400V270C190 256 380 128 610 112C716 104 842 122 800 232C860 170 1010 70 1200 30V400Z";

/** The gradients and the grid every shape on a page shares. Rendered once at the app root, hidden. */
export function ShapeDefs() {
  return (
    <svg className="defs" aria-hidden="true" focusable="false" width="0" height="0">
      <defs>
        {FAMILIES.map((f) => (
          <g key={f}>
            <linearGradient id={`deep-${f}`} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" className={`stop-${f}-1`} />
              <stop offset="0.52" className={`stop-${f}-2`} />
              <stop offset="1" className={`stop-${f}-3`} />
            </linearGradient>
            <linearGradient id={`tile-${f}`} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" className={`stop-${f}-2`} />
              <stop offset="1" className={`stop-${f}-3`} />
            </linearGradient>
          </g>
        ))}
        <pattern id="grid-cells" width={GRID_CELL} height={GRID_CELL} patternUnits="userSpaceOnUse">
          <path className="grid-cell" d={`M${GRID_CELL - 0.5} 0V${GRID_CELL}M0 ${GRID_CELL - 0.5}H${GRID_CELL}`} />
        </pattern>
      </defs>
    </svg>
  );
}

type ShapeFamily = Exclude<Family, "none">;

/** A family's gradient with thin dark grid lines. Whatever sits on it overlaps it and runs off one edge. */
export function GridTile({ family = "lime" }: { family?: ShapeFamily }) {
  return (
    <svg className="grid-tile" aria-hidden="true" focusable="false" width="100%" height="100%">
      <rect width="100%" height="100%" fill={`url(#tile-${family})`} />
      <rect width="100%" height="100%" fill="url(#grid-cells)" />
    </svg>
  );
}

/** The hero's flat cut-out: long curves and one cusp, hugging the bottom of a rounded panel. */
export function CutOut({ family = "lime" }: { family?: ShapeFamily }) {
  return (
    <svg className="cut-out" viewBox="0 0 1200 400" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path fill={`url(#deep-${family})`} d={CUT_OUT} />
    </svg>
  );
}

export function Icon({ name }: { name: IconName }) {
  return <span className={`icon icon-${name}`} aria-hidden="true" />;
}

export function Tile({ icon, family }: { icon: IconName; family: Family }) {
  return (
    <span className={`tile fam-${family}`} aria-hidden="true">
      <Icon name={icon} />
    </span>
  );
}

/** A character from a sprite sheet. Frame one is the still; `plays` runs the sheet's reaction once (or as often as the sheet says). */
export function Sprite({ name, size = 48, plays = false }: { name: SpriteName; size?: 48 | 96; plays?: boolean }) {
  return <span className={`sprite sprite-${size} sheet-${name}-${size}${plays ? " plays" : ""}`} aria-hidden="true" />;
}

const STICKERS = {
  approved,
  blocked,
  brief_received: briefReceived,
  celebrate,
  needs_input: needsInput,
  revise,
  shipped,
  wave,
  working,
} as const;
export type StickerName = keyof typeof STICKERS;

/** A bigger character for result moments (success, check your email, something went wrong). Decorative only. */
export function Sticker({ name, size = 128 }: { name: StickerName; size?: number }) {
  return <img className="sticker" src={STICKERS[name]} alt="" aria-hidden="true" width={size} height={size} />;
}

/** Initials in a quiet circle. */
export function Avatar({ name }: { name: string }) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words.length ? (words[0][0] + (words[1]?.[0] ?? "")).toUpperCase() : "?";
  return (
    <span className="avatar" title={name} aria-hidden="true">
      {initials}
    </span>
  );
}

/** A grid tile, a character at rest, what is true and the next step. */
export function EmptyState({
  sprite = "smith",
  family = "lime",
  children,
  action,
}: {
  sprite?: SpriteName;
  family?: ShapeFamily;
  children: ReactNode;
  action?: { to: string; label: string };
}) {
  return (
    <div className="empty-state">
      <GridTile family={family} />
      <Sprite name={sprite} size={96} plays />
      <div className="empty-card">
        <p className="empty">{children}</p>
        {action && (
          <Link className="button" to={action.to}>
            {action.label}
          </Link>
        )}
      </div>
    </div>
  );
}

/** A breadcrumb in the h1: the way back is muted, where you are is not. */
export function PageTitle({ trail = [], here }: { trail?: { label: string; to: string }[]; here: string }) {
  return (
    <h1 className="title">
      {trail.map((c) => (
        <span key={c.to} className="title-crumb">
          <Link to={c.to}>{c.label}</Link>
          <span className="title-sep" aria-hidden="true">
            /
          </span>
        </span>
      ))}
      <span title={here}>{here}</span>
    </h1>
  );
}

/** Done: a nodding character and the words. */
export function Saved({ children }: { children: ReactNode }) {
  return (
    <p className="alert alert-done" role="status">
      <Sprite name="nod" size={48} plays />
      <span>{children}</span>
    </p>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p className="alert" role="alert">
      {children}
    </p>
  );
}

/** The product name with the mark, for pages without a sign-in. */
export function Wordmark() {
  return (
    <span className="cy-wordmark">
      <BrandMark className="cy-wordmark-mark" />
      <span>{APP_NAME}</span>
    </span>
  );
}
