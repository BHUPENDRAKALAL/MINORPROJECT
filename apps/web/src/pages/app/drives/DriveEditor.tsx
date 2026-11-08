import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { JOB_TYPES, type Eligibility, type JobType } from "@cyrus/shared";
import { useAuth } from "../../../app/useAuth";
import { Field, SelectField } from "../../../components/form";
import { useApiForm } from "../../../components/useApiForm";
import { Alert, PageTitle, Saved } from "../../../components/ui";
import { drivesApi, type OfficeDrive, type Round } from "../../../lib/api";
import { BRANCHES } from "../../../lib/constants";
import { useTitle } from "../../../lib/useTitle";
import { RoundBuilder } from "./RoundBuilder";
import { DriveStatusChip, RoundTimeline } from "./shared";
import { drivePaths, eligibilityLines, fromLocalInput, jobLabel, pay, toLocalInput, when } from "./format";

const STEPS = [
  { key: "basics", label: "1. Job details" },
  { key: "eligibility", label: "2. Who can apply" },
  { key: "rounds", label: "3. Rounds" },
  { key: "review", label: "4. Check and send" },
] as const;
type Step = (typeof STEPS)[number]["key"];

const num = (v: string) => (v.trim() === "" ? null : Number(v));

/** New drive (step 1 creates the draft) and editing an existing one, step by step. */
export default function DriveEditor() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const step = (STEPS.find((s) => s.key === params.get("step"))?.key ?? "basics") as Step;
  const { role } = useAuth();
  const paths = drivePaths(role);
  const navigate = useNavigate();
  const [drive, setDrive] = useState<OfficeDrive | null>(null);
  const load = useApiForm();
  useTitle(id ? `Edit drive` : "New drive");

  const runLoad = load.run;
  useEffect(() => {
    if (id) void runLoad(async () => setDrive(await drivesApi.get(id)));
  }, [id, runLoad]);

  const go = (s: Step) => setParams({ step: s });

  if (id && !drive) return load.error ? <Alert>{load.error}</Alert> : null;
  const locked = drive && !drive.can.edit && !drive.can.editRounds;

  return (
    <>
      <header className="page-head">
        <PageTitle trail={[{ label: "Drives", to: paths.list }, ...(drive ? [{ label: drive.roleTitle, to: paths.item(drive.id) }] : [])]} here={id ? "Edit" : "New drive"} />
        {drive && (
          <p className="lead">
            {drive.company.name} · <DriveStatusChip status={drive.status} />
          </p>
        )}
      </header>

      {locked ? (
        <Alert>This drive can't be changed any more.</Alert>
      ) : (
        <>
          <nav className="state-pills" aria-label="Steps">
            {STEPS.map((s) => (
              <button
                key={s.key}
                type="button"
                className="state-pill"
                aria-current={s.key === step ? "step" : undefined}
                disabled={!drive && s.key !== "basics"}
                onClick={() => go(s.key)}
              >
                {s.label}
              </button>
            ))}
          </nav>
          {drive?.rejectionReason && drive.status === "REJECTED" && (
            <div className="banner fam-ember">
              <div className="banner-words">
                <p className="banner-title">The placement office sent this drive back</p>
                <p className="banner-detail">{drive.rejectionReason}</p>
              </div>
            </div>
          )}
          {step === "basics" && (
            <BasicsStep
              drive={drive}
              onSaved={(d, created) => {
                setDrive(d);
                if (created) navigate(paths.edit(d.id, "eligibility"), { replace: true });
                else go("eligibility");
              }}
            />
          )}
          {step === "eligibility" && drive && <EligibilityStep drive={drive} onSaved={(d) => (setDrive(d), go("rounds"))} />}
          {step === "rounds" && drive && <RoundsStep drive={drive} onSaved={(d) => (setDrive(d), go("review"))} />}
          {step === "review" && drive && <ReviewStep drive={drive} onDone={(d) => navigate(paths.item(d.id))} onEdit={go} />}
        </>
      )}
    </>
  );
}

function BasicsStep({ drive, onSaved }: { drive: OfficeDrive | null; onSaved: (d: OfficeDrive, created: boolean) => void }) {
  const { role } = useAuth();
  const tpo = role === "TPO";
  const limited = !!drive && !drive.can.edit && drive.can.editLimited;
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [v, setV] = useState({
    roleTitle: drive?.roleTitle ?? "",
    description: drive?.description ?? "",
    jobType: (drive?.jobType ?? "FULL_TIME") as JobType,
    ctcLpa: drive?.ctcLpa?.toString() ?? "",
    stipendMonthly: drive?.stipendMonthly?.toString() ?? "",
    location: drive?.location ?? "",
    bondMonths: drive?.bondMonths?.toString() ?? "",
    optInDeadline: toLocalInput(drive?.optInDeadline),
  });
  const form = useApiForm();
  const descId = useId();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    if (tpo && !drive) void drivesApi.companies().then((r) => setCompanies(r.companies.filter((c) => c.status === "APPROVED")));
  }, [tpo, drive]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (v.roleTitle.trim().length < 2) errs.roleTitle = "Enter the role.";
    if (tpo && !drive && !companyId && !newCompany.trim()) errs.companyId = "Pick the company or add a new one.";
    const body = limited
      ? { description: v.description, location: v.location || null, optInDeadline: fromLocalInput(v.optInDeadline) }
      : {
          roleTitle: v.roleTitle.trim(),
          description: v.description,
          jobType: v.jobType,
          ctcLpa: num(v.ctcLpa),
          stipendMonthly: num(v.stipendMonthly),
          location: v.location || null,
          bondMonths: num(v.bondMonths),
          optInDeadline: fromLocalInput(v.optInDeadline),
        };
    await form.run(async () => {
      if (drive) return onSaved(await drivesApi.update(drive.id, body), false);
      let cid = companyId || undefined;
      if (tpo && !cid) cid = (await drivesApi.addCompany({ name: newCompany.trim() })).id;
      onSaved(await drivesApi.create({ ...body, roleTitle: v.roleTitle.trim(), companyId: cid }), true);
    }, errs);
  }

  return (
    <form className="stack panel cy-wide" onSubmit={save} noValidate>
      {form.error && <Alert>{form.error}</Alert>}
      {limited && <p className="faint small">The TPO has approved this drive, so only the description, location and joining deadline can change. Students in the drive are told about changes.</p>}
      {tpo && !drive && (
        <div className="cy-grid">
          <SelectField label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} error={form.fieldErrors.companyId}>
            <option value="">Pick a company…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          {!companyId && <Field label="…or add a new company" value={newCompany} onChange={(e) => setNewCompany(e.target.value)} hint="For a company that doesn't use Cyrus." />}
        </div>
      )}
      <div className="cy-grid">
        <Field label="Role" value={v.roleTitle} onChange={set("roleTitle")} error={form.fieldErrors.roleTitle} disabled={limited} placeholder="e.g. Software Engineer" />
        <SelectField label="Type" value={v.jobType} onChange={set("jobType")} disabled={limited}>
          {JOB_TYPES.map((t) => (
            <option key={t} value={t}>
              {jobLabel(t)}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="cy-grid">
        {v.jobType !== "INTERNSHIP" && <Field label="CTC (lakh per year)" type="number" step="0.1" min="0" value={v.ctcLpa} onChange={set("ctcLpa")} error={form.fieldErrors.ctcLpa} disabled={limited} />}
        {v.jobType !== "FULL_TIME" && (
          <Field label="Stipend (₹ per month)" type="number" min="0" value={v.stipendMonthly} onChange={set("stipendMonthly")} error={form.fieldErrors.stipendMonthly} disabled={limited} />
        )}
        <Field label="Bond (months)" type="number" min="0" value={v.bondMonths} onChange={set("bondMonths")} hint="Leave empty or 0 if there is no bond." disabled={limited} />
        <Field label="Location" value={v.location} onChange={set("location")} placeholder="e.g. Jaipur, Remote" />
      </div>
      <Field
        label="Last date for students to join"
        type="datetime-local"
        value={v.optInDeadline}
        onChange={set("optInDeadline")}
        error={form.fieldErrors.optInDeadline}
        hint="Invited students answer Join or Skip before this."
      />
      <div className="field">
        <label htmlFor={descId}>Job description</label>
        <textarea id={descId} rows={6} maxLength={8000} value={v.description} onChange={set("description")} placeholder="What the job is, the skills needed, training, where they will work." />
        {form.fieldErrors.description && <p className="field-error">{form.fieldErrors.description}</p>}
      </div>
      <div className="buttons">
        <button className="primary" type="submit" disabled={form.busy}>
          {form.busy ? "Saving…" : drive ? "Save and continue" : "Create draft and continue"}
        </button>
      </div>
    </form>
  );
}

function EligibilityStep({ drive, onSaved }: { drive: OfficeDrive; onSaved: (d: OfficeDrive) => void }) {
  const locked = !drive.can.edit;
  const e0 = drive.eligibility;
  const [branches, setBranches] = useState<string[]>(e0.branches ?? []);
  const [batches, setBatches] = useState((e0.batches ?? []).join(", "));
  const [v, setV] = useState({
    minCgpa: e0.minCgpa?.toString() ?? "",
    maxActiveBacklogs: e0.maxActiveBacklogs?.toString() ?? "",
    minTenth: e0.minTenth?.toString() ?? "",
    minTwelfth: e0.minTwelfth?.toString() ?? "",
  });
  const [count, setCount] = useState<number | null>(null);
  const form = useApiForm();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  const eligibility = useCallback((): Eligibility => {
    const out: Eligibility = {};
    if (branches.length) out.branches = branches;
    const b = batches.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 2000);
    if (b.length) out.batches = b;
    for (const k of ["minCgpa", "maxActiveBacklogs", "minTenth", "minTwelfth"] as const) {
      const n = num(v[k]);
      if (n != null && !Number.isNaN(n)) out[k] = n;
    }
    return out;
  }, [branches, batches, v]);

  // Live count of matching students, a moment after the filters stop changing.
  useEffect(() => {
    const t = setTimeout(() => {
      drivesApi.preview(drive.id, eligibility()).then((r) => setCount(r.count), () => setCount(null));
    }, 350);
    return () => clearTimeout(t);
  }, [drive.id, eligibility]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (locked) return onSaved(drive);
    await form.run(async () => onSaved(await drivesApi.update(drive.id, { eligibility: eligibility() })));
  }

  return (
    <form className="stack panel cy-wide" onSubmit={save} noValidate>
      {form.error && <Alert>{form.error}</Alert>}
      {locked && <p className="faint small">Approved by the TPO. Ask the TPO to change who can apply.</p>}
      <p className="cy-match" role="status">
        {count == null ? "Counting matching students…" : <><strong>{count}</strong> verified student{count === 1 ? "" : "s"} match right now</>}
      </p>
      <fieldset className="cy-fieldset" disabled={locked}>
        <legend>Branches (leave empty for all)</legend>
        <div className="cy-chips">
          {BRANCHES.map(({ value: b }) => (
            <label key={b} className="cy-check">
              <input type="checkbox" checked={branches.includes(b)} onChange={(e) => setBranches((x) => (e.target.checked ? [...x, b] : x.filter((k) => k !== b)))} /> {b}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="cy-fieldset" disabled={locked}>
        <legend>Marks</legend>
        <div className="cy-grid">
          <Field label="Batches" value={batches} onChange={(e) => setBatches(e.target.value)} hint="Graduation years, e.g. 2027" />
          <Field label="Minimum CGPA" type="number" step="0.01" min="0" max="10" value={v.minCgpa} onChange={set("minCgpa")} error={form.fieldErrors["eligibility.minCgpa"]} />
          <Field label="Most active backlogs" type="number" min="0" value={v.maxActiveBacklogs} onChange={set("maxActiveBacklogs")} hint="0 = no backlogs allowed" />
          <Field label="Minimum class 10 %" type="number" min="0" max="100" value={v.minTenth} onChange={set("minTenth")} />
          <Field label="Minimum class 12 / diploma %" type="number" min="0" max="100" value={v.minTwelfth} onChange={set("minTwelfth")} />
        </div>
      </fieldset>
      <p className="faint small">Only verified students are counted. Students who are already placed are left out by the college's rules.</p>
      <div className="buttons">
        <button className="primary" type="submit" disabled={form.busy}>
          {form.busy ? "Saving…" : locked ? "Continue" : "Save and continue"}
        </button>
      </div>
    </form>
  );
}

function RoundsStep({ drive, onSaved }: { drive: OfficeDrive; onSaved: (d: OfficeDrive) => void }) {
  const [rounds, setRounds] = useState<Round[]>(drive.rounds);
  const [saved, setSaved] = useState(false);
  const form = useApiForm();
  const live = drive.status === "PUBLISHED" || drive.status === "ONGOING";

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const errs: Record<string, string> = {};
    rounds.forEach((r, i) => {
      if (!r.title.trim()) errs[`rounds.${i}.title`] = "Give the round a name.";
    });
    await form.run(async () => {
      const d = await drivesApi.saveRounds(drive.id, rounds);
      setRounds(d.rounds);
      setSaved(true);
      onSaved(d);
    }, errs);
  }

  return (
    <form className="stack cy-wide" onSubmit={save} noValidate>
      {form.error && <Alert>{form.error}</Alert>}
      {saved && <Saved>Rounds saved.</Saved>}
      <p className="faint small">
        Add rounds in the order they happen. The same kind can repeat: add Technical round twice for "Technical round 1" and "Technical round 2". Dates can stay empty until they are fixed.
        {live && " Students in the drive are told when the schedule changes."}
      </p>
      <RoundBuilder rounds={rounds} onChange={setRounds} errors={form.fieldErrors} />
      <div className="buttons">
        <button className="primary" type="submit" disabled={form.busy}>
          {form.busy ? "Saving…" : "Save rounds and continue"}
        </button>
      </div>
    </form>
  );
}

function ReviewStep({ drive, onDone, onEdit }: { drive: OfficeDrive; onDone: (d: OfficeDrive) => void; onEdit: (s: Step) => void }) {
  const { role } = useAuth();
  const tpo = role === "TPO";
  const form = useApiForm();
  const missing = drive.missing;

  return (
    <div className="stack cy-wide">
      {form.error && <Alert>{form.error}</Alert>}
      <section className="panel stack">
        <div className="section-head">
          <h2>Job details</h2>
          <button type="button" className="quiet" onClick={() => onEdit("basics")}>
            Edit
          </button>
        </div>
        <dl className="cy-facts">
          <div><dt>Role</dt><dd>{drive.roleTitle}</dd></div>
          <div><dt>Type</dt><dd>{jobLabel(drive.jobType)}</dd></div>
          <div><dt>Pay</dt><dd>{pay(drive)}</dd></div>
          <div><dt>Location</dt><dd>{drive.location ?? "—"}</dd></div>
          <div><dt>Bond</dt><dd>{drive.bondMonths ? `${drive.bondMonths} months` : "None"}</dd></div>
          <div><dt>Join by</dt><dd>{drive.optInDeadline ? when(drive.optInDeadline) : "—"}</dd></div>
        </dl>
      </section>
      <section className="panel stack">
        <div className="section-head">
          <h2>Who can apply</h2>
          <button type="button" className="quiet" onClick={() => onEdit("eligibility")}>
            Edit
          </button>
        </div>
        <ul className="cy-list">{eligibilityLines(drive.eligibility).map((l) => <li key={l}>{l}</li>)}</ul>
      </section>
      <section className="panel stack">
        <div className="section-head">
          <h2>Rounds</h2>
          <button type="button" className="quiet" onClick={() => onEdit("rounds")}>
            Edit
          </button>
        </div>
        <RoundTimeline rounds={drive.rounds} />
      </section>

      {drive.can.submit ? (
        missing.length ? (
          <div className="alert" role="status">
            <span>
              Before sending, add:
              <ul className="cy-missing">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
            </span>
          </div>
        ) : (
          <div className="buttons">
            <button className="primary" type="button" disabled={form.busy} onClick={() => void form.run(async () => onDone(await drivesApi.submit(drive.id)))}>
              {tpo ? "Publish the drive" : "Send to the placement office"}
            </button>
            {!tpo && <span className="faint small">The TPO checks it. Students see nothing until it is approved.</span>}
          </div>
        )
      ) : (
        <div className="buttons">
          <Link className="button primary" to={drivePaths(role).item(drive.id)}>
            Done
          </Link>
        </div>
      )}
    </div>
  );
}
