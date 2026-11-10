// Adapted from Foundry (Apache-2.0), see src/vendor/foundry/LICENSE
// Foundry's frame (base.html): a side bar with no top bar on a desk, and a bar along the bottom on anything smaller.
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import type { Role } from "@cyrus/shared";
import { Avatar, BrandMark, Icon } from "../components/ui";
import { APP_NAME } from "../lib/brand";
import { ROLE_LABELS, ROLE_PRIORITY } from "../lib/constants";
import { useAuth } from "./useAuth";
import { groupNav, homeFor, isCurrent, navFor, type NavItem } from "./nav";
import { useUnread, useUnreadWatcher } from "./useUnread";
import { useTheme } from "./theme";
import { useSidePanel } from "./useSidePanel";

/** Closes an open <details> menu when the route changes or someone clicks outside it. */
function useCloseOnNavigate() {
  const ref = useRef<HTMLDetailsElement>(null);
  const location = useLocation();
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [location.pathname]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = ref.current;
      if (el?.open && !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);
  return ref;
}

/** The unread badge next to Notifications. */
function UnreadCount() {
  const n = useUnread();
  if (!n) return null;
  return (
    <span className="nav-count cy-unread" aria-label={`${n} unread`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

function NavRow({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  return (
    <li className={`fam-${item.family}`}>
      <Link className="nav-item" to={item.to} aria-current={isCurrent(item, pathname) ? "page" : undefined}>
        <Icon name={item.icon} />
        <span className="nav-name">{item.label}</span>
        {item.key === "notifications" && <UnreadCount />}
      </Link>
    </li>
  );
}

function Tab({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  return (
    <Link className="tab" to={item.to} aria-label={item.title ?? item.label} aria-current={isCurrent(item, pathname) ? "page" : undefined}>
      <Icon name={item.icon} />
      <span className="tab-name">{item.label}</span>
      {item.key === "notifications" && <UnreadCount />}
    </Link>
  );
}

/** Which role's pages are showing. Foundry's business switcher, built with details. */
function RoleSwitcher() {
  const { me, role, setRole } = useAuth();
  const navigate = useNavigate();
  const ref = useCloseOnNavigate();
  if (!me || !role) return null;
  const roles = ROLE_PRIORITY.filter((r) => me.roles.includes(r));
  const company = me.companyMembers[0]?.company.name;
  const label = ROLE_LABELS[role] + (role === "COMPANY_HR" && company ? ` · ${company}` : "");

  if (roles.length < 2) {
    return (
      <div className="switcher is-one">
        <div className="switcher-head">
          <span className="nav-name">{label}</span>
        </div>
      </div>
    );
  }

  const pick = (r: Role) => {
    setRole(r);
    if (ref.current) ref.current.open = false;
    navigate(homeFor(r));
  };

  return (
    <details className="switcher" ref={ref}>
      <summary className="switcher-head">
        <span className="hidden">Acting as </span>
        <span className="nav-name">{label}</span>
        <Icon name="chevron" />
      </summary>
      <nav className="switcher-menu" aria-label="Switch role">
        {roles.map((r) => (
          <button
            key={r}
            type="button"
            className="switcher-item"
            aria-current={r === role ? "true" : undefined}
            onClick={() => pick(r)}
          >
            <span className={`dot ${r === role ? "fam-lime" : "fam-none"}`} aria-hidden="true" />
            <span className="nav-name">{ROLE_LABELS[r]}</span>
          </button>
        ))}
      </nav>
    </details>
  );
}

/** The person: avatar, name, and a menu with change password, theme and sign out. */
function UserMenu({ placement }: { placement: "side" | "top" }) {
  const { me, role, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const ref = useCloseOnNavigate();
  if (!me) return null;
  const name = me.name ?? me.email;

  return (
    <details className={`user-menu user-menu-${placement}`} ref={ref}>
      <summary className="who" aria-label={`Account menu for ${name}`}>
        <Avatar name={name} />
        <span className="who-name" title={me.email}>
          {name}
        </span>
        <Icon name="chevron" />
      </summary>
      <div className="user-menu-panel" role="menu">
        <div className="um-head">
          <Avatar name={name} />
          <div className="um-who">
            <span className="um-name">{name}</span>
            <span className="um-email">{me.email}</span>
            {role && <span className="um-role">{ROLE_LABELS[role]}</span>}
          </div>
        </div>
        <div className="um-group">
          <Link className="um-item" role="menuitem" to="/account">
            <Icon name="brief" />
            <span>Your account</span>
          </Link>
          <button type="button" className="um-item" role="menuitemcheckbox" aria-checked={theme === "dark"} onClick={toggle}>
            <Icon name="panel" />
            <span>Dark theme</span>
            <span className={`um-switch${theme === "dark" ? " is-on" : ""}`} aria-hidden="true" />
          </button>
          {import.meta.env.DEV && (
            <Link className="um-item" role="menuitem" to="/status">
              <Icon name="activity" />
              <span>System status</span>
              <span className="um-tag">dev</span>
            </Link>
          )}
        </div>
        <div className="um-group">
          <button type="button" className="um-item um-danger" role="menuitem" onClick={() => void signOut().then(() => navigate("/sign-in", { replace: true }))}>
            <Icon name="go" />
            <span>Sign out</span>
          </button>
        </div>
      </div>
    </details>
  );
}

export default function Shell({ children }: { children?: ReactNode }) {
  const { role } = useAuth();
  const items = role ? navFor(role) : [];
  const location = useLocation();
  const moreRef = useCloseOnNavigate();
  // The bottom bar holds four pages and More; with five or fewer pages, all of them fit.
  const inBar = items.length <= 5 ? items : items.slice(0, 4);
  const inMore = items.length <= 5 ? [] : items.slice(4);
  const moreCurrent = inMore.some((i) => isCurrent(i, location.pathname));
  const side = useSidePanel();
  useUnreadWatcher();
  // Open: the chosen width. Folded: Foundry's own rail width (set by its :has(.side-toggle:checked) rule).
  const shellStyle = side.folded ? undefined : ({ "--sidebar": `${side.width}px` } as CSSProperties);
  const foldLabel = side.folded ? "Open the side panel (Ctrl+B)" : "Fold the side panel (Ctrl+B)";

  return (
    <div className={`shell${side.resizing ? " is-resizing" : ""}`} style={shellStyle}>
      <a className="skip" href="#main">
        Skip to the page
      </a>
      <input
        className="side-toggle"
        type="checkbox"
        id="side-toggle"
        aria-label={foldLabel}
        checked={side.folded}
        onChange={side.toggle}
      />
      <aside className="side">
        <div className="side-top">
          <div className="brand">
            <Link className="mark" to={role ? homeFor(role) : "/"}>
              <BrandMark />
              <span className="mark-word">{APP_NAME}</span>
            </Link>
            <RoleSwitcher />
          </div>
          <label className="side-fold" htmlFor="side-toggle" title={foldLabel}>
            <Icon name="panel" />
          </label>
          <UserMenu placement="top" />
        </div>
        <nav className="side-nav" aria-label="Pages">
          {groupNav(items).map((g, n) => (
            <div key={g.label ?? `top-${n}`} className="nav-group" role="group" aria-label={g.label ?? "Main"}>
              {g.label && (
                <p className="nav-label" aria-hidden="true">
                  {g.label}
                </p>
              )}
              <ul className="nav-list">
                {g.items.map((i) => (
                  <NavRow key={i.key} item={i} />
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <UserMenu placement="side" />
      </aside>
      <div className="side-resize" {...side.handleProps} />
      <main id="main">
        {/* Keyed by the page: each page fades in when you move to it */}
        <div className="ui-page" key={location.pathname}>
          {children ?? <Outlet />}
        </div>
      </main>
      <nav className="tabbar" aria-label="Pages" style={{ gridTemplateColumns: `repeat(${inBar.length + (inMore.length ? 1 : 0)}, minmax(0, 1fr))` }}>
        {inBar.map((i) => (
          <Tab key={i.key} item={i} />
        ))}
        {inMore.length > 0 && (
          <details className={`more${moreCurrent ? " is-current" : ""}`} ref={moreRef}>
            <summary className="tab">
              <Icon name="more" />
              More
            </summary>
            <div className="more-panel">
              <ul className="nav-list">
                {inMore.map((i) => (
                  <NavRow key={i.key} item={i} />
                ))}
              </ul>
            </div>
          </details>
        )}
      </nav>
    </div>
  );
}
