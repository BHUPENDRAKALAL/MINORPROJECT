// Adapted from Foundry (Apache-2.0), see src/vendor/foundry/LICENSE
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { SpriteName } from "../../app/nav";
import { AuthShowcase } from "../../components/AuthShowcase";
import { MeshBackdrop } from "../../components/MeshBackdrop";
import { BrandMark, Sticker, Wordmark, type StickerName } from "../../components/ui";
import { CaretBuddyContext } from "../../lib/caretBuddy";
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
 * Auth pages, split like most good sign-in screens: the form on the left (brand on top, title, one line, the form,
 * the links), and on a wide screen a panel on the right with a slow grainy mesh gradient (see MeshBackdrop).
 * The page's character is the text cursor in the form's fields (see CaretBuddy).
 */
export function AuthLayout({
  title,
  lead,
  sprite = "apprentice",
  children,
}: {
  title: string;
  lead?: ReactNode;
  /** The character that stands in for the text cursor; null keeps the normal cursor. */
  sprite?: SpriteName | null;
  children: ReactNode;
}) {
  useTitle(title);
  return (
    <div className="auth-page">
      <main id="main" className="auth-main">
        <Link className="auth-brand" to="/" aria-label={`${APP_NAME} home`}>
          <BrandMark className="auth-brand-mark" />
          <span>{APP_NAME}</span>
        </Link>
        <div className="auth-body">
          <h1 className="auth-title">{title}</h1>
          {lead && <p className="auth-lead">{lead}</p>}
          <div className="auth-card">
            <CaretBuddyContext.Provider value={sprite}>{children}</CaretBuddyContext.Provider>
          </div>
        </div>
        <p className="auth-legal">MBM University · Training and Placement Cell</p>
      </main>
      <aside className="auth-art" aria-hidden="true">
        <MeshBackdrop className="auth-mesh" />
        <AuthShowcase />
        <div className="auth-art-copy">
          <p className="auth-art-kicker">Cyrus</p>
          <p className="auth-art-line">Every drive, from the first invite to the offer letter, in one calm place.</p>
        </div>
      </aside>
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
