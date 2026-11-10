import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Field, PasswordMeter } from "../../components/form";
import { useApiForm } from "../../components/useApiForm";
import { Alert } from "../../components/ui";
import { authApi } from "../../lib/api";
import { passwordProblem } from "../../lib/constants";
import { AuthLayout, ResultPanel } from "./AuthLayout";

export function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const form = useApiForm();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = /^\S+@\S+\.\S+$/.test(email.trim()) ? {} : { email: "Enter a valid email address." };
    await form.run(async () => {
      await authApi.forgotPassword(email.trim());
      navigate(`/reset-password?email=${encodeURIComponent(email.trim())}&sent=1`);
    }, errs);
  }

  return (
    <AuthLayout title="Forgot your password?" lead="Enter your email. If it has an account, we'll send a 6-digit code to set a new password." sprite="ask">
      {form.error && <Alert>{form.error}</Alert>}
      <form className="stack" onSubmit={onSubmit} noValidate>
        <Field label="Email" type="email" placeholder="name@example.com" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} error={form.fieldErrors.email} />
        <button className="primary button-wide" type="submit" disabled={form.busy} aria-busy={form.busy}>
          {form.busy ? "Sending…" : "Send code"}
        </button>
      </form>
      <p className="auth-links">
        <Link to="/sign-in">Back to sign in</Link>
        <Link to="/reset-password">I already have a code</Link>
      </p>
    </AuthLayout>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [done, setDone] = useState(false);
  const form = useApiForm();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!email.trim()) errs.email = "Enter your email.";
    if (!/^\d{6}$/.test(code)) errs.code = "The code has 6 digits.";
    const p = passwordProblem(pw);
    if (p) errs.newPassword = p;
    else if (pw !== pw2) errs.confirm = "The two passwords don't match.";
    await form.run(async () => {
      await authApi.resetPassword(email.trim(), code, pw);
      setDone(true);
    }, errs);
  }

  if (done) {
    return (
      <AuthLayout title="Password changed" sprite={null}>
        <ResultPanel
          sticker="approved"
          title="All set"
          actions={
            <Link className="button primary" to="/sign-in">
              Sign in
            </Link>
          }
        >
          Your new password is saved. Sign in with it now.
        </ResultPanel>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Set a new password"
      lead={params.get("sent") ? "If that email has an account, a 6-digit code is on its way. Enter it below with your new password." : "Enter the code from your email and choose a new password."}
      sprite="smith"
    >
      {form.error && <Alert>{form.error}</Alert>}
      <form className="stack" onSubmit={onSubmit} noValidate>
        <Field label="Email" type="email" placeholder="name@example.com" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={form.fieldErrors.email} />
        <Field
          label="6-digit code"
          className="code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          error={form.fieldErrors.code}
        />
        <Field label="New password" type="password" placeholder="At least 8 characters" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} error={form.fieldErrors.newPassword} hint={<PasswordMeter value={pw} />} />
        <Field label="Type it again" type="password" placeholder="Same as above" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} error={form.fieldErrors.confirm} />
        <button className="primary button-wide" type="submit" disabled={form.busy} aria-busy={form.busy}>
          {form.busy ? "Saving…" : "Save new password"}
        </button>
      </form>
      <p className="auth-links">
        <Link to="/forgot-password">Send a new code</Link>
        <Link to="/sign-in">Back to sign in</Link>
      </p>
    </AuthLayout>
  );
}
