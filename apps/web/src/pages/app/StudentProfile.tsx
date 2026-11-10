import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { DOCUMENT_LABELS, REJECT_REASONS, type RejectReason } from "@cyrus/shared";
import { Field, SelectField } from "../../components/form";
import { useApiForm } from "../../components/useApiForm";
import { Aside, Callout, type Tone } from "../../components/kit";
import { Alert, EmptyState, Saved } from "../../components/ui";
import { useAuth } from "../../app/useAuth";
import {
  ApiError,
  filesApi,
  studentApi,
  type AcademicInput,
  type StudentDocument,
  type StudentProfileView,
} from "../../lib/api";
import { useTitle } from "../../lib/useTitle";

const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8];

/** The status bar at the top: where the profile is and what happens next. */
function StatusBanner({ view, onWithdraw, busy }: { view: StudentProfileView; onWithdraw: () => void; busy: boolean }) {
  const s = view.profile.status;
  const [tone, title, body]: [Tone, string, string] =
    s === "PENDING_VERIFICATION"
      ? ["info", "Your profile is being checked", "The placement office is matching your marks with your marksheets. It usually takes 2–3 days. You'll get a notification and an email when it's done."]
      : s === "VERIFIED"
        ? ["success", "Your profile is verified", "Your marks are locked, and you can be picked for drives you're eligible for. After a new semester, send a change request under Marks."]
        : s === "REJECTED"
          ? ["danger", "Your profile needs changes", "Fix what's asked below, then send it again."]
          : ["warning", "Complete your profile", "Add your marks and upload your marksheets, then send it for verification so you can take part in drives."];
  return (
    <section className={`ui-status tone-${tone}`} role="status">
      <span className="ui-status-dot" aria-hidden="true" />
      <div className="ui-status-text">
        <p className="ui-status-title banner-title">{title}</p>
        <p className="ui-status-body">{body}</p>
      </div>
      {s === "PENDING_VERIFICATION" && view.canWithdraw && (
        <div className="ui-status-actions">
          <button type="button" onClick={onWithdraw} disabled={busy}>
            Withdraw to make changes
          </button>
        </div>
      )}
    </section>
  );
}

/** Fill → Send → Checked → Verified, as a step bar. */
function Timeline({ view }: { view: StudentProfileView }) {
  const s = view.profile.status;
  const submitted = s !== "PROFILE_INCOMPLETE";
  const steps: { label: string; state: "done" | "working" | "waiting" | "idle" | "stuck" }[] = [
    { label: submitted || !view.missing.length ? "Profile filled" : "Fill your profile", state: submitted ? "done" : view.missing.length ? "waiting" : "done" },
    { label: "Sent for verification", state: submitted ? "done" : "idle" },
    { label: s === "REJECTED" ? "Changes asked" : "Being checked", state: s === "PENDING_VERIFICATION" ? "working" : s === "REJECTED" ? "stuck" : s === "VERIFIED" ? "done" : "idle" },
    { label: "Verified", state: s === "VERIFIED" ? "done" : "idle" },
  ];
  // The step to show by name on a phone, where only the marks fit: the first one not done (or the last).
  const open = steps.findIndex((x) => x.state !== "done");
  const current = open === -1 ? steps.length - 1 : open;
  return (
    <ol className="cy-timeline sp-steps" aria-label="Verification progress">
      {steps.map((st, i) => (
        <li key={st.label} className={`is-${st.state}${i === current ? " is-current" : ""}`}>
          <span className="sp-step-mark" aria-hidden="true">
            {st.state === "done" ? (
              <svg viewBox="0 0 16 16" width="12" height="12">
                <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : st.state === "stuck" ? (
              "!"
            ) : (
              i + 1
            )}
          </span>
          <span className={`stage is-bare ${st.state}`}>{st.label}</span>
        </li>
      ))}
    </ol>
  );
}

function Section({ title, note, children, id }: { title: string; note?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="rq-card sp-card" id={id}>
      <div className="rq-card-head">
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </div>
      <div className="sp-card-body">{children}</div>
    </section>
  );
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));

function MarksForm({
  initial,
  disabled,
  submitLabel,
  onSave,
  withNote,
}: {
  initial: Partial<AcademicInput> | null;
  disabled?: boolean;
  submitLabel: string;
  onSave: (v: AcademicInput & { note?: string }) => Promise<void>;
  withNote?: boolean;
}) {
  const [v, setV] = useState({
    cgpa: initial?.cgpa?.toString() ?? "",
    activeBacklogs: initial?.activeBacklogs?.toString() ?? "0",
    totalBacklogs: initial?.totalBacklogs?.toString() ?? "0",
    tenthPercent: initial?.tenthPercent?.toString() ?? "",
    twelfthPercent: initial?.twelfthPercent?.toString() ?? "",
    diplomaPercent: initial?.diplomaPercent?.toString() ?? "",
    semester: initial?.semester?.toString() ?? "",
    note: "",
  });
  const [saved, setSaved] = useState(false);
  const form = useApiForm();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => {
    setSaved(false);
    form.clearField(k);
    setV((x) => ({ ...x, [k]: e.target.value }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (v.cgpa === "") errs.cgpa = "Enter your CGPA.";
    if (v.tenthPercent === "") errs.tenthPercent = "Enter your class 10 percentage.";
    if (v.twelfthPercent === "" && v.diplomaPercent === "") errs.twelfthPercent = "Enter class 12 or diploma percentage.";
    await form.run(async () => {
      await onSave({
        cgpa: Number(v.cgpa),
        activeBacklogs: Number(v.activeBacklogs || 0),
        totalBacklogs: Number(v.totalBacklogs || 0),
        tenthPercent: Number(v.tenthPercent),
        twelfthPercent: num(v.twelfthPercent),
        diplomaPercent: num(v.diplomaPercent),
        semester: num(v.semester),
        ...(withNote && v.note.trim() ? { note: v.note.trim() } : {}),
      });
      setSaved(true);
    }, errs);
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      {saved && <Saved>Saved.</Saved>}
      {form.error && form.errorCode !== "VALIDATION_FAILED" && form.errorCode !== "LOCAL_VALIDATION" && <Alert>{form.error}</Alert>}
      <div className="form-row">
        <Field label="CGPA" size="sm" inputMode="decimal" placeholder="e.g. 8.25" hint="Out of 10" value={v.cgpa} onChange={set("cgpa")} error={form.fieldErrors.cgpa} disabled={disabled} />
        <SelectField label="Up to semester" size="sm" value={v.semester} onChange={set("semester")} error={form.fieldErrors.semester} disabled={disabled}>
          <option value="">Choose</option>
          {SEMESTERS.map((n) => (
            <option key={n} value={n}>
              Semester {n}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="form-row">
        <Field label="Active backlogs" size="sm" inputMode="numeric" placeholder="0" value={v.activeBacklogs} onChange={set("activeBacklogs")} error={form.fieldErrors.activeBacklogs} disabled={disabled} />
        <Field label="Total backlogs" size="sm" inputMode="numeric" placeholder="0" hint="Including cleared ones" value={v.totalBacklogs} onChange={set("totalBacklogs")} error={form.fieldErrors.totalBacklogs} disabled={disabled} />
      </div>
      <div className="form-row">
        <Field label="Class 10" size="sm" inputMode="decimal" placeholder="e.g. 88.4" hint="Percentage" value={v.tenthPercent} onChange={set("tenthPercent")} error={form.fieldErrors.tenthPercent} disabled={disabled} />
        <Field label="Class 12" size="sm" optional inputMode="decimal" placeholder="e.g. 82" hint="Empty if you did a diploma" value={v.twelfthPercent} onChange={set("twelfthPercent")} error={form.fieldErrors.twelfthPercent} disabled={disabled} />
        <Field label="Diploma" size="sm" optional inputMode="decimal" placeholder="e.g. 76" hint="Only for lateral entry" value={v.diplomaPercent} onChange={set("diplomaPercent")} error={form.fieldErrors.diplomaPercent} disabled={disabled} />
      </div>
      {withNote && <Field label="Why the change" optional size="lg" value={v.note} onChange={set("note")} placeholder="e.g. Semester 6 results are out" />}
      {!disabled && (
        <div className="buttons">
          <button className="primary" type="submit" disabled={form.busy}>
            {form.busy ? "Saving…" : submitLabel}
          </button>
        </div>
      )}
    </form>
  );
}

/** One row per required document: what it is, the file, its state, and upload / view / remove. */
function DocRow({
  label,
  doc,
  canEdit,
  onUpload,
  onRemove,
  extra,
}: {
  label: string;
  doc?: StudentDocument;
  canEdit: boolean;
  onUpload: (file: File) => Promise<void>;
  onRemove?: () => Promise<void>;
  extra?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const state = !doc
    ? { cls: "waiting", text: "Not uploaded" }
    : doc.status === "ACCEPTED"
      ? { cls: "done", text: "Accepted" }
      : doc.file.scanStatus === "INFECTED"
        ? { cls: "stuck", text: "Not accepted: upload again" }
        : doc.file.scanStatus === "PENDING"
          ? { cls: "working", text: "Checking file" }
          : { cls: "done", text: "Uploaded" };

  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      await onUpload(f);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Upload failed. Try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function open() {
    if (!doc) return;
    try {
      const { url } = await filesApi.link(doc.file.id);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't open the file.");
    }
  }

  return (
    <li className={`cy-doc sp-doc${doc ? "" : " is-empty"}`}>
      <span className="rq-doc-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16">
          <path d="M4 1.5h5.5L12.5 4.5v10h-8.5z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M9.5 1.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="cy-doc-main">
        <span className="cy-doc-label">{label}</span>
        {doc ? <span className="cy-doc-file">{doc.file.originalName}</span> : <span className="cy-doc-file">PDF, PNG or JPG, up to 10 MB</span>}
        {doc?.file.scanStatus === "INFECTED" && doc.file.scanNote && <span className="field-error">{doc.file.scanNote}</span>}
        {err && <span className="field-error">{err}</span>}
      </div>
      {extra}
      {(doc || !extra) && <span className={`stage ${state.cls}`}>{state.text}</span>}
      <div className="cy-doc-actions">
        {doc && doc.file.scanStatus !== "INFECTED" && (
          <button type="button" className="small" onClick={() => void open()}>
            View
          </button>
        )}
        {canEdit && (
          <>
            <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg" hidden onChange={(e) => void pick(e.target.files?.[0])} />
            <button type="button" className={`small${doc ? "" : " primary"}`} onClick={() => input.current?.click()} disabled={busy}>
              {busy ? "Uploading…" : doc ? "Replace" : "Upload"}
            </button>
            {doc && onRemove && (
              <button type="button" className="small sp-remove" onClick={() => void onRemove()} aria-label={`Remove ${label}`}>
                Remove
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export default function StudentProfile() {
  useTitle("My profile");
  const { reloadMe } = useAuth();
  const [view, setView] = useState<StudentProfileView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newSem, setNewSem] = useState("");
  const [showChange, setShowChange] = useState(false);
  const action = useApiForm();
  const details = useApiForm();
  const [detailsSaved, setDetailsSaved] = useState(false);
  const [d, setD] = useState({ name: "", phone: "", skills: "" });

  // Requests can finish out of order (e.g. "Save marks" then a quick "Send"). Only the newest one updates the page.
  const latest = useRef(0);
  const applyNow = useCallback((v: StudentProfileView) => {
    setView(v);
    setD({ name: v.profile.name, phone: v.profile.phone ?? "", skills: v.profile.skills.join(", ") });
  }, []);
  const track = useCallback(
    async (p: Promise<StudentProfileView>) => {
      const id = ++latest.current;
      const v = await p;
      if (id === latest.current) applyNow(v);
      return v;
    },
    [applyNow],
  );
  /** Background refresh: never overrides an action that started after it. */
  const refreshQuietly = useCallback(async () => {
    const id = latest.current;
    const v = await studentApi.get();
    if (id === latest.current) applyNow(v);
  }, [applyNow]);
  const apply = applyNow;

  useEffect(() => {
    studentApi
      .get()
      .then(apply)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Couldn't load your profile."));
  }, [apply]);

  // While a file is being cleaned (rebuilt) by the worker, look again every few seconds.
  useEffect(() => {
    if (!view?.documents.some((x) => x.file.scanStatus === "PENDING" || x.file.scanStatus === "FAILED")) return;
    const t = setTimeout(() => void refreshQuietly().catch(() => undefined), 3000);
    return () => clearTimeout(t);
  }, [view, refreshQuietly]);

  if (loadError) return <EmptyState sprite="blocked" family="ember">{loadError}</EmptyState>;
  if (!view) {
    return (
      <div className="loading" role="status">
        <p className="faint">Opening your profile…</p>
      </div>
    );
  }

  const p = view.profile;
  const docsOf = (type: StudentDocument["type"]) => view.documents.filter((x) => x.type === type);
  const one = (type: StudentDocument["type"]) => docsOf(type)[0];
  const semesterDocs = docsOf("SEMESTER_MARKSHEET").sort((a, b) => (a.semester ?? 0) - (b.semester ?? 0));

  const upload = (type: StudentDocument["type"], semester?: number) => async (file: File) => {
    const f = await filesApi.upload("MARKSHEET", file);
    await track(studentApi.addDocument({ fileId: f.id, type, semester }));
  };
  const remove = (id: string) => async () => void (await track(studentApi.removeDocument(id)));
  const after = async (p: Promise<StudentProfileView>) => {
    await track(p);
    await reloadMe();
  };

  const rejection = view.rejection;
  const reason = rejection?.reasonCode && rejection.reasonCode in REJECT_REASONS ? REJECT_REASONS[rejection.reasonCode as RejectReason] : null;

  const sendBlock = view.canEdit && (
    <section className="rq-decide sp-send" aria-label="Send for verification">
      <h2>Send for verification</h2>
      {view.missing.length ? (
        <>
          <p className="rq-decide-help">Still missing:</p>
          <ul className="cy-missing sp-missing">
            {view.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="rq-decide-help">Everything is in. Check your marks once more, then send it. You can't change marks while it's being checked.</p>
      )}
      <button
        type="button"
        className="primary rq-wide"
        disabled={!!view.missing.length || action.busy}
        onClick={() => void action.run(async () => after(studentApi.submit()))}
      >
        {action.busy ? "Sending…" : p.status === "REJECTED" ? "Send again for verification" : "Send for verification"}
      </button>
    </section>
  );

  return (
    <>
      <header className="rq-head">
        <div className="rq-head-text">
          <h1 className="rq-title">My profile</h1>
          <p className="rq-meta">
            <span>{p.rollNo}</span>
            <span>{p.branch}</span>
            <span>Batch {p.batch}</span>
            <span>{p.email}</span>
          </p>
        </div>
      </header>

      <Timeline view={view} />
      <StatusBanner view={view} busy={action.busy} onWithdraw={() => void action.run(async () => after(studentApi.withdraw()))} />
      {action.error && <Alert>{action.error}</Alert>}

      {p.status === "REJECTED" && (
        <Callout tone="danger" title={reason?.label ?? "Your profile needs changes"}>
          {reason?.hint}
          {rejection?.note && (
            <>
              {" "}Reviewer's note: “{rejection.note}”
            </>
          )}
        </Callout>
      )}

      <div className="ui-split rq-split">
      <div className="rq-main">
      <Section title="Your details" note="You can change these any time. Roll number, branch and batch come from sign-up; ask the placement office to fix them.">
        <form
          className="form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setDetailsSaved(false);
            void details.run(async () => {
              await track(
                studentApi.update({
                  name: d.name,
                  phone: d.phone.trim() || null,
                  skills: d.skills.split(",").map((x) => x.trim()).filter(Boolean),
                }),
              );
              setDetailsSaved(true);
            });
          }}
        >
          {detailsSaved && <Saved>Saved.</Saved>}
          <div className="form-row">
            <Field label="Full name" size="md" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} error={details.fieldErrors.name} />
            <Field label="Phone" size="md" optional type="tel" placeholder="10-digit mobile" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} error={details.fieldErrors.phone} hint="Shared with a company only after you opt in to its drive." />
          </div>
          <Field label="Skills" size="lg" optional placeholder="React, SQL, Python" value={d.skills} onChange={(e) => setD({ ...d, skills: e.target.value })} hint="Separate with commas. Companies see these." />
          <div className="buttons">
            <button className="primary" type="submit" disabled={details.busy}>
              {details.busy ? "Saving…" : "Save details"}
            </button>
          </div>
        </form>
      </Section>

      <Section
        title="Marks"
        note={
          view.canEdit
            ? "Enter them exactly as on your marksheets. They're locked once verified."
            : p.status === "PENDING_VERIFICATION"
              ? "Locked while your profile is being checked."
              : "Verified. These are the marks companies see."
        }
      >
        {p.status === "VERIFIED" ? (
          <>
            <MarksForm initial={view.verified} disabled submitLabel="" onSave={async () => undefined} />
            {view.pendingUpdate ? (
              <p className="form-note">Your change request is waiting for review.</p>
            ) : showChange ? (
              <MarksForm
                initial={view.verified}
                withNote
                submitLabel="Send change request"
                onSave={async (v) => {
                  await track(studentApi.requestUpdate(v));
                  setShowChange(false);
                }}
              />
            ) : (
              <div className="sp-change">
                <span>New semester results out?</span>
                <button type="button" className="small" onClick={() => setShowChange(true)}>
                  Request a change
                </button>
              </div>
            )}
          </>
        ) : (
          <MarksForm
            key={view.draft?.id ?? "new"}
            initial={view.draft}
            disabled={!view.canEdit}
            submitLabel="Save marks"
            onSave={async (v) => void (await track(studentApi.saveAcademics(v)))}
          />
        )}
      </Section>

      <Section title="Marksheets" note="Clear scans or the original PDFs. Every file is cleaned for safety before anyone opens it.">
        <ul className="sp-docs">
          <DocRow label={DOCUMENT_LABELS.MARKSHEET_10} doc={one("MARKSHEET_10")} canEdit={view.canEdit} onUpload={upload("MARKSHEET_10")} onRemove={one("MARKSHEET_10") ? remove(one("MARKSHEET_10")!.id) : undefined} />
          <DocRow
            label={one("DIPLOMA") ? DOCUMENT_LABELS.DIPLOMA : DOCUMENT_LABELS.MARKSHEET_12}
            doc={one("MARKSHEET_12") ?? one("DIPLOMA")}
            canEdit={view.canEdit}
            onUpload={upload(one("DIPLOMA") ? "DIPLOMA" : "MARKSHEET_12")}
            onRemove={(one("MARKSHEET_12") ?? one("DIPLOMA")) ? remove((one("MARKSHEET_12") ?? one("DIPLOMA"))!.id) : undefined}
          />
          {semesterDocs.map((doc) => (
            <DocRow
              key={doc.id}
              label={`${DOCUMENT_LABELS.SEMESTER_MARKSHEET}: semester ${doc.semester}`}
              doc={doc}
              canEdit={view.canEdit}
              onUpload={upload("SEMESTER_MARKSHEET", doc.semester ?? undefined)}
              onRemove={remove(doc.id)}
            />
          ))}
          {view.canEdit && (
            <DocRow
              label="Add a semester marksheet"
              canEdit
              onUpload={async (f) => {
                if (!newSem) throw new ApiError(400, "PICK_SEMESTER", "Pick the semester first.");
                await upload("SEMESTER_MARKSHEET", Number(newSem))(f);
                setNewSem("");
              }}
              extra={
                <select aria-label="Semester" value={newSem} onChange={(e) => setNewSem(e.target.value)} className="cy-sem">
                  <option value="">Semester…</option>
                  {SEMESTERS.map((n) => (
                    <option key={n} value={n} disabled={semesterDocs.some((x) => x.semester === n)}>
                      Semester {n}
                    </option>
                  ))}
                </select>
              }
            />
          )}
        </ul>
      </Section>

      </div>
      <div className="rq-side">
        {sendBlock}
        <Aside title="How verification works">
          <ol className="ui-steps-list">
            <li>
              <span>
                <strong>Fill and upload</strong>Marks exactly as on your marksheets.
              </span>
            </li>
            <li>
              <span>
                <strong>Send it</strong>Marks lock while it's being checked.
              </span>
            </li>
            <li>
              <span>
                <strong>Get verified</strong>Then companies can invite you.
              </span>
            </li>
          </ol>
        </Aside>
      </div>
      </div>
    </>
  );
}
