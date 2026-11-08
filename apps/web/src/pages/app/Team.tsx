import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Field, SelectField } from "../../components/form";
import { useApiForm } from "../../components/useApiForm";
import { Alert, Saved } from "../../components/ui";
import { teamApi, type TeamInvite, type TeamMember } from "../../lib/api";
import { BRANCHES } from "../../lib/constants";
import { useTitle } from "../../lib/useTitle";

const CAPS: { key: string; label: string; staffOnly?: boolean }[] = [
  { key: "verify.first", label: "First check of student profiles" },
  { key: "verify.final", label: "Second checks and marks change requests", staffOnly: true },
  { key: "drive.attendance", label: "Drive-day attendance" },
  { key: "drive.queue", label: "Drive-day interview line" },
];

const scopeText = (s: { branches?: string[]; batches?: number[] } | null) =>
  [s?.branches?.length ? s.branches.join(", ") : "All branches", s?.batches?.length ? s.batches.join(", ") : "all batches"].join(" · ");

export default function Team() {
  useTitle("Team");
  const [data, setData] = useState<{ members: TeamMember[]; invites: TeamInvite[] } | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"STAFF" | "VOLUNTEER">("VOLUNTEER");
  const [caps, setCaps] = useState<string[]>(["verify.first"]);
  const [branches, setBranches] = useState<string[]>([]);
  const [batches, setBatches] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const form = useApiForm();
  const list = useApiForm();

  // `run` is stable; depending on the whole form object re-ran this effect on every render (endless reloads).
  const runList = list.run;
  const load = useCallback(() => void runList(async () => setData(await teamApi.list())), [runList]);
  useEffect(load, [load]);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setSent(null);
    const errs: Record<string, string> = {};
    if (!email.trim()) errs.email = "Enter their email.";
    if (!caps.length) errs.capabilities = "Give at least one permission.";
    await form.run(async () => {
      const batchList = batches.split(",").map((b) => Number(b.trim())).filter((n) => Number.isInteger(n) && n > 2000);
      await teamApi.invite({
        email: email.trim(),
        role,
        capabilities: caps,
        scope: { ...(branches.length ? { branches } : {}), ...(batchList.length ? { batches: batchList } : {}) },
      });
      setSent(`Invite sent to ${email.trim()}. They set a password from the email link.`);
      setEmail("");
      load();
    }, errs);
  }

  return (
    <>
      <header className="page-head">
        <h1 className="title">Team</h1>
        <p className="lead">Staff and student volunteers who help check profiles and run drive days.</p>
      </header>

      <section className="cy-section">
        <div className="section-head">
          <h2>Invite someone</h2>
        </div>
        <form className="stack panel cy-wide" onSubmit={invite} noValidate>
          {sent && <Saved>{sent}</Saved>}
          {form.error && form.errorCode !== "LOCAL_VALIDATION" && <Alert>{form.error}</Alert>}
          <div className="cy-grid">
            <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={form.fieldErrors.email} />
            <SelectField
              label="Role"
              value={role}
              onChange={(e) => {
                const r = e.target.value as "STAFF" | "VOLUNTEER";
                setRole(r);
                if (r === "VOLUNTEER") setCaps((c) => c.filter((k) => k !== "verify.final"));
              }}
            >
              <option value="VOLUNTEER">Student volunteer</option>
              <option value="STAFF">Placement staff</option>
            </SelectField>
          </div>
          <fieldset className="cy-fieldset">
            <legend>What they may do</legend>
            {CAPS.map((c) => (
              <label key={c.key} className="cy-check">
                <input
                  type="checkbox"
                  checked={caps.includes(c.key)}
                  disabled={c.staffOnly && role === "VOLUNTEER"}
                  onChange={(e) => setCaps((x) => (e.target.checked ? [...x, c.key] : x.filter((k) => k !== c.key)))}
                />{" "}
                {c.label}
                {c.staffOnly && <span className="faint small"> (staff only)</span>}
              </label>
            ))}
            {form.fieldErrors.capabilities && <p className="field-error">{form.fieldErrors.capabilities}</p>}
          </fieldset>
          <fieldset className="cy-fieldset">
            <legend>Which students (leave empty for all)</legend>
            <div className="cy-chips">
              {BRANCHES.map(({ value: b }) => (
                <label key={b} className="cy-check">
                  <input type="checkbox" checked={branches.includes(b)} onChange={(e) => setBranches((x) => (e.target.checked ? [...x, b] : x.filter((k) => k !== b)))} /> {b}
                </label>
              ))}
            </div>
            <Field label="Batches" value={batches} onChange={(e) => setBatches(e.target.value)} hint="Graduation years, separated by commas, e.g. 2026, 2027." />
          </fieldset>
          <div className="buttons">
            <button className="primary" type="submit" disabled={form.busy}>
              {form.busy ? "Sending…" : "Send invite"}
            </button>
          </div>
        </form>
      </section>

      <section className="cy-section">
        <div className="section-head">
          <h2>Members</h2>
        </div>
        {list.error && <Alert>{list.error}</Alert>}
        {data && !data.members.length && !data.invites.length && <p className="faint">No one yet. Invite your first staff member or volunteer above.</p>}
        {data && (data.members.length > 0 || data.invites.length > 0) && (
          <div className="scroll">
            <table className="cy-table">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Role</th>
                  <th scope="col">May do</th>
                  <th scope="col">Students</th>
                  <th scope="col">Checked</th>
                  <th scope="col">
                    <span className="hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.userId + m.role}>
                    <td>
                      {m.name ?? m.email}
                      <br />
                      <span className="faint small">{m.email}</span>
                    </td>
                    <td>{m.role === "STAFF" ? "Staff" : "Volunteer"}</td>
                    <td className="small">{m.capabilities.map((c) => CAPS.find((x) => x.key === c)?.label ?? c).join(", ")}</td>
                    <td className="small">{scopeText(m.scope)}</td>
                    <td>
                      {m.tasksDecided}
                      {!m.pledgeAccepted && <span className="faint small"> · pledge pending</span>}
                    </td>
                    <td>
                      <button type="button" className="quiet" onClick={() => void list.run(async () => (await teamApi.remove(m.userId, m.role), load()))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {data.invites.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.email}
                      <br />
                      <span className="stage waiting">Invite sent</span>
                    </td>
                    <td>{i.role === "STAFF" ? "Staff" : "Volunteer"}</td>
                    <td className="small">{i.capabilities.map((c) => CAPS.find((x) => x.key === c)?.label ?? c).join(", ")}</td>
                    <td className="small">{scopeText(i.scope)}</td>
                    <td>—</td>
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
