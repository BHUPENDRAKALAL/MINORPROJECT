import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "../../app/useAuth";
import { Field } from "../../components/form";
import { useApiForm } from "../../components/useApiForm";
import { Alert } from "../../components/ui";
import { ApiError, authApi, type InviteInfo } from "../../lib/api";
import { APP_NAME } from "../../lib/brand";
import { PASSWORD_HINT, ROLE_LABELS, passwordProblem } from "../../lib/constants";
import { AuthLayout, ResultPanel } from "./AuthLayout";

type Load = { state: "loading" } | { state: "ok"; invite: InviteInfo } | { state: "bad"; message: string };

export default function AcceptInvite() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const form = useApiForm();

  useEffect(() => {
    let alive = true;
    authApi
      .getInvite(token)
      .then((invite) => alive && setLoad({ state: "ok", invite }))
      .catch((e: unknown) => {
        if (!alive) return;
        setLoad({
          state: "bad",
          message:
            e instanceof ApiError && e.code !== "VALIDATION_FAILED"
              ? e.message
              : e instanceof ApiError
                ? "This invite link is not valid. Ask the person who invited you to send a new one."
                : "We couldn't open this invite. Check your connection and try again.",
        });
      });
    return () => {
      alive = false;
    };
  }, [token]);

  if (load.state === "loading") {
    return (
      <AuthLayout title="Opening your invite" sprite="smith">
        <p className="lead" role="status">
          Checking the link…
        </p>
      </AuthLayout>
    );
  }

  if (load.state === "bad") {
    return (
      <AuthLayout title="This invite can't be used" sprite={null} family="ember">
        <ResultPanel sticker="blocked" title="Link not valid" actions={<Link className="button" to="/sign-in">Go to sign in</Link>}>
          {load.message}
        </ResultPanel>
      </AuthLayout>
    );
  }

  const { invite } = load;
  const roleLabel = ROLE_LABELS[invite.role] ?? invite.role;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!invite.hasAccount) {
      if (name.trim().length < 2) errs.name = "Enter your full name.";
      const p = passwordProblem(pw);
      if (p) errs.password = p;
      else if (pw !== pw2) errs.confirm = "The two passwords don't match.";
    } else if (!pw) errs.password = "Enter your password.";
    await form.run(async () => {
      const tokens = await authApi.acceptInvite(token, invite.hasAccount ? { password: pw } : { name: name.trim(), password: pw });
      await signIn(tokens);
      navigate("/", { replace: true });
    }, errs);
  }

  return (
    <AuthLayout
      title={`Join ${APP_NAME}`}
      lead={
        <>
          You've been invited as <strong>{roleLabel}</strong>
          {invite.companyName ? (
            <>
              {" "}for <strong>{invite.companyName}</strong>
            </>
          ) : null}
          . {invite.hasAccount ? "Enter your password to add this role to your account." : "Choose a name and password to create your account."}
        </>
      }
      sprite="wave"
      family="orchid"
    >
      {form.error && <Alert>{form.error}</Alert>}
      <form className="stack" onSubmit={onSubmit} noValidate>
        <Field label="Email" type="email" value={invite.email} readOnly disabled />
        {!invite.hasAccount && (
          <Field label="Full name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={form.fieldErrors.name} />
        )}
        <Field
          label={invite.hasAccount ? "Your password" : "Choose a password"}
          type="password"
          autoComplete={invite.hasAccount ? "current-password" : "new-password"}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          error={form.fieldErrors.password}
          hint={invite.hasAccount ? undefined : PASSWORD_HINT}
        />
        {!invite.hasAccount && (
          <Field label="Type it again" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} error={form.fieldErrors.confirm} />
        )}
        <button className="primary button-wide" type="submit" disabled={form.busy}>
          {form.busy ? "Joining…" : "Accept invite"}
        </button>
      </form>
      {invite.hasAccount && (
        <p className="auth-links">
          <Link to="/forgot-password">Forgot your password?</Link>
        </p>
      )}
    </AuthLayout>
  );
}
