// Adapted from Foundry (Apache-2.0), see src/vendor/foundry/LICENSE
// Based on Foundry's sign-in stage (login.html): the grid tile and a character beside the form.
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { SpriteName } from "../../app/nav";
import { GridTile, Sprite, Sticker, Wordmark, type StickerName } from "../../components/ui";
import { APP_NAME } from "../../lib/brand";
import { useTitle } from "../../lib/useTitle";

export function BarePage({ children }: { children: ReactNode }) {
  return (
    <div className="bare">
      <header className="bare-head">
        <Link className="mark" to="/" aria-label={`${APP_NAME} home`}>
          <Wordmark />
        </Link>
      </header>
      <main id="main">{children}</main>
    </div>
  );
}

/**
 * Auth pages: the form sits straight on the page (no panel, no brand), with Foundry's grid tile and a character
 * filling the other half on wide screens. On a phone only the form shows.
 */
export function AuthLayout({
  title,
  lead,
  sprite = "wave",
  family = "lime",
  children,
}: {
  title: string;
  lead?: ReactNode;
  /** null hides the character, for result moments that show a sticker instead. */
  sprite?: SpriteName | null;
  family?: "lime" | "azure" | "orchid" | "sun" | "ember";
  children: ReactNode;
}) {
  useTitle(title);
  return (
    <div className="auth-page">
      <main id="main" className="auth-main">
        <div className="auth-form">
          <h1>{title}</h1>
          {lead && <p className="lead">{lead}</p>}
          {children}
        </div>
      </main>
      <div className="auth-art" aria-hidden="true">
        <GridTile family={family} />
        {sprite && <Sprite name={sprite} size={96} plays />}
      </div>
    </div>
  );
}

/** A result moment (done, check your email, link not valid): a sticker, the words and the next step. */
export function ResultPanel({
  sticker,
  title,
  children,
  actions,
}: {
  sticker: StickerName;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="result" role="status">
      <Sticker name={sticker} size={112} />
      <h2>{title}</h2>
      {children && <p className="lead">{children}</p>}
      {actions && <div className="buttons">{actions}</div>}
    </div>
  );
}
