import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Field, SelectField } from "../../components/form";
import { useApiForm } from "../../components/useApiForm";
import { PageHeader } from "../../components/kit";
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
      <PageHeader title="Team" description="Staff and student volunteers who help check profiles and run drive days." />
      <div className="ui-split rq-split">
        <div className="rq-main">
      <section className="rq-card">
        <div className="rq-card-head">
          <h2>Members</h2>
          <p>Who can check profiles and help on drive days, what each person may do, and which students they see.</p>
        </div>
        {list.error && <Alert>{list.error}</Alert>}
        {data && !data.members.length && !data.invites.length && <p className="rq-empty">No one yet. Invite your first staff member or volunteer.</p>}
        {data && (data.members.length > 0 || data.invites.length > 0) && (
          <div className="scroll">
            <table className="cy-table dd-table">
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
                      <span className="dd-name">{m.name ?? m.email}</span>
                      <span className="dd-roll">{m.email}</span>
                    </td>
                    <td>{m.role === "STAFF" ? "Staff" : "Volunteer"}</td>
                    <td className="small">{m.capabilities.map((c) => CAPS.find((x) => x.key === c)?.label ?? c).join(", ")}</td>
                    <td className="small">{scopeText(m.scope)}</td>
                    <td>
                      {m.tasksDecided}
                      {!m.pledgeAccepted && <span className="faint small"> · pledge pending</span>}
                    </td>
                    <td>
                      <button type="button" className="small sp-remove" onClick={() => void list.run(async () => (await teamApi.remove(m.userId, m.role), load()))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {data.invites.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <span className="dd-name">{i.email}</span>
                      <span className="stage waiting tm-sent">Invite sent</span>
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
        </div>
        <div className="rq-side">
      <section className="rq-decide tm-invite" aria-labelledby="invite-title">
        <h2 id="invite-title">Invite someone</h2>
        <p className="rq-decide-help">They get an email link to set a password. Volunteers are students; staff can do final checks.</p>
        <form className="form tm-form" onSubmit={invite} noValidate>
          {sent && <Saved>{sent}</Saved>}
          {form.error && form.errorCode !== "LOCAL_VALIDATION" && <Alert>{form.error}</Alert>}
          <div className="form-row">
            <Field label="Email" type="email" placeholder="name@mbm.ac.in" value={email} onChange={(e) => setEmail(e.target.value)} error={form.fieldErrors.email} />
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
            <div className="cy-check-list">
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
            </div>
            {form.fieldErrors.capabilities && <p className="field-error">{form.fieldErrors.capabilities}</p>}
          </fieldset>
          <fieldset className="cy-fieldset">
            <legend>
              Which students<span className="field-optional">Leave empty for all</span>
            </legend>
            <div className="cy-chips">
              {BRANCHES.map(({ value: b }) => (
                <label key={b} className="cy-check">
                  <input type="checkbox" checked={branches.includes(b)} onChange={(e) => setBranches((x) => (e.target.checked ? [...x, b] : x.filter((k) => k !== b)))} /> {b}
                </label>
              ))}
            </div>
            <Field label="Batches" optional placeholder="e.g. 2026, 2027" value={batches} onChange={(e) => setBatches(e.target.value)} hint="Graduation years, separated by commas." />
          </fieldset>
          <button className="primary rq-wide" type="submit" disabled={form.busy}>
            {form.busy ? "Sending…" : "Send invite"}
          </button>
        </form>
      </section>

        </div>
      </div>
    </>
  );
}
