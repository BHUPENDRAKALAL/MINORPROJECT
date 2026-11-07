import { useState, type FormEvent } from "react";
import { Field } from "../../components/form";
import { useApiForm } from "../../components/useApiForm";
import { Alert, Saved } from "../../components/ui";
import { meApi } from "../../lib/api";
import { PASSWORD_HINT, passwordProblem } from "../../lib/constants";
import { useTitle } from "../../lib/useTitle";

export default function ChangePassword() {
  useTitle("Change password");
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
    <>
      <header className="page-head">
        <h1 className="title">Change password</h1>
        <p className="lead">You stay signed in here. Other devices are signed out when you save.</p>
      </header>
      {saved && <Saved>Your password is changed.</Saved>}
      {form.error && <Alert>{form.error}</Alert>}
      <form className="stack panel" onSubmit={onSubmit} noValidate>
        <Field
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          error={form.fieldErrors.currentPassword ?? (form.errorCode === "WRONG_PASSWORD" ? form.error ?? undefined : undefined)}
        />
        <Field label="New password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} error={form.fieldErrors.newPassword} hint={PASSWORD_HINT} />
        <Field label="Type it again" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} error={form.fieldErrors.confirm} />
        <div className="buttons">
          <button className="primary" type="submit" disabled={form.busy}>
            {form.busy ? "Saving…" : "Save new password"}
          </button>
        </div>
      </form>
    </>
  );
}
