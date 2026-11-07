import { useCallback, useState } from "react";
import { ApiError, NETWORK_ERROR_MESSAGE } from "../lib/api";

export type FieldErrors = Record<string, string>;

/**
 * Busy flag, one form-level message and per-field messages for a form that calls the API.
 * `run` catches ApiError and spreads `details.issues[].path/message` onto the fields.
 */
export function useApiForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const run = useCallback(async (fn: () => Promise<void>, localErrors?: FieldErrors) => {
    if (localErrors && Object.keys(localErrors).length) {
      setFieldErrors(localErrors);
      setError("Please fix the fields marked below.");
      setErrorCode("LOCAL_VALIDATION");
      return;
    }
    setBusy(true);
    setError(null);
    setErrorCode(null);
    setFieldErrors({});
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        const fields = e.fieldErrors;
        setFieldErrors(fields);
        setError(e.message);
        setErrorCode(e.code);
      } else {
        setError(NETWORK_ERROR_MESSAGE);
        setErrorCode("UNKNOWN");
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const clearField = useCallback((name: string) => {
    setFieldErrors((f) => {
      if (!(name in f)) return f;
      const next = { ...f };
      delete next[name];
      return next;
    });
  }, []);

  return { busy, error, errorCode, fieldErrors, run, clearField, setError };
}
