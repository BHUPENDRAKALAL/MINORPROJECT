// Adapted from Foundry (Apache-2.0), see src/vendor/foundry/LICENSE
import { useContext, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { CaretBuddyContext } from "../lib/caretBuddy";
import { passwordStrength } from "../lib/password";
import { CaretBuddy } from "./CaretBuddy";

interface FieldShell {
  label: string;
  error?: string;
  hint?: ReactNode;
  /** How wide the field is, by what goes in it: xs 120 (a number), sm 180 (a year, a date), md 280, lg 420. Default: the whole row. */
  size?: "xs" | "sm" | "md" | "lg";
  /** Shows "(optional)" after the label. */
  optional?: boolean;
}

function fieldClass(size?: FieldShell["size"]) {
  return size ? `field f-${size}` : "field";
}

function FieldLabel({ htmlFor, label, optional }: { htmlFor: string; label: string; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor}>
      {label}
      {optional && <> <span className="field-optional">(optional)</span></>}
    </label>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      {!open && <path d="M2.5 13.5l11-11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
    </svg>
  );
}

/**
 * Foundry's .field: a label, the control, then a hint or the error for that field.
 * Password fields get a show/hide button inside the field and a quiet "Caps Lock is on" note.
 */
export function Field({ label, error, hint, id, size, optional, type, onKeyUp, onKeyDown, onBlur, ...input }: FieldShell & Omit<InputHTMLAttributes<HTMLInputElement>, "size">) {
  const auto = useId();
  const inputId = id ?? auto;
  const noteId = `${inputId}-note`;
  const buddy = useContext(CaretBuddyContext);
  const ref = useRef<HTMLInputElement>(null);
  const secret = type === "password";
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const watchCaps = (e: KeyboardEvent<HTMLInputElement>) => secret && setCaps(e.getModifierState("CapsLock"));
  const control = (
    <input
      ref={ref}
      id={inputId}
      type={secret && shown ? "text" : type}
      aria-invalid={error ? true : undefined}
      aria-describedby={error || hint ? noteId : undefined}
      onKeyUp={(e) => (watchCaps(e), onKeyUp?.(e))}
      onKeyDown={(e) => (watchCaps(e), onKeyDown?.(e))}
      onBlur={(e) => (setCaps(false), onBlur?.(e))}
      {...input}
    />
  );
  const wrapped = buddy || secret;
  return (
    <div className={fieldClass(size)}>
      <FieldLabel htmlFor={inputId} label={label} optional={optional} />
      {wrapped ? (
        <div className={`field-control${buddy ? " has-buddy" : ""}${secret ? " has-reveal" : ""}`}>
          {control}
          {buddy && <CaretBuddy input={ref} sprite={buddy} />}
          {secret && (
            <button
              type="button"
              className="field-reveal"
              aria-label={shown ? "Hide password" : "Show password"}
              aria-pressed={shown}
              aria-controls={inputId}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShown((s) => !s)}
            >
              <EyeIcon open={shown} />
            </button>
          )}
        </div>
      ) : (
        control
      )}
      {caps && (
        <p className="field-caps" role="status">
          Caps Lock is on
        </p>
      )}
      {error ? (
        <p className="field-error" id={noteId}>
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={noteId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField({
  label,
  error,
  hint,
  id,
  size,
  optional,
  children,
  ...select
}: FieldShell & Omit<SelectHTMLAttributes<HTMLSelectElement>, "size">) {
  const auto = useId();
  const selectId = id ?? auto;
  const noteId = `${selectId}-note`;
  return (
    <div className={fieldClass(size)}>
      <FieldLabel htmlFor={selectId} label={label} optional={optional} />
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? noteId : undefined}
        {...select}
      >
        {children}
      </select>
      {error ? (
        <p className="field-error" id={noteId}>
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={noteId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Shown under a new-password field: four bars, a one-word verdict and the one change that helps most. */
export function PasswordMeter({ value }: { value: string }) {
  const s = passwordStrength(value);
  return (
    <span className={`pw-meter pw-${s.score}`}>
      <span className="pw-bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      <span className="pw-words" aria-live="polite">
        {s.label && <strong>{s.label}. </strong>}
        {s.tip}
      </span>
    </span>
  );
}

/** A multi-line text field with the same label, help and error as Field. */
export function TextField({ label, error, hint, id, optional, ...area }: Omit<FieldShell, "size"> & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId();
  const areaId = id ?? auto;
  const noteId = `${areaId}-note`;
  return (
    <div className="field">
      <FieldLabel htmlFor={areaId} label={label} optional={optional} />
      <textarea id={areaId} aria-invalid={error ? true : undefined} aria-describedby={error || hint ? noteId : undefined} {...area} />
      {error ? (
        <p className="field-error" id={noteId}>
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={noteId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** One block of a longer form: a title and a line of explanation on the left, the fields on the right. */
export function FormSection({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="form-section">
      <div className="form-section-head">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      <div className="form-section-body">{children}</div>
    </section>
  );
}
