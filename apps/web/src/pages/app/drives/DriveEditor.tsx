import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { JOB_TYPES, type Eligibility, type JobType } from "@cyrus/shared";
import { useAuth } from "../../../app/useAuth";
import { Field, FormSection, SelectField, TextField } from "../../../components/form";
import { useApiForm } from "../../../components/useApiForm";
import { Callout } from "../../../components/kit";
import { Alert, Saved } from "../../../components/ui";
import { drivesApi, type OfficeDrive, type Round } from "../../../lib/api";
import { BRANCHES } from "../../../lib/constants";
import { useTitle } from "../../../lib/useTitle";
import { RoundBuilder } from "./RoundBuilder";
import { DriveStatusChip, RoundTimeline } from "./shared";
import { drivePaths, eligibilityLines, fromLocalInput, jobLabel, pay, toLocalInput, when } from "./format";

const STEPS = [
  { key: "basics", label: "Job details" },
  { key: "eligibility", label: "Who can apply" },
  { key: "rounds", label: "Rounds" },
  { key: "review", label: "Check and send" },
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
      <header className="rq-head">
        <div className="rq-head-text">
          <p className="rq-crumb">
            <Link to={paths.list}>Drives</Link>
            {drive && (
              <>
                <span aria-hidden="true">/</span>
                <Link to={paths.item(drive.id)}>{drive.roleTitle}</Link>
              </>
            )}
          </p>
          <h1 className="rq-title">{id ? "Edit drive" : "New drive"}</h1>
          <p className="rq-meta">
            {drive ? (
              <>
                <span>{drive.company.name}</span>
                <DriveStatusChip status={drive.status} />
              </>
            ) : (
              <span>Four short steps. Nothing is sent until the last one.</span>
            )}
          </p>
        </div>
      </header>

      {locked ? (
        <Alert>This drive can't be changed any more.</Alert>
      ) : (
        <>
          <nav aria-label="Steps">
            <ol className="sp-steps de-steps">
              {STEPS.map((s, i) => {
                const at = STEPS.findIndex((x) => x.key === step);
                const state = i < at ? "done" : i === at ? "working" : "idle";
                return (
                  <li key={s.key} className={`is-${state}${i === at ? " is-current" : ""}`}>
                    <button type="button" className="de-step" aria-current={s.key === step ? "step" : undefined} disabled={!drive && s.key !== "basics"} onClick={() => go(s.key)}>
                      <span className="sp-step-mark" aria-hidden="true">
                        {state === "done" ? (
                          <svg viewBox="0 0 16 16" width="12" height="12">
                            <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : (
                          i + 1
                        )}
                      </span>
                      <span className="stage is-bare">{s.label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
          {drive?.rejectionReason && drive.status === "REJECTED" && (
            <Callout tone="danger" title="The placement office sent this drive back">
              {drive.rejectionReason}
            </Callout>
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
    <form className="form" onSubmit={save} noValidate>
      {form.error && <Alert>{form.error}</Alert>}
      {limited && <p className="form-note">The TPO has approved this drive, so only the description, location and joining deadline can change. Students in the drive are told about changes.</p>}
      {tpo && !drive && (
        <FormSection title="Company" description="Pick a company that uses Cyrus, or type the name of one that doesn't.">
          <SelectField label="Company" size="lg" value={companyId} onChange={(e) => setCompanyId(e.target.value)} error={form.fieldErrors.companyId}>
            <option value="">Pick a company…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          {!companyId && <Field label="Or add a new company" size="lg" value={newCompany} onChange={(e) => setNewCompany(e.target.value)} placeholder="Company name" hint="For a company that doesn't use Cyrus. HR can be invited later." />}
        </FormSection>
      )}
      <FormSection title="The job" description="What students see first in the list of drives.">
        <Field label="Role" size="lg" value={v.roleTitle} onChange={set("roleTitle")} error={form.fieldErrors.roleTitle} disabled={limited} placeholder="e.g. Software Engineer" />
        <SelectField label="Type" size="md" value={v.jobType} onChange={set("jobType")} disabled={limited}>
          {JOB_TYPES.map((t) => (
            <option key={t} value={t}>
              {jobLabel(t)}
            </option>
          ))}
        </SelectField>
        <Field label="Location" size="md" optional value={v.location} onChange={set("location")} placeholder="e.g. Jaipur, Remote" />
      </FormSection>
      <FormSection title="Pay and bond" description="Shown to students before they decide to join. Internships show the stipend, full-time jobs the CTC.">
        <div className="form-row">
          {v.jobType !== "INTERNSHIP" && <Field label="CTC" size="sm" type="number" step="0.1" min="0" placeholder="e.g. 7.5" value={v.ctcLpa} onChange={set("ctcLpa")} error={form.fieldErrors.ctcLpa} hint="Lakh per year" disabled={limited} />}
          {v.jobType !== "FULL_TIME" && (
            <Field label="Stipend" size="sm" type="number" min="0" placeholder="e.g. 30000" value={v.stipendMonthly} onChange={set("stipendMonthly")} error={form.fieldErrors.stipendMonthly} hint="₹ per month" disabled={limited} />
          )}
          <Field label="Bond" size="sm" optional type="number" min="0" placeholder="0" value={v.bondMonths} onChange={set("bondMonths")} hint="Months. Empty or 0 if none." disabled={limited} />
        </div>
      </FormSection>
      <FormSection title="Joining window" description="Invited students answer Join or Skip before this time. After it, the list of students is fixed.">
        <Field label="Last date to join" size="md" type="datetime-local" value={v.optInDeadline} onChange={set("optInDeadline")} error={form.fieldErrors.optInDeadline} />
      </FormSection>
      <FormSection title="Job description" description="What the job is, the skills needed, training and where they will work. Plain text; line breaks are kept.">
        <TextField
          label="Description"
          rows={8}
          maxLength={8000}
          value={v.description}
          onChange={set("description")}
          error={form.fieldErrors.description}
          placeholder="What the job is, the skills needed, training, where they will work."
        />
      </FormSection>
      <div className="form-actions">
        <button className="primary" type="submit" disabled={form.busy}>
          {form.busy ? "Saving…" : drive ? "Save and continue" : "Create draft and continue"}
        </button>
        <span className="faint">Next: who can apply.</span>
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
    <form className="form" onSubmit={save} noValidate>
      {form.error && <Alert>{form.error}</Alert>}
      {locked && <p className="form-note">Approved by the TPO. Ask the TPO to change who can apply.</p>}
      <p className="cy-match" role="status">
        {count == null ? "Counting matching students…" : <><strong>{count}</strong> verified student{count === 1 ? "" : "s"} match right now</>}
      </p>
      <FormSection title="Branches" description="Leave all off to open the drive to every branch.">
        <fieldset className="cy-fieldset" disabled={locked}>
          <legend className="sr-only">Branches</legend>
          <div className="cy-chips">
            {BRANCHES.map(({ value: b }) => (
              <label key={b} className="cy-check">
                <input type="checkbox" checked={branches.includes(b)} onChange={(e) => setBranches((x) => (e.target.checked ? [...x, b] : x.filter((k) => k !== b)))} /> {b}
              </label>
            ))}
          </div>
        </fieldset>
      </FormSection>
      <FormSection title="Batch" description="Graduation years that can apply. Leave empty for all.">
        <Field label="Graduation years" size="md" optional disabled={locked} value={batches} onChange={(e) => setBatches(e.target.value)} placeholder="e.g. 2027" hint="Separate several with commas." />
      </FormSection>
      <FormSection title="Marks" description="Minimums a student must meet. Leave a box empty for no limit.">
        <div className="form-row">
          <Field label="Minimum CGPA" size="sm" optional disabled={locked} type="number" step="0.01" min="0" max="10" placeholder="e.g. 7.0" value={v.minCgpa} onChange={set("minCgpa")} error={form.fieldErrors["eligibility.minCgpa"]} hint="Out of 10" />
          <Field label="Active backlogs" size="sm" optional disabled={locked} type="number" min="0" placeholder="e.g. 0" value={v.maxActiveBacklogs} onChange={set("maxActiveBacklogs")} hint="Most allowed; 0 = none" />
        </div>
        <div className="form-row">
          <Field label="Class 10" size="sm" optional disabled={locked} type="number" min="0" max="100" placeholder="e.g. 60" value={v.minTenth} onChange={set("minTenth")} hint="Minimum %" />
          <Field label="Class 12 or diploma" size="sm" optional disabled={locked} type="number" min="0" max="100" placeholder="e.g. 60" value={v.minTwelfth} onChange={set("minTwelfth")} hint="Minimum %" />
        </div>
      </FormSection>
      <div className="form-actions">
        <button className="primary" type="submit" disabled={form.busy}>
          {form.busy ? "Saving…" : locked ? "Continue" : "Save and continue"}
        </button>
        <span className="faint">Only verified students are counted. Students already placed are left out by the college's rules.</span>
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
    <form className="form cy-wide" onSubmit={save} noValidate>
      {form.error && <Alert>{form.error}</Alert>}
      {saved && <Saved>Rounds saved.</Saved>}
      <p className="faint small">
        Add rounds in the order they happen. The same kind can repeat: add Technical round twice for "Technical round 1" and "Technical round 2". Dates can stay empty until they are fixed.
        {live && " Students in the drive are told when the schedule changes."}
      </p>
      <RoundBuilder rounds={rounds} onChange={setRounds} errors={form.fieldErrors} driveId={drive.id} />
      <div className="form-actions">
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
    <div className="ui-split rq-split">
      <div className="rq-main">
        {form.error && <Alert>{form.error}</Alert>}
        <section className="rq-card">
          <div className="rq-card-head rp-card-head">
            <h2>Job details</h2>
            <button type="button" className="small" onClick={() => onEdit("basics")}>
              Edit
            </button>
          </div>
          <dl className="sh-facts de-facts">
            <div><dt>Role</dt><dd>{drive.roleTitle}</dd></div>
            <div><dt>Type</dt><dd>{jobLabel(drive.jobType)}</dd></div>
            <div><dt>Pay</dt><dd>{pay(drive)}</dd></div>
            <div><dt>Location</dt><dd>{drive.location ?? "Not given"}</dd></div>
            <div><dt>Bond</dt><dd>{drive.bondMonths ? `${drive.bondMonths} months` : "None"}</dd></div>
            <div><dt>Join by</dt><dd>{drive.optInDeadline ? when(drive.optInDeadline) : "Not set"}</dd></div>
          </dl>
        </section>
        <section className="rq-card">
          <div className="rq-card-head rp-card-head">
            <h2>Who can apply</h2>
            <button type="button" className="small" onClick={() => onEdit("eligibility")}>
              Edit
            </button>
          </div>
          <div className="rp-body">
            <ul className="rq-rules">{eligibilityLines(drive.eligibility).map((l) => <li key={l}>{l}</li>)}</ul>
          </div>
        </section>
        <section className="rq-card">
          <div className="rq-card-head rp-card-head">
            <h2>Rounds</h2>
            <button type="button" className="small" onClick={() => onEdit("rounds")}>
              Edit
            </button>
          </div>
          <div className="sd-rounds">
            <RoundTimeline rounds={drive.rounds} />
          </div>
        </section>
      </div>
      <div className="rq-side">
        <section className="rq-decide" aria-label={tpo ? "Publish" : "Send"}>
          <h2>{tpo ? "Publish" : "Send for approval"}</h2>
          {drive.can.submit ? (
            missing.length ? (
              <>
                <p className="rq-decide-help">Before sending, add:</p>
                <ul className="cy-missing sp-missing">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
              </>
            ) : (
              <>
                <p className="rq-decide-help">{tpo ? "Publishing makes it live. Then invite the students who match." : "The TPO checks it. Students see nothing until it is approved."}</p>
                <button className="primary rq-wide" type="button" disabled={form.busy} onClick={() => void form.run(async () => onDone(await drivesApi.submit(drive.id)))}>
                  {tpo ? "Publish the drive" : "Send to the placement office"}
                </button>
              </>
            )
          ) : (
            <>
              <p className="rq-decide-help">Your changes are saved.</p>
              <Link className="button primary rq-wide" to={drivePaths(role).item(drive.id)}>
                Done
              </Link>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
