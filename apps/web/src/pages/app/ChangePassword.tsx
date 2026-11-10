import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { Field, PasswordMeter } from "../../components/form";
import { useApiForm } from "../../components/useApiForm";
import { Alert, Saved } from "../../components/ui";
import { meApi } from "../../lib/api";
import { passwordProblem } from "../../lib/constants";

/** Change password form, used on the account page. Other devices are signed out when it's saved. */
export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [saved, setSaved] = useState(false);
  const form = useApiForm();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const errs: Record<string, string> = {};
    if (!current) errs.currentPassword = "Enter your current password.";
    const p = passwordProblem(pw);
    if (p) errs.newPassword = p;
    else if (pw !== pw2) errs.confirm = "The two passwords don't match.";
    await form.run(async () => {
      await meApi.changePassword(current, pw);
      setSaved(true);
      setCurrent("");
      setPw("");
      setPw2("");
    }, errs);
  }

  return (
    <form className="ui-form" onSubmit={onSubmit} noValidate>
      {saved && <Saved>Your password is changed. Other devices have been signed out.</Saved>}
      {form.error && form.errorCode !== "LOCAL_VALIDATION" && form.errorCode !== "WRONG_PASSWORD" && <Alert>{form.error}</Alert>}
      <Field
        label="Current password"
        size="md"
        type="password"
        autoComplete="current-password"
        placeholder="Your current password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        error={form.fieldErrors.currentPassword ?? (form.errorCode === "WRONG_PASSWORD" ? (form.error ?? undefined) : undefined)}
      />
      <div className="ui-form-row">
        <Field label="New password" size="md" type="password" placeholder="At least 8 characters" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} error={form.fieldErrors.newPassword} hint={<PasswordMeter value={pw} />} />
        <Field label="Type it again" size="md" type="password" placeholder="Same as above" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} error={form.fieldErrors.confirm} />
      </div>
      <div className="buttons">
        <button className="primary" type="submit" disabled={form.busy}>
          {form.busy ? "Saving…" : "Save new password"}
        </button>
      </div>
    </form>
  );
}

/** Old address: the password form now lives on the account page. */
export default function ChangePassword() {
  return <Navigate to="/account#password" replace />;
}
