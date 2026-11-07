import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Field, SelectField } from "../../components/form";
import { useApiForm, type FieldErrors } from "../../components/useApiForm";
import { Alert } from "../../components/ui";
import { authApi } from "../../lib/api";
import { BATCH_MAX, BATCH_MIN, BRANCHES, PASSWORD_HINT, passwordProblem } from "../../lib/constants";
import { AuthLayout } from "./AuthLayout";

const thisYear = new Date().getFullYear();

export default function SignUp() {
  const navigate = useNavigate();
  const form = useApiForm();
  const [v, setV] = useState({
    rollNo: "",
    name: "",
    branch: "",
    batch: String(Math.min(BATCH_MAX, Math.max(BATCH_MIN, thisYear + 1))),
    email: "",
    password: "",
  });

  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => {
    setV((old) => ({ ...old, [k]: e.target.value }));
    form.clearField(k);
  };

  function check(): FieldErrors {
    const errs: FieldErrors = {};
    if (!v.rollNo.trim()) errs.rollNo = "Enter your roll number.";
    if (v.name.trim().length < 2) errs.name = "Enter your full name.";
    if (!v.branch) errs.branch = "Pick your branch.";
    const batch = Number(v.batch);
    if (!Number.isInteger(batch) || batch < BATCH_MIN || batch > BATCH_MAX)
      errs.batch = `Enter your graduation year (${BATCH_MIN}–${BATCH_MAX}).`;
    if (!/^\S+@\S+\.\S+$/.test(v.email.trim())) errs.email = "Enter a valid email address.";
    const pw = passwordProblem(v.password);
    if (pw) errs.password = pw;
    return errs;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await form.run(async () => {
      const res = await authApi.signup({
        rollNo: v.rollNo.trim(),
        name: v.name.trim(),
        branch: v.branch,
        batch: Number(v.batch),
        email: v.email.trim(),
        password: v.password,
      });
      navigate(`/verify-email?email=${encodeURIComponent(res.email)}&sent=1`);
    }, check());
  }

  const fe = form.fieldErrors;
  const taken = form.errorCode === "EMAIL_TAKEN" ? { email: form.error ?? "" } : form.errorCode === "ROLL_TAKEN" ? { rollNo: form.error ?? "" } : {};

  return (
    <AuthLayout
      title="Create your student account"
      lead="Use your college details. We'll email you a 6-digit code to confirm it's you."
      sprite="apprentice"
      family="sun"
    >
      {form.error && (
        <Alert>
          {form.error}
          {form.errorCode === "EMAIL_TAKEN" && (
            <>
              {" "}
              <Link to="/sign-in">Sign in instead</Link>
            </>
          )}
        </Alert>
      )}
      <form className="stack" onSubmit={onSubmit} noValidate>
        <Field label="Roll number" autoComplete="off" autoCapitalize="characters" value={v.rollNo} onChange={set("rollNo")} error={fe.rollNo ?? taken.rollNo} required />
        <Field label="Full name" autoComplete="name" value={v.name} onChange={set("name")} error={fe.name} required />
        <div className="field-row">
          <SelectField label="Branch" value={v.branch} onChange={set("branch")} error={fe.branch} required>
            <option value="" disabled>
              Choose…
            </option>
            {BRANCHES.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </SelectField>
          <Field
            label="Graduation year"
            type="number"
            inputMode="numeric"
            min={BATCH_MIN}
            max={BATCH_MAX}
            value={v.batch}
            onChange={set("batch")}
            error={fe.batch}
            required
          />
        </div>
        <Field label="Email" type="email" autoComplete="email" autoCapitalize="none" value={v.email} onChange={set("email")} error={fe.email ?? taken.email} required />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          value={v.password}
          onChange={set("password")}
          error={fe.password}
          hint={PASSWORD_HINT}
          required
        />
        <button className="primary button-wide" type="submit" disabled={form.busy}>
          {form.busy ? "Creating your account…" : "Create account"}
        </button>
      </form>
      <p className="auth-links">
        <span>
          Already registered? <Link to="/sign-in">Sign in</Link>
        </span>
      </p>
    </AuthLayout>
  );
}
