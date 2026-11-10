import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import type { Role } from "@cyrus/shared";
import { useAuth } from "../../app/useAuth";
import { homeFor } from "../../app/nav";
import { useTheme, setTheme } from "../../app/theme";
import { Badge, PageHeader } from "../../components/kit";
import { Field } from "../../components/form";
import { useApiForm } from "../../components/useApiForm";
import { Avatar } from "../../components/ui";
import { meApi } from "../../lib/api";
import { ROLE_LABELS } from "../../lib/constants";
import { useTitle } from "../../lib/useTitle";
import { PasswordForm } from "./ChangePassword";

/** What each role can do, in one line, so people know why they see what they see. */
const ROLE_HELP: Record<Role, string> = {
  TPO: "Runs placements: approves drives and companies, manages the review team, decides escalations.",
  STAFF: "Checks student profiles and marks change requests in the review queue.",
  VOLUNTEER: "Does first checks of student profiles; a staff member checks again.",
  COORDINATOR: "Helps on drive day: attendance and interview lines.",
  COMPANY_HR: "Creates drives for the company, runs rounds, sends offers.",
  INTERVIEWER: "Runs an interview panel and writes the key points for each student.",
  STUDENT: "Joins drives they're invited to and follows each round.",
  PLACED_SENIOR: "Helps juniors with questions and interview experiences.",
};

function Section({ id, title, description, children }: { id?: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="ui-setting">
      <div className="ui-setting-text">
        <h2 className="ui-setting-title">{title}</h2>
        {description && <p className="ui-setting-desc">{description}</p>}
      </div>
      <div className="ui-setting-body">{children}</div>
    </section>
  );
}

/** Everyone's account page: who you are, your roles, password, appearance, signing out. */
export default function Account() {
  useTitle("Your account");
  const { me, role, setRole, signOut, reloadMe } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const [name, setName] = useState(me?.name ?? "");
  const [saved, setSaved] = useState(false);
  const form = useApiForm();

  useEffect(() => setName(me?.name ?? ""), [me?.name]);
  // /account#password scrolls to the password section (old links point there)
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash]);

  if (!me) return null;
  const display = me.name ?? me.email;
  const company = me.companyMembers[0]?.company.name;

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    await form.run(
      async () => {
        await meApi.updateMe({ name: name.trim() });
        await reloadMe();
        setSaved(true);
      },
      name.trim().length < 2 ? { name: "Enter your name." } : undefined,
    );
  }

  return (
    <>
      <PageHeader eyebrow="Account" title="Your account" description="Your name, the roles this account has, your password and how Cyrus looks for you." />

      <div className="ui-account-card">
        <span className="ui-account-avatar">
          <Avatar name={display} />
        </span>
        <div className="ui-account-who">
          <p className="ui-account-name">{display}</p>
          <p className="ui-account-meta">
            {me.email}
            {me.student && ` · ${me.student.rollNo} · ${me.student.branch} ${me.student.batch}`}
            {company && ` · ${company}`}
          </p>
        </div>
        <div className="ui-account-roles">
          {me.roles.map((r) => (
            <Badge key={r} tone={r === role ? "success" : "neutral"}>
              {ROLE_LABELS[r]}
            </Badge>
          ))}
        </div>
      </div>

      <Section title="Name" description="Shown to the placement office, interviewers and companies.">
        <form className="ui-form ui-form-inline" onSubmit={saveName} noValidate>
          <Field label="Full name" size="md" autoComplete="name" value={name} onChange={(e) => (setName(e.target.value), setSaved(false))} error={form.fieldErrors.name} />
          <button type="submit" disabled={form.busy || name.trim() === (me.name ?? "")}>
            {form.busy ? "Saving…" : "Save"}
          </button>
        </form>
        {saved && <p className="ui-ok">Saved.</p>}
      </Section>

      <Section title="Email" description="You sign in with this, and notices are sent here. Ask the placement office to change it.">
        <p className="ui-readonly">{me.email}</p>
      </Section>

      <Section title={me.roles.length > 1 ? "Your roles" : "Your role"} description={me.roles.length > 1 ? "This account has more than one role. Switch to see that role's pages." : undefined}>
        <ul className="ui-role-list">
          {me.roles.map((r) => (
            <li key={r} className={r === role ? "is-current" : ""}>
              <div>
                <p className="ui-role-name">
                  {ROLE_LABELS[r]}
                  {r === role && <span className="ui-muted"> · using now</span>}
                </p>
                <p className="ui-role-help">{ROLE_HELP[r]}</p>
              </div>
              {r !== role ? (
                <button type="button" onClick={() => (setRole(r), navigate(homeFor(r)))}>
                  Switch
                </button>
              ) : (
                <Link className="button quiet" to={homeFor(r)}>
                  Open
                </Link>
              )}
            </li>
          ))}
        </ul>
        {me.student && (
          <p className="ui-muted ui-gap-top">
            Marks, marksheets and resume are on <Link to="/student/profile">My profile</Link>.
          </p>
        )}
      </Section>

      <Section id="password" title="Password" description="At least 8 characters. Saving signs you out on every other device.">
        <PasswordForm />
      </Section>

      <Section title="Appearance" description="Saved on this device.">
        <div className="ui-segmented" role="radiogroup" aria-label="Theme">
          {(["light", "dark"] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={theme === t} onClick={() => setTheme(t)}>
              {t === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Sign out" description="Ends your session on this device.">
        <button type="button" className="ui-danger-button" onClick={() => void signOut().then(() => navigate("/sign-in", { replace: true }))}>
          Sign out
        </button>
      </Section>
    </>
  );
}
