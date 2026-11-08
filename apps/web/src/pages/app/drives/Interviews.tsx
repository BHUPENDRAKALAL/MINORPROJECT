import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Field } from "../../../components/form";
import { useApiForm } from "../../../components/useApiForm";
import { Alert, EmptyState, Saved, Tile } from "../../../components/ui";
import { interviewsApi, type FeedbackItem, type PanelPerson, type PanelSummary } from "../../../lib/api";
import { useTitle } from "../../../lib/useTitle";
import { when } from "./format";

/** On the round page: the round's panels, adding one, and putting students into the lines. */
export function PanelsSetup({ roundId, running, over }: { roundId: string; running: boolean; over: boolean }) {
  const [panels, setPanels] = useState<PanelSummary[] | null>(null);
  const [people, setPeople] = useState<PanelPerson[]>([]);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const form = useApiForm();
  const run = form.run;

  const load = useCallback(
    () =>
      void run(async () => {
        const [p, pp] = await Promise.all([interviewsApi.panels(roundId), interviewsApi.people(roundId)]);
        setPanels(p.panels);
        setPeople(pp.people);
      }),
    [roundId, run],
  );
  useEffect(load, [load]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void interviewsApi.panels(roundId).then((p) => setPanels(p.panels), () => undefined), 8000);
    return () => clearInterval(t);
  }, [roundId, running]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    await form.run(
      async () => {
        setPanels((await interviewsApi.addPanel(roundId, { name: name.trim(), location: location.trim() || null, memberIds: members })).panels);
        setName(`Panel ${String.fromCharCode(66 + (panels?.length ?? 0))}`);
        setLocation("");
        setMembers([]);
      },
      name.trim() ? undefined : { name: "Give the panel a name, e.g. Panel A." },
    );
  }

  if (!panels) return form.error ? <Alert>{form.error}</Alert> : null;
  const inLine = panels.reduce((a, p) => a + p.counts.total, 0);

  return (
    <section className="cy-section">
      <div className="section-head">
        <h2>Interview panels</h2>
        <span className="pill">{panels.length}</span>
        {running && panels.length > 0 && (
          <div className="cy-round-tools">
            <button
              type="button"
              className="primary"
              disabled={form.busy}
              onClick={() =>
                void form.run(async () => {
                  const r = await interviewsApi.buildLine(roundId);
                  setPanels(r.panels);
                  setMsg(r.added ? `Added ${r.added} student${r.added === 1 ? "" : "s"} to the lines.` : "Everyone in the round is already in a line.");
                })
              }
            >
              {inLine ? "Add late arrivals to the lines" : "Make the interview lines"}
            </button>
          </div>
        )}
      </div>
      {form.error && <Alert>{form.error}</Alert>}
      {msg && <Saved>{msg}</Saved>}
      <p className="faint small">
        Each panel interviews its own line of students. "Make the interview lines" splits the round's students evenly
        {running ? " (only those who checked in, if check-in was used)" : ""}. Interviewers open their panel from "My panels" after signing in.
      </p>

      {panels.length > 0 && (
        <ul className="cy-cards">
          {panels.map((p) => (
            <li key={p.id}>
              <div className="panel cy-card">
                <span className="cy-card-top">
                  <strong className="cy-card-title">{p.name}</strong>
                  {p.location && <span className="faint small">{p.location}</span>}
                </span>
                <span className="small">{p.members.length ? p.members.map((m) => m.name ?? m.email).join(", ") : "No interviewer added (HR can run it)"}</span>
                <span className="cy-card-figures small">
                  <span>{p.counts.waiting} waiting</span>
                  <span>{p.counts.live ? "1 in the room" : "room free"}</span>
                  <span>{p.counts.done} done</span>
                  {p.counts.absent > 0 && <span>{p.counts.absent} absent</span>}
                  <span>~{p.avgMinutes} min each</span>
                </span>
                <span className="buttons">
                  <Link className="button" to={`/panel/${p.id}`}>
                    Open panel
                  </Link>
                  {p.counts.total === 0 && !over && (
                    <button type="button" className="quiet" onClick={() => void form.run(async () => setPanels((await interviewsApi.removePanel(p.id)).panels))}>
                      Remove
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!over && (
        <form className="panel stack cy-wide cy-add-panel" onSubmit={add} noValidate>
          <p className="cy-h3">Add a panel</p>
          <div className="cy-grid">
            <Field label="Panel name" value={name} placeholder={`Panel ${String.fromCharCode(65 + panels.length)}`} onChange={(e) => setName(e.target.value)} error={form.fieldErrors.name} />
            <Field label="Room" value={location} placeholder="e.g. Room 204" onChange={(e) => setLocation(e.target.value)} />
          </div>
          <fieldset className="cy-fieldset">
            <legend>Interviewers</legend>
            {people.length ? (
              <div className="cy-chips">
                {people.map((p) => (
                  <label key={p.id} className="cy-check">
                    <input type="checkbox" checked={members.includes(p.id)} onChange={(e) => setMembers((x) => (e.target.checked ? [...x, p.id] : x.filter((k) => k !== p.id)))} /> {p.name ?? p.email}
                    <span className="faint small">({p.role === "HR" ? "HR" : "interviewer"})</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="faint small">No one yet. HR can invite interviewers from the Team page.</p>
            )}
          </fieldset>
          <div className="buttons">
            <button type="submit" disabled={form.busy}>
              Add panel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** The interviewer's home: panels they sit on today. */
export function MyPanels() {
  useTitle("My panels");
  const [data, setData] = useState<Awaited<ReturnType<typeof interviewsApi.myPanels>> | null>(null);
  const form = useApiForm();
  const run = form.run;
  useEffect(() => void run(async () => setData(await interviewsApi.myPanels())), [run]);
  return (
    <>
      <header className="page-head">
        <div className="section-head">
          <Tile icon="panel" family="orchid" />
          <h1 className="title">My panels</h1>
        </div>
        <p className="lead">Panels you sit on. Open one on interview day to call students and write notes.</p>
      </header>
      {form.error && <Alert>{form.error}</Alert>}
      {data && !data.panels.length && (
        <EmptyState sprite="reviewer" family="orchid">
          You're not on a panel right now. HR adds you to a panel before interview day.
        </EmptyState>
      )}
      {data && data.panels.length > 0 && (
        <ul className="cy-cards">
          {data.panels.map((p) => (
            <li key={p.id}>
              <Link className="panel cy-card" to={`/panel/${p.id}`}>
                <span className="cy-card-top">
                  <span className="faint small">{p.round.company}</span>
                  <span className={`stage ${p.round.status === "SCHEDULED" ? "waiting" : "working fam-azure"}`}>{p.round.status === "SCHEDULED" ? "Not started" : "Running"}</span>
                </span>
                <strong className="cy-card-title">
                  {p.name}
                  {p.location ? ` · ${p.location}` : ""}
                </strong>
                <span className="small">
                  {p.round.roleTitle} · {p.round.title} · {when(p.round.startsAt)}
                </span>
                <span className="cy-card-figures small">
                  <span>{p.waiting} waiting</span>
                  <span>{p.done} done</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** HR's team: colleagues and interviewers, and inviting a new interviewer. */
export function CompanyTeam() {
  useTitle("Team");
  const [data, setData] = useState<Awaited<ReturnType<typeof interviewsApi.companyTeam>> | null>(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const list = useApiForm();
  const form = useApiForm();
  const runList = list.run;
  const load = useCallback(() => void runList(async () => setData(await interviewsApi.companyTeam())), [runList]);
  useEffect(load, [load]);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setSent(null);
    await form.run(
      async () => {
        await interviewsApi.inviteInterviewer(email.trim());
        setSent(`Invite sent to ${email.trim()}. They set a password from the email link.`);
        setEmail("");
        load();
      },
      email.trim() ? undefined : { email: "Enter their email." },
    );
  }

  return (
    <>
      <header className="page-head">
        <h1 className="title">Team</h1>
        <p className="lead">{data ? `${data.company}: people` : "People"} who can sit on interview panels.</p>
      </header>
      <section className="cy-section">
        <div className="section-head">
          <h2>Invite an interviewer</h2>
        </div>
        <form className="stack panel cy-wide" onSubmit={invite} noValidate>
          {sent && <Saved>{sent}</Saved>}
          {form.error && form.errorCode !== "LOCAL_VALIDATION" && <Alert>{form.error}</Alert>}
          <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={form.fieldErrors.email} hint="A colleague from your company. They can only run panels you add them to." />
          <div className="buttons">
            <button className="primary" type="submit" disabled={form.busy}>
              Send invite
            </button>
          </div>
        </form>
      </section>
      <section className="cy-section">
        <div className="section-head">
          <h2>Members</h2>
        </div>
        {list.error && <Alert>{list.error}</Alert>}
        {data && (
          <div className="scroll">
            <table className="cy-table">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Role</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.name ?? m.email}
                      <br />
                      <span className="faint small">{m.email}</span>
                    </td>
                    <td>{m.role === "HR" ? "HR" : "Interviewer"}</td>
                  </tr>
                ))}
                {data.invites.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.email}
                      <br />
                      <span className="stage waiting">Invite sent</span>
                    </td>
                    <td>{i.role === "INTERVIEWER" ? "Interviewer" : "HR"}</td>
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

const FB_STATUS: Record<FeedbackItem["status"], [string, string]> = {
  PENDING_REVIEW: ["Waiting for you", "waiting fam-sun"],
  RELEASED: ["Sent to the student", "done fam-lime"],
  EDITED_AND_RELEASED: ["Reworded and sent", "done fam-lime"],
  WITHHELD: ["Not sent", "idle"],
};

/** TPO: remarks panels wrote for students, checked before the student sees them. */
export function FeedbackReview({ driveId }: { driveId: string }) {
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const form = useApiForm();
  const run = form.run;
  useEffect(() => void run(async () => setItems((await interviewsApi.feedback(driveId)).feedback)), [driveId, run]);
  if (!items) return form.error ? <Alert>{form.error}</Alert> : null;
  if (!items.length) return <p className="faint">No remarks from the panels yet.</p>;
  const decide = (id: string, action: "RELEASE" | "WITHHOLD") => void form.run(async () => setItems((await interviewsApi.reviewFeedback(id, { action, text: action === "RELEASE" ? (edits[id] ?? null) : null })).feedback));
  return (
    <div className="stack cy-wide">
      {form.error && <Alert>{form.error}</Alert>}
      <p className="faint small">Interviewers' remarks reach the student only after you send them. Reword anything unkind or unclear; private notes are never shown to students.</p>
      {items.map((f) => {
        const [label, tone] = FB_STATUS[f.status];
        return (
          <div key={f.id} className="panel stack cy-feedback">
            <div className="cy-card-top">
              <span>
                <strong>{f.student.name}</strong> <span className="faint small">{f.student.rollNo}</span>
              </span>
              <span className={`stage ${tone}`}>{label}</span>
            </div>
            <p className="faint small">
              {f.round ?? "Interview"} · by {f.author ?? "a panel member"}
            </p>
            {f.status === "PENDING_REVIEW" ? (
              <>
                <textarea aria-label={`Remark for ${f.student.name}`} rows={3} value={edits[f.id] ?? f.text} onChange={(e) => setEdits((x) => ({ ...x, [f.id]: e.target.value }))} />
                <div className="buttons">
                  <button type="button" className="primary" disabled={form.busy} onClick={() => decide(f.id, "RELEASE")}>
                    Send to the student
                  </button>
                  <button type="button" disabled={form.busy} onClick={() => decide(f.id, "WITHHOLD")}>
                    Don't send
                  </button>
                </div>
              </>
            ) : (
              <p className="small cy-pre">{f.releasedText ?? f.text}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
