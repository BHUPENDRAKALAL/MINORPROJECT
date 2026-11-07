import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "../../app/useAuth";
import { Field } from "../../components/form";
import { useApiForm } from "../../components/useApiForm";
import { Alert } from "../../components/ui";
import { authApi } from "../../lib/api";
import { APP_NAME } from "../../lib/brand";
import { AuthLayout } from "./AuthLayout";

export default function SignIn() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const form = useApiForm();
  const [resending, setResending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await form.run(async () => {
      const tokens = await authApi.login(email.trim(), password);
      await signIn(tokens);
      navigate(from && from !== "/sign-in" ? from : "/", { replace: true });
    });
  }

  async function resend() {
    setResending(true);
    try {
      await authApi.resendCode(email.trim());
    } catch {
      // The verify screen has its own resend button; go there either way.
    }
    setResending(false);
    navigate(`/verify-email?email=${encodeURIComponent(email.trim())}&sent=1`);
  }

  return (
    <AuthLayout title="Sign in" lead={`Welcome back. Sign in to ${APP_NAME} with the email you registered with.`}>
      {form.error && (
        <Alert>
          <span>
            {form.error}
            {form.errorCode === "EMAIL_NOT_VERIFIED" && (
              <>
                {" "}
                <button type="button" className="quiet" onClick={() => void resend()} disabled={resending}>
                  {resending ? "Sending…" : "Send a new code"}
                </button>
              </>
            )}
          </span>
        </Alert>
      )}
      <form className="stack" onSubmit={onSubmit} noValidate>
        <Field
          label="Email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={form.fieldErrors.email}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={form.fieldErrors.password}
        />
        <button className="primary button-wide" type="submit" disabled={form.busy}>
          {form.busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="auth-links">
        <Link to="/forgot-password">Forgot your password?</Link>
        <span>
          New student? <Link to="/sign-up">Create an account</Link>
        </span>
      </p>
    </AuthLayout>
  );
}
