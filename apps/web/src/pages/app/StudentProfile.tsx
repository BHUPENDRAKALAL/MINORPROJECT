import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { DOCUMENT_LABELS, REJECT_REASONS, type RejectReason } from "@cyrus/shared";
import { Field, SelectField } from "../../components/form";
import { useApiForm } from "../../components/useApiForm";
import { Alert, EmptyState, Saved, Sprite } from "../../components/ui";
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

/** The status strip at the top: where the profile is and what happens next. */
function StatusBanner({ view, onWithdraw, busy }: { view: StudentProfileView; onWithdraw: () => void; busy: boolean }) {
  const s = view.profile.status;
  if (s === "PENDING_VERIFICATION") {
    return (
      <div className="banner fam-orchid" role="status">
        <div className="banner-words">
          <p className="banner-title">Your profile is being checked</p>
          <p className="banner-detail">
            The placement office is checking your marks against your documents. It usually takes 2–3 days. You'll get a notification and an email when it's done.
          </p>
        </div>
        {view.canWithdraw && (
          <button type="button" className="banner-go" onClick={onWithdraw} disabled={busy}>
            Withdraw to make changes
          </button>
        )}
      </div>
    );
  }
  if (s === "VERIFIED") {
    return (
      <div className="banner fam-lime" role="status">
        <div className="banner-words">
          <p className="banner-title">Your profile is verified</p>
          <p className="banner-detail">Your marks are locked. You can be picked for drives you're eligible for. To change marks after a new semester, send a change request below.</p>
        </div>
      </div>
    );
  }
  if (s === "REJECTED") {
    return (
      <div className="banner fam-ember" role="status">
        <div className="banner-words">
          <p className="banner-title">Your profile needs changes</p>
          <p className="banner-detail">Fix what's listed below and send it again.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="banner fam-sun" role="status">
      <div className="banner-words">
        <p className="banner-title">Complete your profile</p>
        <p className="banner-detail">Add your marks and upload your marksheets. Then send it for verification so you can take part in drives.</p>
      </div>
    </div>
  );
}

/** Submitted → In review → Verified, as three stages. */
function Timeline({ view }: { view: StudentProfileView }) {
  const s = view.profile.status;
  const submitted = s !== "PROFILE_INCOMPLETE";
  const steps: { label: string; state: "done" | "working" | "waiting" | "idle" | "stuck" }[] = [
    { label: submitted || !view.missing.length ? "Profile filled" : "Fill your profile", state: submitted ? "done" : view.missing.length ? "waiting" : "done" },
    { label: "Sent for verification", state: submitted ? "done" : "idle" },
    { label: s === "REJECTED" ? "Changes asked" : "Being checked", state: s === "PENDING_VERIFICATION" ? "working" : s === "REJECTED" ? "stuck" : s === "VERIFIED" ? "done" : "idle" },
    { label: "Verified", state: s === "VERIFIED" ? "done" : "idle" },
  ];
  return (
    <ol className="cy-timeline" aria-label="Verification progress">
      {steps.map((st) => (
        <li key={st.label}>
          <span className={`stage ${st.state}`}>{st.label}</span>
        </li>
      ))}
    </ol>
  );
}

function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="cy-section">
      <div className="section-head">
        <h2>{title}</h2>
      </div>
      {note && <p className="section-note">{note}</p>}
      {children}
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
    <form className="stack panel cy-wide" onSubmit={submit} noValidate>
      {saved && <Saved>Saved.</Saved>}
      {form.error && form.errorCode !== "VALIDATION_FAILED" && form.errorCode !== "LOCAL_VALIDATION" && <Alert>{form.error}</Alert>}
      <div className="cy-grid">
        <Field label="CGPA (out of 10)" inputMode="decimal" value={v.cgpa} onChange={set("cgpa")} error={form.fieldErrors.cgpa} disabled={disabled} />
        <SelectField label="Up to semester" value={v.semester} onChange={set("semester")} error={form.fieldErrors.semester} disabled={disabled}>
          <option value="">Choose</option>
          {SEMESTERS.map((n) => (
            <option key={n} value={n}>
              Semester {n}
            </option>
          ))}
        </SelectField>
        <Field label="Active backlogs" inputMode="numeric" value={v.activeBacklogs} onChange={set("activeBacklogs")} error={form.fieldErrors.activeBacklogs} disabled={disabled} />
        <Field label="Total backlogs (ever)" inputMode="numeric" value={v.totalBacklogs} onChange={set("totalBacklogs")} error={form.fieldErrors.totalBacklogs} disabled={disabled} />
        <Field label="Class 10 percentage" inputMode="decimal" value={v.tenthPercent} onChange={set("tenthPercent")} error={form.fieldErrors.tenthPercent} disabled={disabled} />
        <Field label="Class 12 percentage" inputMode="decimal" value={v.twelfthPercent} onChange={set("twelfthPercent")} error={form.fieldErrors.twelfthPercent} hint="Leave empty if you did a diploma." disabled={disabled} />
        <Field label="Diploma percentage" inputMode="decimal" value={v.diplomaPercent} onChange={set("diplomaPercent")} error={form.fieldErrors.diplomaPercent} hint="Only for lateral entry." disabled={disabled} />
      </div>
      {withNote && <Field label="Why the change (optional)" value={v.note} onChange={set("note")} hint="For example: semester 6 results are out." />}
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
        ? { cls: "stuck", text: "Blocked: upload again" }
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
    <li className="cy-doc">
      <div className="cy-doc-main">
        <span className="cy-doc-label">{label}</span>
        {doc ? <span className="cy-doc-file">{doc.file.originalName}</span> : <span className="faint small">PDF, PNG or JPG</span>}
        {err && <span className="field-error">{err}</span>}
      </div>
      {extra}
      {(doc || !extra) && <span className={`stage ${state.cls}`}>{state.text}</span>}
      <div className="cy-doc-actions">
        {doc && (
          <button type="button" className="quiet" onClick={() => void open()}>
            View
          </button>
        )}
        {canEdit && (
          <>
            <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg" hidden onChange={(e) => void pick(e.target.files?.[0])} />
            <button type="button" onClick={() => input.current?.click()} disabled={busy}>
              {busy ? "Uploading…" : doc ? "Replace" : "Upload"}
            </button>
            {doc && onRemove && (
              <button type="button" className="quiet" onClick={() => void onRemove()}>
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

  // While a file is being virus-checked, look again every few seconds.
  useEffect(() => {
    if (!view?.documents.some((x) => x.file.scanStatus === "PENDING")) return;
    const t = setTimeout(() => void refreshQuietly().catch(() => undefined), 3000);
    return () => clearTimeout(t);
  }, [view, refreshQuietly]);

  if (loadError) return <EmptyState sprite="blocked" family="ember">{loadError}</EmptyState>;
  if (!view) {
    return (
      <div className="loading" role="status">
        <Sprite name="smith" size={96} plays />
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

  return (
    <>
      <header className="page-head">
        <h1 className="title">My profile</h1>
      </header>

      <StatusBanner view={view} busy={action.busy} onWithdraw={() => void action.run(async () => after(studentApi.withdraw()))} />
      {action.error && <Alert>{action.error}</Alert>}
      <Timeline view={view} />

      {p.status === "REJECTED" && (
        <div className="alert cy-reject" role="alert">
          <span>
            <strong>{reason?.label ?? "Your profile needs changes"}.</strong> {reason?.hint}
            {rejection?.note && (
              <>
                <br />
                <span className="faint">Reviewer's note:</span> {rejection.note}
              </>
            )}
          </span>
        </div>
      )}

      <Section title="Your details" note="You can change these any time.">
        <form
          className="stack panel cy-wide"
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
          <dl className="cy-facts">
            <div>
              <dt>Roll number</dt>
              <dd>{p.rollNo}</dd>
            </div>
            <div>
              <dt>Branch</dt>
              <dd>{p.branch}</dd>
            </div>
            <div>
              <dt>Batch</dt>
              <dd>{p.batch}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{p.email}</dd>
            </div>
          </dl>
          <div className="cy-grid">
            <Field label="Full name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} error={details.fieldErrors.name} />
            <Field label="Phone" type="tel" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} error={details.fieldErrors.phone} hint="Shared with a company only after you opt in to its drive." />
          </div>
          <Field label="Skills" value={d.skills} onChange={(e) => setD({ ...d, skills: e.target.value })} hint="Separate with commas, e.g. React, SQL, Python." />
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
              <p className="stage working">Your change request is waiting for review.</p>
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
              <p className="buttons">
                <button type="button" onClick={() => setShowChange(true)}>
                  Request a change
                </button>
              </p>
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

      <Section title="Marksheets" note="Clear scans or the original PDFs. Each file is checked for safety before anyone opens it.">
        <ul className="rows cy-docs">
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

      {view.canEdit && (
        <Section title="Send for verification">
          {view.missing.length ? (
            <div className="panel cy-wide">
              <p>Still missing:</p>
              <ul className="cy-missing">
                {view.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="lead">Everything is in. Check your marks once more, then send it. You can't change marks while it's being checked.</p>
          )}
          <p className="buttons">
            <button
              type="button"
              className="primary"
              disabled={!!view.missing.length || action.busy}
              onClick={() => void action.run(async () => after(studentApi.submit()))}
            >
              {action.busy ? "Sending…" : p.status === "REJECTED" ? "Send again for verification" : "Send for verification"}
            </button>
          </p>
        </Section>
      )}
    </>
  );
}
