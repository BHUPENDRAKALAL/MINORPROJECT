import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../../app/useAuth";
import { Field } from "../../components/form";
import { useApiForm } from "../../components/useApiForm";
import { Alert } from "../../components/ui";
import { authApi } from "../../lib/api";
import { AuthLayout, ResultPanel } from "./AuthLayout";

const RESEND_WAIT = 60;

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [wait, setWait] = useState(params.get("sent") ? RESEND_WAIT : 0);
  const [resent, setResent] = useState(false);
  const [done, setDone] = useState(false);
  const form = useApiForm();

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!email.trim()) errs.email = "Enter the email you signed up with.";
    if (!/^\d{6}$/.test(code)) errs.code = "The code has 6 digits.";
    await form.run(async () => {
      const tokens = await authApi.verifyEmail(email.trim(), code);
      await signIn(tokens);
      setDone(true);
    }, errs);
  }

  async function resend() {
    if (!email.trim()) {
      form.setError("Enter your email first, then ask for a new code.");
      return;
    }
    setWait(RESEND_WAIT);
    setResent(false);
    try {
      await authApi.resendCode(email.trim());
      setResent(true);
    } catch {
      // 202 is always returned; a network problem shows on the next try.
    }
  }

  if (done) {
    return (
      <AuthLayout title="Email confirmed" sprite={null}>
        <ResultPanel
          sticker="celebrate"
          title="You're in!"
          actions={
            <button className="primary" type="button" onClick={() => navigate("/", { replace: true })}>
              Go to my home
            </button>
          }
        >
          Your account is ready. Next, complete your profile so the placement office can verify it.
        </ResultPanel>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Check your email"
      lead={
        email ? (
          <>
            We sent a 6-digit code to <strong>{email}</strong>. It may take a minute to arrive.
          </>
        ) : (
          "Enter the email you signed up with and the 6-digit code we sent you."
        )
      }
      sprite="ask"
    >
      {form.error && <Alert>{form.error}</Alert>}
      {resent && !form.error && <p className="alert alert-done" role="status">A new code is on its way.</p>}
      <form className="stack" onSubmit={onSubmit} noValidate>
        {!params.get("email") && (
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={form.fieldErrors.email}
          />
        )}
        <Field
          label="6-digit code"
          className="code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          error={form.fieldErrors.code}
          autoFocus
        />
        <button className="primary button-wide" type="submit" disabled={form.busy || code.length !== 6} aria-busy={form.busy}>
          {form.busy ? "Checking…" : "Confirm email"}
        </button>
      </form>
      <p className="auth-links">
        <button type="button" className="quiet" onClick={() => void resend()} disabled={wait > 0}>
          {wait > 0 ? `Send a new code in ${wait} s` : "Send a new code"}
        </button>
        <Link to="/sign-in">Back to sign in</Link>
      </p>
    </AuthLayout>
  );
}
