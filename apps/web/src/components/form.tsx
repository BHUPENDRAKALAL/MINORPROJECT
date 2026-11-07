// Adapted from Foundry (Apache-2.0), see src/vendor/foundry/LICENSE
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

interface FieldShell {
  label: string;
  error?: string;
  hint?: ReactNode;
}

/** Foundry's .field: a label, the control, then a hint or the error for that field. */
export function Field({ label, error, hint, id, ...input }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const inputId = id ?? auto;
  const noteId = `${inputId}-note`;
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? noteId : undefined}
        {...input}
      />
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
  children,
  ...select
}: FieldShell & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId();
  const selectId = id ?? auto;
  const noteId = `${selectId}-note`;
  return (
    <div className="field">
      <label htmlFor={selectId}>{label}</label>
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
