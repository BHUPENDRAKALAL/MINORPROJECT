import { useCallback, useEffect, useState } from "react";
import { DOCUMENT_LABELS, REJECT_REASONS, type RejectReason } from "@cyrus/shared";
import { Field, SelectField } from "../../components/form";
import { useApiForm } from "../../components/useApiForm";
import { Alert, EmptyState, Saved, Sprite } from "../../components/ui";
import { ApiError, workApi, type AcademicRecord, type ReviewSummary, type ReviewTaskView } from "../../lib/api";
import { useTitle } from "../../lib/useTitle";

const TYPE_LABELS: Record<string, string> = {
  STUDENT_VERIFICATION: "Profile check",
  SECOND_CHECK: "Second check",
  ACADEMIC_UPDATE: "Marks change request",
  DUPLICATE_DOCUMENT: "Duplicate document",
};
const OUTCOME: Record<string, string> = {
  closed: "Done. The student has been told.",
  sent_for_second_check: "Saved. A staff member will do a quick second check before the student is told.",
  escalated: "The two checks disagree, so the TPO will decide this one.",
};

/** The confidentiality pledge shown once before someone reviews (BACKEND-DESIGN.md §4b). */
function Pledge({ onDone }: { onDone: () => void }) {
  const [agree, setAgree] = useState(false);
  const form = useApiForm();
  return (
    <div className="panel cy-wide stack">
      <h2>Before you start</h2>
      <ul className="cy-guide">
        <li>You'll see students' marks and marksheets. Use them only to check the profile in front of you.</li>
        <li>Don't screenshot, download or share documents, and don't discuss a student's marks with anyone.</li>
        <li>Check each number on the form against the marksheet. If anything doesn't match or isn't readable, reject with the reason that fits.</li>
        <li>Not sure? Use "Ask the TPO" instead of guessing. Every decision is recorded with your name.</li>
        <li>You won't get profiles from your own class.</li>
      </ul>
      {form.error && <Alert>{form.error}</Alert>}
      <label className="cy-check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I'll keep everything I see private.
      </label>
      <p className="buttons">
        <button className="primary" type="button" disabled={!agree || form.busy} onClick={() => void form.run(async () => (await workApi.pledge(), onDone()))}>
          Accept and start
        </button>
      </p>
    </div>
  );
}

function useCountdown(until: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!until) return null;
  const ms = Math.max(0, new Date(until).getTime() - now);
  return { ms, text: `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}` };
}

function MarksTable({ marks, previous }: { marks: AcademicRecord | null | undefined; previous?: AcademicRecord | null }) {
  if (!marks) return <p className="faint">No marks were entered.</p>;
  const rows: [string, keyof AcademicRecord][] = [
    ["CGPA", "cgpa"],
    ["Up to semester", "semester"],
    ["Active backlogs", "activeBacklogs"],
    ["Total backlogs", "totalBacklogs"],
    ["Class 10 %", "tenthPercent"],
    ["Class 12 %", "twelfthPercent"],
    ["Diploma %", "diplomaPercent"],
  ];
  return (
    <table className="cy-marks">
      <thead>
        <tr>
          <th scope="col">What</th>
          {previous && <th scope="col">Verified before</th>}
          <th scope="col">{previous ? "Asked now" : "Entered by student"}</th>
        </tr>
      </thead>
      <tbody>
        {rows
          .filter(([, k]) => marks[k] !== null || (previous && previous[k] !== null))
          .map(([label, k]) => {
            const changed = previous && previous[k] !== marks[k];
            return (
              <tr key={k} className={changed ? "is-changed" : undefined}>
                <th scope="row">{label}</th>
                {previous && <td>{String(previous[k] ?? "—")}</td>}
                <td>{String(marks[k] ?? "—")}</td>
              </tr>
            );
          })}
      </tbody>
    </table>
  );
}

function TaskView({ task, onFinished }: { task: ReviewTaskView; onFinished: (msg: string) => void }) {
  const base = task.subject ?? task;
  const left = useCountdown(task.claimedUntil);
  const [mode, setMode] = useState<"none" | "reject" | "escalate">("none");
  const [reason, setReason] = useState<RejectReason | "">("");
  const [note, setNote] = useState("");
  const form = useApiForm();
  const flagged = base.documents?.some((d) => d.flags?.duplicateOf?.length);

  const decide = (decision: "APPROVE" | "REJECT") =>
    form.run(
      async () => {
        const r = await workApi.decide(task.id, { decision, reasonCode: decision === "REJECT" ? reason : null, note: note.trim() || null });
        onFinished(OUTCOME[r.outcome] ?? "Saved.");
      },
      decision === "REJECT" && !reason ? { reasonCode: "Pick a reason." } : reason === "OTHER" && !note.trim() ? { note: "Write a short note." } : undefined,
    );

  return (
    <div className="stack">
      <div className="cy-task-head">
        <span className="pill">{TYPE_LABELS[task.type] ?? task.type}</span>
        <span className={`stage ${task.risk === "HIGH" ? "stuck" : task.risk === "MEDIUM" ? "trouble" : "done"}`}>{task.risk.toLowerCase()} risk</span>
        {left && (
          <span className={`cy-lock${left.ms < 3 * 60000 ? " is-low" : ""}`} role="timer" aria-live="off">
            Locked to you for {left.text}
          </span>
        )}
        <span className="cy-task-tools">
          {left && left.ms < 5 * 60000 && (
            <button type="button" className="quiet" onClick={() => void form.run(async () => void (await workApi.extend(task.id)))}>
              +15 min
            </button>
          )}
          <button type="button" className="quiet" onClick={() => void form.run(async () => (await workApi.release(task.id), onFinished("Given back to the queue.")))}>
            Give back
          </button>
        </span>
      </div>

      {task.escalationNote && <div className="alert">{task.escalationNote}</div>}
      {task.firstDecision && (
        <div className="alert">
          <span>
            First reviewer: <strong>{task.firstDecision.decision === "APPROVE" ? "verify" : "reject"}</strong>
            {task.firstDecision.reasonCode && ` · ${REJECT_REASONS[task.firstDecision.reasonCode as RejectReason]?.label ?? task.firstDecision.reasonCode}`}
            {task.firstDecision.note && ` · "${task.firstDecision.note}"`}. Check it yourself and decide.
          </span>
        </div>
      )}
      {flagged && (
        <div className="alert cy-reject">
          <span>
            <strong>One of these files was also uploaded by another student.</strong> Look carefully at the name and roll number on it.
          </span>
        </div>
      )}

      {base.student && (
        <dl className="cy-facts panel">
          <div>
            <dt>Name</dt>
            <dd>{base.student.name}</dd>
          </div>
          <div>
            <dt>Roll number</dt>
            <dd>{base.student.rollNo}</dd>
          </div>
          <div>
            <dt>Branch</dt>
            <dd>{base.student.branch}</dd>
          </div>
          <div>
            <dt>Batch</dt>
            <dd>{base.student.batch}</dd>
          </div>
        </dl>
      )}

      <div className="cy-review-grid">
        <section className="panel">
          <h2 className="cy-h3">Marks</h2>
          <MarksTable marks={base.academics} previous={base.type === "ACADEMIC_UPDATE" ? base.previousVerified : undefined} />
        </section>
        <section className="panel">
          <h2 className="cy-h3">Documents</h2>
          <ul className="rows cy-docs">
            {(base.documents ?? []).map((d) => (
              <li key={d.id} className="cy-doc">
                <div className="cy-doc-main">
                  <span className="cy-doc-label">
                    {DOCUMENT_LABELS[d.type]}
                    {d.semester ? `: semester ${d.semester}` : ""}
                  </span>
                  <span className="cy-doc-file">{d.file.originalName}</span>
                </div>
                {d.flags?.duplicateOf?.length ? <span className="stage stuck">Also used by another student</span> : null}
                {d.file.url ? (
                  <a className="button" href={d.file.url} target="_blank" rel="noopener noreferrer">
                    Open
                  </a>
                ) : (
                  <span className="stage working">{d.file.scanStatus === "INFECTED" ? "Blocked file" : "Still being checked"}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {form.error && !Object.keys(form.fieldErrors).length && <Alert>{form.error}</Alert>}

      <section className="panel stack cy-decide">
        <h2 className="cy-h3">Your decision</h2>
        {mode === "reject" && (
          <div className="cy-grid">
            <SelectField label="Reason" value={reason} onChange={(e) => setReason(e.target.value as RejectReason)} error={form.fieldErrors.reasonCode}>
              <option value="">Pick the reason the student will see</option>
              {Object.entries(REJECT_REASONS).map(([k, r]) => (
                <option key={k} value={k}>
                  {r.label}
                </option>
              ))}
            </SelectField>
            <Field label="Note for the student" value={note} onChange={(e) => setNote(e.target.value)} error={form.fieldErrors.note} hint="Say exactly what to fix, e.g. 'Semester 5 scan is cut off at the bottom'." />
          </div>
        )}
        {mode === "escalate" && (
          <Field label="What are you unsure about?" value={note} onChange={(e) => setNote(e.target.value)} hint="The TPO sees this with the profile." />
        )}
        <div className="buttons">
          {mode === "none" && (
            <>
              <button className="primary" type="button" disabled={form.busy} onClick={() => void decide("APPROVE")}>
                Verify
              </button>
              <button type="button" onClick={() => setMode("reject")}>
                Reject…
              </button>
              {task.type !== "SECOND_CHECK" && (
                <button type="button" className="quiet" onClick={() => setMode("escalate")}>
                  Ask the TPO
                </button>
              )}
            </>
          )}
          {mode === "reject" && (
            <>
              <button className="primary" type="button" disabled={form.busy} onClick={() => void decide("REJECT")}>
                Reject with this reason
              </button>
              <button type="button" className="quiet" onClick={() => setMode("none")}>
                Cancel
              </button>
            </>
          )}
          {mode === "escalate" && (
            <>
              <button
                className="primary"
                type="button"
                disabled={form.busy || note.trim().length < 5}
                onClick={() => void form.run(async () => (await workApi.escalate(task.id, note.trim()), onFinished("Sent to the TPO.")))}
              >
                Send to the TPO
              </button>
              <button type="button" className="quiet" onClick={() => setMode("none")}>
                Cancel
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export default function ReviewQueue() {
  useTitle("Review queue");
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [task, setTask] = useState<ReviewTaskView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const form = useApiForm();

  const load = useCallback(async () => {
    try {
      const s = await workApi.summary();
      setSummary(s);
      if (s.current) setTask(await workApi.get(s.current.id));
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Couldn't load the queue.");
    }
  }, []);
  useEffect(() => void load(), [load]);

  const next = () =>
    form.run(async () => {
      setMessage(null);
      const t = await workApi.next();
      setEmpty(!t);
      setTask(t);
      setSummary(await workApi.summary());
    });

  if (loadError) return <EmptyState sprite="blocked" family="ember">{loadError}</EmptyState>;
  if (!summary) {
    return (
      <div className="loading" role="status">
        <Sprite name="reviewer" size={96} plays />
      </div>
    );
  }

  return (
    <>
      <header className="page-head">
        <h1 className="title">Review queue</h1>
        <p className="lead">Take one task at a time. It stays locked to you for 15 minutes.</p>
      </header>

      {summary.pledgeRequired ? (
        <Pledge onDone={() => void load()} />
      ) : task ? (
        <TaskView
          key={task.id}
          task={task}
          onFinished={(msg) => {
            setTask(null);
            setMessage(msg);
            void workApi.summary().then(setSummary);
          }}
        />
      ) : (
        <>
          {message && <Saved>{message}</Saved>}
          {form.error && <Alert>{form.error}</Alert>}
          <dl className="figures cy-queue-figures">
            <div className="figure">
              <dt>Waiting for you</dt>
              <dd>{summary.waitingTotal}</dd>
            </div>
            {Object.entries(summary.waiting).map(([k, n]) => (
              <div className="figure" key={k}>
                <dt>{TYPE_LABELS[k] ?? k}</dt>
                <dd>{n}</dd>
              </div>
            ))}
            <div className="figure">
              <dt>Done by you today</dt>
              <dd>{summary.doneToday}</dd>
            </div>
          </dl>
          {empty || summary.waitingTotal === 0 ? (
            <EmptyState sprite="cheer" family="lime">
              Nothing is waiting for you right now. New profiles show up here as students send them.
            </EmptyState>
          ) : null}
          <p className="buttons">
            <button className="primary" type="button" disabled={form.busy || summary.waitingTotal === 0} onClick={() => void next()}>
              {form.busy ? "Taking…" : "Get next task"}
            </button>
          </p>
        </>
      )}
    </>
  );
}
