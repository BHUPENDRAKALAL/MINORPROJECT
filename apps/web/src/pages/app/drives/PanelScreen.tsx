import { useCallback, useEffect, useId, useState } from "react";
import { Link, useParams } from "react-router";
import { useAuth } from "../../../app/useAuth";
import { useApiForm } from "../../../components/useApiForm";
import { Alert } from "../../../components/ui";
import { filesApi, interviewsApi, type PanelView, type QueueRow, type Recommendation } from "../../../lib/api";
import { openLink } from "./format";
import { EarlierRounds, KeyPointsSummary, RatingInput } from "./KeyPoints";
import type { Criterion } from "@cyrus/shared";
import { useTitle } from "../../../lib/useTitle";
import { drivePaths } from "./format";

const REC_LABEL: Record<Recommendation, string> = { SELECT: "Select", REJECT: "Reject", HOLD: "Hold" };

const avg = (r: Record<string, number> | null) => {
  const v = Object.values(r ?? {});
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};

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
      <header className="rq-head">
        <div className="rq-head-text">
          <p className="rq-crumb">
            <span>{panel.round.company}</span>
            <span aria-hidden="true">/</span>
            <span>{panel.round.roleTitle}</span>
            <span aria-hidden="true">/</span>
            {manager ? <Link to={drivePaths(role).round(panel.round.driveId, panel.round.id)}>{panel.round.title}</Link> : <span>{panel.round.title}</span>}
          </p>
          <h1 className="rq-title">
            {panel.name}
            {panel.location ? <span className="ps-room"> · {panel.location}</span> : null}
          </h1>
          <p className="rq-meta">
            <span>About {panel.avgMinutes} min each</span>
          </p>
        </div>
      </header>
      {act.error && <Alert>{act.error}</Alert>}

      <div className="ui-split rq-split">
        <div className="rq-main">
          {!panel.running ? (
            <div className="rq-empty-state">
              <p className="rq-empty-title">{panel.round.status === "SCHEDULED" ? "Not started yet" : "This round is over"}</p>
              <p>{panel.round.status === "SCHEDULED" ? "The line appears here once HR starts the round." : "Thanks. Your notes are with the company."}</p>
            </div>
          ) : panel.current ? (
            <Current row={panel.current} busy={act.busy} doing={doing} criteria={panel.criteria} />
          ) : (
            <section className={`ui-status tone-${panel.waiting.length ? "info" : "neutral"}`} aria-label="Your line">
              <span className="ui-status-dot" aria-hidden="true" />
              <div className="ui-status-text">
                <p className="ui-status-title banner-title">{panel.waiting.length ? `${panel.waiting.length} waiting` : "No one waiting"}</p>
                <p className="ui-status-body">
                  {panel.waiting.length
                    ? `Next: ${panel.waiting[0]!.student.name} (${panel.waiting[0]!.student.rollNo}). Calling tells them to come to ${panel.location ?? "your room"}.`
                    : "When HR adds more students to your line they'll appear here."}
                </p>
              </div>
              {panel.waiting.length > 0 && (
                <div className="ui-status-actions">
                  <button type="button" className="primary" disabled={act.busy} onClick={() => doing(() => interviewsApi.callNext(panel.id))}>
                    Call next
                  </button>
                </div>
              )}
            </section>
          )}
        </div>

        <div className="rq-side">
          <section className="rq-card">
            <div className="rq-card-head rp-card-head">
              <h2>
                Waiting <span className="ui-tab-count">{panel.waiting.length}</span>
              </h2>
            </div>
            {!panel.waiting.length ? (
              <p className="rq-empty">No one.</p>
            ) : (
              <ol className="cy-line ps-line">
                {panel.waiting.map((w, i) => (
                  <li key={w.id}>
                    <span className="ps-pos">{i + 1}</span>
                    <span className="ps-who">
                      <span className="ps-name">{w.student.name}</span>
                      <span className="ps-roll">
                        {w.student.rollNo}
                        {w.skipCount > 0 && " · skipped once"}
                      </span>
                    </span>
                    {panel.running && (
                      <button type="button" className="small" disabled={act.busy} onClick={() => doing(() => interviewsApi.skip(w.id))}>
                        Skip
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="rq-card">
            <div className="rq-card-head rp-card-head">
              <h2>
                Done <span className="ui-tab-count">{panel.done.length}</span>
              </h2>
            </div>
            {!panel.done.length ? (
              <p className="rq-empty">No interviews finished yet.</p>
            ) : (
              <ul className="cy-line ps-line">
                {panel.done.map((d) => (
                  <li key={d.id}>
                    <span className="ps-who">
                      <span className="ps-name">{d.student.name}</span>
                      <span className="ps-roll">{d.student.rollNo}</span>
                    </span>
                    {d.status === "ABSENT" ? (
                      <>
                        <span className="stage stuck fam-ember">Absent</span>
                        {panel.running && (
                          <button type="button" className="small" disabled={act.busy} onClick={() => doing(() => interviewsApi.requeue(d.id))}>
                            Back in line
                          </button>
                        )}
                      </>
                    ) : d.session ? (
                      <details className="cy-done-details ps-done">
                        <summary>
                          {d.session.recommendation ? `Recommended: ${REC_LABEL[d.session.recommendation]}` : "No recommendation"}
                          <span className="ps-done-hint"> · notes</span>
                        </summary>
                        <KeyPointsSummary k={{ ...d.session, average: avg(d.session.ratings) }} criteria={panel.criteria} />
                      </details>
                    ) : (
                      <span className="stage idle">No recommendation</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function Current({ row, busy, doing, criteria }: { row: QueueRow; busy: boolean; doing: (fn: () => Promise<PanelView>) => void; criteria: Criterion[] }) {
  const called = useElapsed(row.status === "CALLED" ? row.calledAt : null);
  const inRoom = useElapsed(row.status === "IN_INTERVIEW" ? row.session?.startedAt : null);
  const [notes, setNotes] = useState("");
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [remark, setRemark] = useState("");
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [strengths, setStrengths] = useState("");
  const [concerns, setConcerns] = useState("");
  const notesId = useId();
  const remarkId = useId();
  const strengthsId = useId();
  const concernsId = useId();
  const lines = (t: string) =>
    t
      .split("\n")
      .map((x) => x.replace(/^[-•*]\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 8);
  const s = row.student;

  return (
    <section className="rq-card cy-current ps-current" aria-label="Current student">
      <div className="ps-cur-head">
        <div className="ps-cur-who">
          <h2 className="ps-cur-name">{s.name}</h2>
          <p className="rq-meta">
            <span>{s.rollNo}</span>
            <span>
              {s.branch} {s.batch}
            </span>
            <span>CGPA {s.cgpa ?? "—"}</span>
            <span>{s.activeBacklogs ? `${s.activeBacklogs} active backlogs` : "No active backlogs"}</span>
          </p>
          {s.skills.length > 0 && (
            <p className="ps-skills">
              {s.skills.map((k) => (
                <span key={k} className="ui-tag">
                  {k}
                </span>
              ))}
            </p>
          )}
          {(s.resumeFileId || (s.links && s.links.length > 0)) && (
            <p className="ps-links">
              {s.resumeFileId && (
                <button type="button" className="small" onClick={() => void openLink(() => filesApi.link(s.resumeFileId!)).catch(() => undefined)}>
                  Open resume
                </button>
              )}
              {s.links?.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="button small">
                  {l.label}
                </a>
              ))}
            </p>
          )}
        </div>
        {row.status === "CALLED" ? (
          <span className="rq-timer is-low">Called {called} ago</span>
        ) : (
          <span className="rq-timer">In interview · {inRoom}</span>
        )}
      </div>

      <div className="ps-earlier">
      <EarlierRounds history={row.history} />
      </div>

      {row.status === "CALLED" ? (
        <div className="ps-actions">
          <button type="button" className="primary" disabled={busy} onClick={() => doing(() => interviewsApi.start(row.id))}>
            They're here: start
          </button>
          <button type="button" disabled={busy} onClick={() => doing(() => interviewsApi.skip(row.id))}>
            Not here: skip{row.skipCount ? " (marks absent)" : ""}
          </button>
        </div>
      ) : (
        <>
          <div className="ps-block">
          <p className="ps-block-title">
            Key points <span className="ps-block-note">The company and the TPO only</span>
          </p>
          <RatingInput criteria={criteria} value={ratings} onChange={setRatings} />
          <div className="form-row ps-two">
            <div className="field">
              <label htmlFor={strengthsId}>Strengths (one per line)</label>
              <textarea id={strengthsId} rows={3} value={strengths} onChange={(e) => setStrengths(e.target.value)} placeholder={"Clean code\nGood with SQL"} />
            </div>
            <div className="field">
              <label htmlFor={concernsId}>Concerns (one per line)</label>
              <textarea id={concernsId} rows={3} value={concerns} onChange={(e) => setConcerns(e.target.value)} placeholder={"Missed edge cases"} />
            </div>
          </div>
          <div className="field">
            <label htmlFor={notesId}>Private notes (the company and the TPO only)</label>
            <textarea id={notesId} rows={3} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          </div>
          <div className="ps-block">
          <fieldset className="cy-fieldset">
            <legend>Your recommendation</legend>
            <div className="cy-chips ps-rec">
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
          </div>
          <div className="ps-actions">
            <button type="button" className="primary" disabled={busy} onClick={() => doing(() =>
                  interviewsApi.end(row.id, {
                    privateNotes: notes || null,
                    recommendation: rec,
                    feedback: remark || null,
                    ratings: Object.keys(ratings).length ? ratings : null,
                    strengths: lines(strengths),
                    concerns: lines(concerns),
                  }),
                )}>
              End interview
            </button>
          </div>
        </>
      )}
    </section>
  );
}
