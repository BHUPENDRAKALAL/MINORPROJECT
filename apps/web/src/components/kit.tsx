/**
 * Cyrus UI kit: the few building blocks every list page uses, so pages look and read alike.
 *
 * Rules (see styles in ui.css):
 *  - Neutral surfaces; the primary colour is for actions only.
 *  - Status colour lives in a small dot, never in a big block. Words carry the meaning.
 *  - One loud thing per page at most (a Callout), and only when someone has to act.
 *  - Lists are rows in one panel with aligned columns, not cards: easy to scan and compare.
 */
import type { ReactNode } from "react";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

/** Title, one plain sentence about the page, and the page's main actions on the right. */
export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="ui-head">
      <div className="ui-head-text">
        {eyebrow && <p className="ui-eyebrow">{eyebrow}</p>}
        <h1 className="ui-title">{title}</h1>
        {description && <p className="ui-desc">{description}</p>}
      </div>
      {actions && <div className="ui-head-actions">{actions}</div>}
    </header>
  );
}

/** Underline tabs that filter the list below; each shows how many items it holds. */
export function FilterTabs<K extends string>({ items, value, onChange, label }: { items: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div className="ui-tabs" role="tablist" aria-label={label}>
      {items.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={t.key === value} className="ui-tab" onClick={() => onChange(t.key)}>
          {t.label}
          {t.count !== undefined && <span className="ui-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** A quiet strip for the one thing that needs someone's action. */
export function Callout({ tone = "warning", title, children, action }: { tone?: Tone; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`ui-callout tone-${tone}`} role="status">
      <span className="ui-callout-dot" aria-hidden="true" />
      <div className="ui-callout-text">
        <p className="ui-callout-title">{title}</p>
        {children && <p className="ui-callout-body">{children}</p>}
      </div>
      {action && <div className="ui-callout-action">{action}</div>}
    </div>
  );
}

/** Status in words with a small coloured dot. */
export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`ui-badge tone-${tone}`} title={title}>
      <span className="ui-badge-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

/** A plain label (no dot): kinds, branches, small facts. */
export function Tag({ children }: { children: ReactNode }) {
  return <span className="ui-tag">{children}</span>;
}

/** Steps done out of a total, as thin segments (e.g. rounds of a drive). */
export function Steps({ done, total, current, label }: { done: number; total: number; current?: boolean; label: string }) {
  if (!total) return <span className="ui-muted">No rounds yet</span>;
  return (
    <span className="ui-steps" role="img" aria-label={label}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`ui-step${i < done ? " is-done" : i === done && current ? " is-now" : ""}`} />
      ))}
    </span>
  );
}

/** A labelled number for side panels. */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="ui-stat">
      <span className="ui-stat-label">{label}</span>
      <span className="ui-stat-value">{value}</span>
      {hint && <span className="ui-stat-hint">{hint}</span>}
    </div>
  );
}

/** A titled side-panel box. */
export function Aside({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="ui-aside">
      <div className="ui-aside-head">
        <h2 className="ui-aside-title">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
