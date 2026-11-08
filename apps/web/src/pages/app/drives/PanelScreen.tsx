import { useCallback, useEffect, useId, useState } from "react";
import { Link, useParams } from "react-router";
import { useAuth } from "../../../app/useAuth";
import { useApiForm } from "../../../components/useApiForm";
import { Alert, EmptyState } from "../../../components/ui";
import { filesApi, interviewsApi, type PanelView, type QueueRow, type Recommendation } from "../../../lib/api";
import { openLink } from "./format";
import { useTitle } from "../../../lib/useTitle";
import { drivePaths } from "./format";

const REC_LABEL: Record<Recommendation, string> = { SELECT: "Select", REJECT: "Reject", HOLD: "Hold" };
const REC_TONE: Record<Recommendation, string> = { SELECT: "done fam-lime", REJECT: "stuck fam-ember", HOLD: "waiting fam-sun" };

/** Minutes and seconds since a moment, ticking every second. */
function useElapsed(from: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!from) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [from]);
  if (!from) return "";
  const s = Math.max(0, Math.floor((now - new Date(from).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** One interview panel on interview day: call the next student, run the interview, write notes. */
export default function PanelScreen() {
  const { panelId } = useParams() as { panelId: string };
  const { role } = useAuth();
  const [panel, setPanel] = useState<PanelView | null>(null);
  const load = useApiForm();
  const act = useApiForm();
  useTitle(panel ? `${panel.name} · ${panel.round.title}` : "Panel");

  const runLoad = load.run;
  const reload = useCallback(() => void runLoad(async () => setPanel(await interviewsApi.panel(panelId))), [panelId, runLoad]);
  useEffect(reload, [reload]);
  // The line changes when HR adds late arrivals or moves people: refresh while nobody is typing notes.
  const typing = panel?.current?.status === "IN_INTERVIEW";
  useEffect(() => {
    if (typing) return;
    const t = setInterval(() => void interviewsApi.panel(panelId).then(setPanel, () => undefined), 5000);
    return () => clearInterval(t);
  }, [panelId, typing]);

  if (!panel) return load.error ? <Alert>{load.error}</Alert> : null;
  const doing = (fn: () => Promise<PanelView>) => void act.run(async () => setPanel(await fn()));
  const manager = role === "TPO" || role === "COMPANY_HR";

  return (
    <>
      <header className="page-head">
        <h1 className="title">
          {panel.name}
          {panel.location ? <span className="faint"> · {panel.location}</span> : null}
        </h1>
        <p className="lead">
          {panel.round.company} · {panel.round.roleTitle} · {panel.round.title}
          {manager && (
            <>
              {" · "}
              <Link to={drivePaths(role).round(panel.round.driveId, panel.round.id)}>Round page</Link>
            </>
          )}
        </p>
      </header>
      {act.error && <Alert>{act.error}</Alert>}

      {!panel.running ? (
        <EmptyState sprite="smith" family="sun">
          {panel.round.status === "SCHEDULED" ? "This round hasn't started yet. The line appears here once HR starts it." : "This round is over."}
        </EmptyState>
      ) : panel.current ? (
        <Current row={panel.current} busy={act.busy} doing={doing} />
      ) : (
        <div className="banner fam-azure cy-next">
          <div className="banner-words">
            <p className="banner-title">{panel.waiting.length ? `${panel.waiting.length} waiting` : "No one waiting"}</p>
            <p className="banner-detail">
              {panel.waiting.length
                ? `Next: ${panel.waiting[0]!.student.name} (${panel.waiting[0]!.student.rollNo}). Calling tells them to come to ${panel.location ?? "your room"}.`
                : "When HR adds more students to your line they'll appear here."}
            </p>
          </div>
          {panel.waiting.length > 0 && (
            <div className="cy-next-actions">
              <button type="button" className="banner-go" disabled={act.busy} onClick={() => doing(() => interviewsApi.callNext(panel.id))}>
                Call next
              </button>
            </div>
          )}
        </div>
      )}

      <div className="cy-two">
        <section>
          <div className="section-head">
            <h2>Waiting</h2>
            <span className="pill">{panel.waiting.length}</span>
            <span className="faint small">About {panel.avgMinutes} min each</span>
          </div>
          {!panel.waiting.length ? (
            <p className="faint">No one.</p>
          ) : (
            <ol className="cy-line">
              {panel.waiting.map((w, i) => (
                <li key={w.id}>
                  <span className="cy-round-no">{i + 1}</span>
                  <span className="cy-line-name">
                    {w.student.name} <span className="faint small">{w.student.rollNo}</span>
                    {w.skipCount > 0 && <span className="stage waiting fam-sun">Skipped once</span>}
                  </span>
                  {panel.running && (
                    <button type="button" className="quiet" disabled={act.busy} onClick={() => doing(() => interviewsApi.skip(w.id))}>
                      Skip
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
        <section>
          <div className="section-head">
            <h2>Done</h2>
            <span className="pill">{panel.done.length}</span>
          </div>
          {!panel.done.length ? (
            <p className="faint">No interviews finished yet.</p>
          ) : (
            <ul className="cy-line">
              {panel.done.map((d) => (
                <li key={d.id}>
                  <span className="cy-line-name">
                    {d.student.name} <span className="faint small">{d.student.rollNo}</span>
                  </span>
                  {d.status === "ABSENT" ? (
                    <>
                      <span className="stage stuck fam-ember">Absent</span>
                      {panel.running && (
                        <button type="button" className="quiet" disabled={act.busy} onClick={() => doing(() => interviewsApi.requeue(d.id))}>
                          Back in line
                        </button>
                      )}
                    </>
                  ) : d.session?.recommendation ? (
                    <span className={`stage ${REC_TONE[d.session.recommendation]}`}>{REC_LABEL[d.session.recommendation]}</span>
                  ) : (
                    <span className="stage idle">No recommendation</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function Current({ row, busy, doing }: { row: QueueRow; busy: boolean; doing: (fn: () => Promise<PanelView>) => void }) {
  const called = useElapsed(row.status === "CALLED" ? row.calledAt : null);
  const inRoom = useElapsed(row.status === "IN_INTERVIEW" ? row.session?.startedAt : null);
  const [notes, setNotes] = useState("");
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [remark, setRemark] = useState("");
  const notesId = useId();
  const remarkId = useId();
  const s = row.student;

  return (
    <section className="panel stack cy-current" aria-label="Current student">
      <div className="cy-current-head">
        <div>
          <p className="cy-h3">{s.name}</p>
          <p className="faint small">
            {s.rollNo} · {s.branch} {s.batch} · CGPA {s.cgpa ?? "—"} · {s.activeBacklogs ? `${s.activeBacklogs} active backlogs` : "no active backlogs"}
          </p>
          {s.skills.length > 0 && <p className="small">Skills: {s.skills.join(", ")}</p>}
          {s.resumeFileId && (
            <p className="small">
              <button type="button" className="quiet cy-inline" onClick={() => void openLink(() => filesApi.link(s.resumeFileId!)).catch(() => undefined)}>
                Open resume
              </button>
            </p>
          )}
          {s.links && s.links.length > 0 && (
            <p className="small">
              {s.links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="cy-link-gap">
                  {l.label}
                </a>
              ))}
            </p>
          )}
        </div>
        {row.status === "CALLED" ? (
          <span className="stage waiting fam-sun">Called {called} ago</span>
        ) : (
          <span className="stage working fam-azure">In interview · {inRoom}</span>
        )}
      </div>

      {row.status === "CALLED" ? (
        <div className="buttons">
          <button type="button" className="primary" disabled={busy} onClick={() => doing(() => interviewsApi.start(row.id))}>
            They're here: start
          </button>
          <button type="button" disabled={busy} onClick={() => doing(() => interviewsApi.skip(row.id))}>
            Not here: skip{row.skipCount ? " (marks absent)" : ""}
          </button>
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor={notesId}>Private notes (the company and the TPO only)</label>
            <textarea id={notesId} rows={4} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <fieldset className="cy-fieldset">
            <legend>Your recommendation</legend>
            <div className="cy-chips">
              {(["SELECT", "HOLD", "REJECT"] as const).map((r) => (
                <label key={r} className="cy-check">
                  <input type="radio" name="rec" checked={rec === r} onChange={() => setRec(r)} /> {REC_LABEL[r]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor={remarkId}>Remark for the student (optional)</label>
            <textarea id={remarkId} rows={2} maxLength={1000} value={remark} onChange={(e) => setRemark(e.target.value)} />
            <p className="field-hint">The placement office checks it before the student sees it. Keep it kind and useful.</p>
          </div>
          <div className="buttons">
            <button type="button" className="primary" disabled={busy} onClick={() => doing(() => interviewsApi.end(row.id, { privateNotes: notes || null, recommendation: rec, feedback: remark || null }))}>
              End interview
            </button>
          </div>
        </>
      )}
    </section>
  );
}
