import { useCallback, useEffect, useState } from "react";
import { DOCUMENT_LABELS, REJECT_REASONS, type RejectReason } from "@cyrus/shared";
import { SelectField, TextField } from "../../components/form";
import { Aside, Badge, Callout, FilterTabs, PageHeader, Stat, type Tone } from "../../components/kit";
import { useApiForm } from "../../components/useApiForm";
import { Alert, EmptyState, Saved } from "../../components/ui";
import { ApiError, workApi, type AcademicRecord, type ReviewQueueOverview, type ReviewSummary, type ReviewTaskView } from "../../lib/api";
import { since } from "../../lib/time";
import { useTitle } from "../../lib/useTitle";

const TYPE_LABELS: Record<string, string> = {
  STUDENT_VERIFICATION: "Profile check",
  SECOND_CHECK: "Second check",
  ACADEMIC_UPDATE: "Marks change request",
  DUPLICATE_DOCUMENT: "Duplicate document",
};
const PLURAL: Record<string, string> = {
  STUDENT_VERIFICATION: "Profile checks",
  SECOND_CHECK: "Second checks",
  ACADEMIC_UPDATE: "Marks changes",
  DUPLICATE_DOCUMENT: "Duplicates",
};
const RISK: Record<"LOW" | "MEDIUM" | "HIGH", { tone: Tone; label: string }> = {
  LOW: { tone: "success", label: "Low risk" },
  MEDIUM: { tone: "warning", label: "Medium risk" },
  HIGH: { tone: "danger", label: "High risk" },
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
    <div className="panel stack rq-pledge">
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
      <div className="buttons">
        <button className="primary" type="button" disabled={!agree || form.busy} onClick={() => void form.run(async () => (await workApi.pledge(), onDone()))}>
          Accept and start
        </button>
      </div>
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
  if (!marks) return <p className="rq-empty">No marks were entered.</p>;
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
    <table className="rq-marks">
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
                <th scope="row">
                  {changed && <span className="rq-changed-dot" aria-label="Changed" />}
                  {label}
                </th>
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
  const s = base.student;

  const decide = (decision: "APPROVE" | "REJECT") =>
    form.run(
      async () => {
        const r = await workApi.decide(task.id, { decision, reasonCode: decision === "REJECT" ? reason : null, note: note.trim() || null });
        onFinished(OUTCOME[r.outcome] ?? "Saved.");
      },
      decision === "REJECT" && !reason ? { reasonCode: "Pick a reason." } : reason === "OTHER" && !note.trim() ? { note: "Write a short note." } : undefined,
    );

  return (
    <>
      <header className="rq-head">
        <div className="rq-head-text">
          <p className="rq-crumb">
            <span>Review queue</span>
            <span aria-hidden="true">/</span>
            <span>{TYPE_LABELS[task.type] ?? task.type}</span>
          </p>
          <h1 className="rq-title">{s ? s.name : "Task"}</h1>
          {s && (
            <p className="rq-meta">
              <span>{s.rollNo}</span>
              <span>{s.branch}</span>
              <span>Batch {s.batch}</span>
              <Badge tone={RISK[task.risk].tone}>{RISK[task.risk].label}</Badge>
            </p>
          )}
        </div>
        <div className="rq-head-tools">
          {left && (
            <span className={`rq-timer cy-lock${left.ms < 3 * 60000 ? " is-low" : ""}`} role="timer" aria-live="off" title="Locked to you. Others can't take it until the time runs out.">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <circle cx="8" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <path d="M8 5.5v3l2 1.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              {left.text} left
            </span>
          )}
          {left && left.ms < 5 * 60000 && (
            <button type="button" className="small" onClick={() => void form.run(async () => void (await workApi.extend(task.id)))}>
              +15 min
            </button>
          )}
          <button type="button" className="small" onClick={() => void form.run(async () => (await workApi.release(task.id), onFinished("Given back to the queue.")))}>
            Give back
          </button>
        </div>
      </header>

      <div className="ui-split rq-split">
        <div className="rq-main">
          {task.escalationNote && (
            <Callout tone="accent" title="Sent to the TPO">
              {task.escalationNote}
            </Callout>
          )}
          {task.firstDecision && (
            <Callout tone="info" title={`First reviewer: ${task.firstDecision.decision === "APPROVE" ? "verify" : "reject"}`}>
              {task.firstDecision.reasonCode && `${REJECT_REASONS[task.firstDecision.reasonCode as RejectReason]?.label ?? task.firstDecision.reasonCode}. `}
              {task.firstDecision.note && `"${task.firstDecision.note}" `}
              Check it yourself and decide.
            </Callout>
          )}
          {flagged && (
            <Callout tone="danger" title="A file here was also uploaded by another student">
              Look carefully at the name and roll number printed on it.
            </Callout>
          )}

          <section className="rq-card">
            <div className="rq-card-head">
              <h2>Marks</h2>
              <p>{base.type === "ACADEMIC_UPDATE" ? "Changed rows are marked. Compare them with the new marksheet." : "Match every number with the marksheets below."}</p>
            </div>
            <MarksTable marks={base.academics} previous={base.type === "ACADEMIC_UPDATE" ? base.previousVerified : undefined} />
          </section>

          <section className="rq-card">
            <div className="rq-card-head">
              <h2>Marksheets</h2>
              <p>They open in a new tab. Don't download or share them.</p>
            </div>
            {(base.documents ?? []).length ? (
              <ul className="rq-docs">
                {(base.documents ?? []).map((d) => (
                  <li key={d.id}>
                    <span className="rq-doc-icon" aria-hidden="true">
                      <svg viewBox="0 0 16 16" width="16" height="16">
                        <path d="M4 1.5h5.5L12.5 4.5v10h-8.5z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                        <path d="M9.5 1.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="rq-doc-text">
                      <span className="rq-doc-title">
                        {DOCUMENT_LABELS[d.type]}
                        {d.semester ? `, semester ${d.semester}` : ""}
                      </span>
                      <span className="rq-doc-file">{d.file.originalName}</span>
                    </span>
                    {d.flags?.duplicateOf?.length ? <Badge tone="danger">Also used by another student</Badge> : null}
                    {d.file.url ? (
                      <a className="button small" href={d.file.url} target="_blank" rel="noopener noreferrer">
                        Open
                      </a>
                    ) : (
                      <Badge tone="warning">{d.file.scanStatus === "INFECTED" ? "Blocked file" : "Still being cleaned"}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rq-empty">No files were uploaded.</p>
            )}
          </section>
        </div>

        <aside className="rq-decide" aria-label="Your decision">
          <h2>Your decision</h2>
          {form.error && !Object.keys(form.fieldErrors).length && <Alert>{form.error}</Alert>}
          {mode === "none" && (
            <>
              <p className="rq-decide-help">Verify only if every number and name matches. Every decision is recorded with your name.</p>
              <button className="primary rq-wide" type="button" disabled={form.busy} onClick={() => void decide("APPROVE")}>
                Verify
              </button>
              <button className="rq-wide" type="button" onClick={() => setMode("reject")}>
                Reject…
              </button>
              {task.type !== "SECOND_CHECK" && (
                <button type="button" className="quiet rq-ask" onClick={() => setMode("escalate")}>
                  Ask the TPO
                </button>
              )}
            </>
          )}
          {mode === "reject" && (
            <div className="form rq-decide-form">
              <SelectField label="Reason" value={reason} onChange={(e) => setReason(e.target.value as RejectReason)} error={form.fieldErrors.reasonCode}>
                <option value="">Pick the reason the student sees</option>
                {Object.entries(REJECT_REASONS).map(([k, r]) => (
                  <option key={k} value={k}>
                    {r.label}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="Note for the student"
                optional={reason !== "OTHER"}
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                error={form.fieldErrors.note}
                placeholder="e.g. Semester 5 scan is cut off at the bottom."
                hint="Say exactly what to fix."
              />
              <button className="primary rq-wide" type="button" disabled={form.busy} onClick={() => void decide("REJECT")}>
                Reject with this reason
              </button>
              <button type="button" className="rq-wide" onClick={() => setMode("none")}>
                Cancel
              </button>
            </div>
          )}
          {mode === "escalate" && (
            <div className="form rq-decide-form">
              <TextField label="What are you unsure about?" rows={3} value={note} onChange={(e) => setNote(e.target.value)} hint="The TPO sees this with the profile and decides." />
              <button
                className="primary rq-wide"
                type="button"
                disabled={form.busy || note.trim().length < 5}
                onClick={() => void form.run(async () => (await workApi.escalate(task.id, note.trim()), onFinished("Sent to the TPO.")))}
              >
                Send to the TPO
              </button>
              <button type="button" className="rq-wide" onClick={() => setMode("none")}>
                Cancel
              </button>
            </div>
          )}
          <div className="rq-check">
            <p className="rq-check-title">Before you decide</p>
            <ul>
              <li>Name and roll number match on every file</li>
              <li>CGPA and percentages match exactly</li>
              <li>Scans are complete and readable</li>
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}

type Overview = ReviewQueueOverview;
type TabKey = "ALL" | string;

function QueueHome({ data, busy, onStart, onOpen, message }: { data: Overview; busy: boolean; onStart: () => void; onOpen: (id: string) => void; message: string | null }) {
  const [tab, setTab] = useState<TabKey>("ALL");
  const types = data.rules.types.filter((t) => data.waiting.some((w) => w.type === t));
  const rows = tab === "ALL" ? data.waiting : data.waiting.filter((w) => w.type === tab);
  const nextId = data.waiting[0]?.id;
  const r = data.rules;

  return (
    <>
      <PageHeader
        title="Review queue"
        description="Students' profiles and marks waiting for a check. Open any one, or take the next in order; it stays locked to you for 15 minutes."
        actions={
          <button type="button" disabled={busy || data.stats.waiting === 0} onClick={onStart}>
            {busy ? "Taking…" : "Get next task"}
          </button>
        }
      />
      {message && <Saved>{message}</Saved>}

      <div className="ui-split">
        <div className="rq-main">
          <FilterTabs
            label="Task type"
            value={tab}
            onChange={setTab}
            items={[{ key: "ALL", label: "All", count: data.waiting.length }, ...types.map((t) => ({ key: t, label: PLURAL[t] ?? t, count: data.waiting.filter((w) => w.type === t).length }))]}
          />
          {rows.length ? (
            <ul className="ui-rows rq-rows">
              {rows.map((w) => (
                <li key={w.id}>
                  <button type="button" className="ui-row rq-row rq-open" disabled={busy} onClick={() => onOpen(w.id)} aria-label={`Open ${TYPE_LABELS[w.type] ?? w.type} for ${w.student?.name ?? "this student"}`}>
                    <span className={`rq-risk tone-${RISK[w.risk as keyof typeof RISK].tone}`} title={RISK[w.risk as keyof typeof RISK].label} />
                    <span className="ui-row-main">
                      <span className="ui-row-title">
                        {w.student?.name ?? "Unknown student"}
                        {w.id === nextId && <span className="rq-next">Next up</span>}
                      </span>
                      <span className="ui-row-sub">
                        <span>{TYPE_LABELS[w.type] ?? w.type}</span>
                        {w.student && <span>{w.student.rollNo}</span>}
                        {w.student && <span>{w.student.branch} {w.student.batch}</span>}
                      </span>
                      {w.flags.escalationNote && <span className="rq-note">“{w.flags.escalationNote}”</span>}
                    </span>
                    <span className="rq-flags">
                      {w.flags.escalated && <Badge tone="accent">With TPO</Badge>}
                      {w.flags.duplicateFile && <Badge tone="danger">Shared file</Badge>}
                      {w.flags.lockExpired && <Badge tone="neutral">Given back</Badge>}
                    </span>
                    <span className="rq-age" title={`Waiting ${since(w.waitingMinutes)}`}>
                      {since(w.waitingMinutes)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rq-empty-state">
              <p className="rq-empty-title">Nothing waiting</p>
              <p>New profiles show up here as students send them for verification.</p>
            </div>
          )}

          {data.inProgress.length > 0 && (
            <section className="rq-block">
              <h2 className="rq-block-title">Being checked now</h2>
              <ul className="ui-rows">
                {data.inProgress.map((t) => (
                  <li key={t.id}>
                    <div className="ui-row rq-row is-dim">
                      <span className="rq-risk tone-neutral" />
                      <div className="ui-row-main">
                        <span className="ui-row-title">{t.student?.name ?? "Unknown student"}</span>
                        <span className="ui-row-sub">
                          <span>{TYPE_LABELS[t.type] ?? t.type}</span>
                          <span>{t.reviewer ? `by ${t.reviewer}` : "by another reviewer"}</span>
                        </span>
                      </div>
                      <span />
                      <span className="rq-age">{t.minutesLeft} min left</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="rq-side">
          <Aside title="Your work">
            <div className="ui-stats">
              <Stat label="Done today" value={data.stats.doneToday} />
              <Stat label="This week" value={data.stats.doneWeek} />
              <Stat label="Waiting" value={data.stats.waiting} />
              <Stat label="Oldest" value={data.stats.waiting ? since(data.stats.oldestWaitingMinutes) : "—"} />
            </div>
          </Aside>
          {data.recent.length > 0 && (
            <Aside title="Your recent decisions">
              <ul className="ui-mini-list">
                {data.recent.map((d) => (
                  <li key={d.id}>
                    <span className="rq-recent-name">{d.student?.name ?? TYPE_LABELS[d.type] ?? d.type}</span>
                    <span className="rq-recent-what">{d.outcome === "WITH_TPO" ? "With TPO" : d.outcome === "SECOND_CHECK" ? "Awaiting recheck" : d.decision === "APPROVE" ? "Verified" : "Rejected"}</span>
                  </li>
                ))}
              </ul>
            </Aside>
          )}
          <Aside title="How it works">
            <ol className="ui-steps-list">
              <li>
                <span>
                  <strong>Take the next task</strong>The most urgent one comes first.
                </span>
              </li>
              <li>
                <span>
                  <strong>Match the numbers</strong>Every mark against its marksheet.
                </span>
              </li>
              <li>
                <span>
                  <strong>Decide</strong>Verify, reject with a reason, or ask the TPO.
                </span>
              </li>
            </ol>
          </Aside>
          {data.reviewer !== "TPO" && (
            <Aside title="What you get">
              <ul className="rq-rules">
                {r.risks && <li>Only {r.risks.map((x) => x.toLowerCase()).join(" and ")}-risk profiles</li>}
                {r.branches && <li>Branches: {r.branches.join(", ")}</li>}
                {r.batches && <li>Batches: {r.batches.join(", ")}</li>}
                {r.skipsOwnClass && <li>Never students from your own class</li>}
                {r.secondChecked && <li>Staff recheck your decisions before students are told</li>}
              </ul>
            </Aside>
          )}
        </div>
      </div>
    </>
  );
}

export default function ReviewQueue() {
  useTitle("Review queue");
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [task, setTask] = useState<ReviewTaskView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const form = useApiForm();

  const load = useCallback(async () => {
    try {
      const s = await workApi.summary();
      setSummary(s);
      if (s.pledgeRequired) return;
      if (s.current) setTask(await workApi.get(s.current.id));
      else setOverview(await workApi.queue());
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Couldn't load the queue.");
    }
  }, []);
  useEffect(() => void load(), [load]);

  // Open one task from the list. If someone took it a moment ago, say so and refresh the list.
  const open = (id: string) =>
    form.run(async () => {
      setMessage(null);
      try {
        setTask(await workApi.claim(id));
      } catch (e) {
        setOverview(await workApi.queue());
        throw e;
      }
    });

  const next = () =>
    form.run(async () => {
      setMessage(null);
      const t = await workApi.next();
      if (t) setTask(t);
      else {
        setMessage("Someone took the last one. Nothing is waiting for you right now.");
        setOverview(await workApi.queue());
      }
    });

  if (loadError) return <EmptyState sprite="blocked" family="ember">{loadError}</EmptyState>;
  if (!summary) return <div className="loading" role="status" aria-label="Loading" />;

  if (summary.pledgeRequired) {
    return (
      <>
        <PageHeader title="Review queue" description="You check students' profiles against their marksheets. First, one promise." />
        <Pledge onDone={() => void load()} />
      </>
    );
  }

  if (task) {
    return (
      <TaskView
        key={task.id}
        task={task}
        onFinished={(msg) => {
          setTask(null);
          setMessage(msg);
          void workApi.queue().then(setOverview);
        }}
      />
    );
  }

  if (!overview) return <div className="loading" role="status" aria-label="Loading" />;
  return (
    <>
      {form.error && <Alert>{form.error}</Alert>}
      <QueueHome data={overview} busy={form.busy} onStart={() => void next()} onOpen={(id) => void open(id)} message={message} />
    </>
  );
}
