import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Link, useParams } from "react-router";
import { RESULT_LABELS, ROUND_KINDS, type ResultValue } from "@cyrus/shared";
import { useAuth } from "../../../app/useAuth";
import { Field } from "../../../components/form";
import { useApiForm } from "../../../components/useApiForm";
import { Alert, Saved } from "../../../components/ui";
import { roundsApi, type RoundStudent, type RoundView } from "../../../lib/api";
import { useTitle } from "../../../lib/useTitle";
import { drivePaths, when } from "./format";
import { QrScreen } from "./QrScreen";
import { PanelsSetup } from "./Interviews";
import { interviewsApi, type PanelOpinion } from "../../../lib/api";
import { KeyPointsSummary } from "./KeyPoints";

const ROUND_STATUS: Record<RoundView["status"], [string, string]> = {
  SCHEDULED: ["Not started", "idle"],
  IN_PROGRESS: ["Running", "working fam-azure"],
  RESULTS_PENDING: ["Results being entered", "working fam-sun"],
  RESULTS_PUBLISHED: ["Results published", "done fam-lime"],
  CANCELLED: ["Cancelled", "stuck fam-ember"],
};

const RESULT_TONE: Record<ResultValue, string> = { PENDING: "idle", SELECTED: "done fam-lime", REJECTED: "stuck fam-ember", ON_HOLD: "waiting fam-sun" };

/** One round for HR and the TPO: start it, run check-in, enter and publish results. */
export default function RoundPage() {
  const { id, roundId } = useParams() as { id: string; roundId: string };
  const { role } = useAuth();
  const paths = drivePaths(role);
  const [round, setRound] = useState<RoundView | null>(null);
  const [draft, setDraft] = useState<Record<string, ResultValue>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [recs, setRecs] = useState<Record<string, PanelOpinion>>({});
  const load = useApiForm();
  const act = useApiForm();
  useTitle(round ? round.title : "Round");

  const runLoad = load.run;
  const reload = useCallback(() => void runLoad(async () => setRound(await roundsApi.get(roundId))), [roundId, runLoad]);
  useEffect(reload, [reload]);
  const panelRound = !!round && ["TECHNICAL", "INTERVIEW", "HR"].includes(round.type);
  const roundStatus = round?.status;
  // What the panels recommended, next to each student's result (HR and TPO only).
  useEffect(() => {
    if (!panelRound || !roundStatus || roundStatus === "SCHEDULED") return;
    void interviewsApi.recommendations(roundId).then((r) => setRecs(Object.fromEntries(r.interviews.map((i) => [i.participationId, i]))), () => undefined);
  }, [panelRound, roundStatus, roundId]);

  const changed = useMemo(() => Object.entries(draft).filter(([pid, r]) => round?.students.find((s) => s.participationId === pid)?.result !== r), [draft, round]);

  if (!round) return load.error ? <Alert>{load.error}</Alert> : null;

  const doing = (message: string, fn: () => Promise<RoundView>) =>
    void act.run(async () => {
      setMsg(null);
      setRound(await fn());
      setDraft({});
      setMsg(message);
    });

  const [label, tone] = ROUND_STATUS[round.status];
  const runningNow = round.status === "IN_PROGRESS" || round.status === "RESULTS_PENDING";
  const barTone = round.status === "SCHEDULED" ? "info" : round.status === "CANCELLED" ? "danger" : round.status === "RESULTS_PUBLISHED" ? "success" : round.session ? "info" : "warning";
  const barTitle =
    round.status === "SCHEDULED"
      ? "Not started"
      : round.status === "RESULTS_PUBLISHED"
        ? "Results published"
        : round.status === "CANCELLED"
          ? "Cancelled"
          : round.session
            ? `Check-in is open: ${round.counts.present} of ${round.counts.total} here`
            : round.hasResults
              ? round.counts.pending
                ? `${round.counts.pending} result${round.counts.pending === 1 ? "" : "s"} still to enter`
                : round.counts.onHold
                  ? `${round.counts.onHold} on hold: decide before publishing`
                  : "All results entered"
              : "Talk running";
  const barBody =
    round.status === "SCHEDULED"
      ? (round.can.startBlockedBy ??
        `${round.counts.total} student${round.counts.total === 1 ? " is" : "s are"} in the drive. Starting tells them${round.sequence === 1 ? " and closes joining for good" : ""}.`)
      : round.status === "RESULTS_PUBLISHED"
        ? `${round.hasResults ? `${round.counts.selected} of ${round.counts.total} selected.` : `${round.counts.present} of ${round.counts.total} attended.`}${round.isLast ? " This was the last round." : ""}`
        : !runningNow
          ? ""
          : round.session
            ? "Close check-in when everyone is in. Students who didn't check in then count as absent, unless the placement office marks them by hand."
            : round.hasResults
              ? `${round.counts.selected} selected so far. Students see nothing until you publish.${round.isLast ? " This is the last round: selected students are selected for the job." : ""}`
              : `${round.counts.present} checked in. Finish the talk when it's over; everyone stays in the drive${round.tookAttendance ? " except those absent" : ""}.`;
  const running = round.status === "IN_PROGRESS" || round.status === "RESULTS_PENDING";
  const resultOf = (s: RoundStudent) => draft[s.participationId] ?? s.result;
  // Absent only once check-in is closed; while it's open, everyone may still arrive.
  const needsResult = (s: RoundStudent) => !(round.tookAttendance && !round.session && !s.present);

  async function importFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    await act.run(async () => {
      setMsg(null);
      const r = await roundsApi.importCsv(round!.id, text);
      setRound(r.round);
      setDraft({});
      const notes = [
        `Imported ${r.imported} result${r.imported === 1 ? "" : "s"} from ${file.name}.`,
        r.unknownRolls.length ? `Not in this round: ${r.unknownRolls.join(", ")}.` : "",
        r.badValues.length ? `Couldn't read the result on row${r.badValues.length === 1 ? "" : "s"} ${r.badValues.map((b) => b.row).join(", ")}.` : "",
      ];
      setMsg(notes.filter(Boolean).join(" "));
    });
  }

  return (
    <>
      <header className="rq-head">
        <div className="rq-head-text">
          <p className="rq-crumb">
            <Link to={paths.list}>Drives</Link>
            <span aria-hidden="true">/</span>
            <Link to={paths.item(id)}>{round.drive.roleTitle}</Link>
          </p>
          <h1 className="rq-title">{round.title}</h1>
          <p className="rq-meta">
            <span>Round {round.sequence}</span>
            <span>{ROUND_KINDS[round.type].label}</span>
            <span>{round.mode === "ONLINE" ? "Online" : round.venue || "Venue to be announced"}</span>
            <span>{when(round.startsAt)}</span>
            <span className={`stage ${tone}`}>{label}</span>
          </p>
        </div>
      </header>

      {act.error && <Alert>{act.error}</Alert>}
      {msg && <Saved>{msg}</Saved>}

      {/* What to do next: one quiet bar */}
      <section className={`ui-status tone-${barTone}`} aria-label="Where this round is">
        <span className="ui-status-dot" aria-hidden="true" />
        <div className="ui-status-text">
          <p className="ui-status-title banner-title">{barTitle}</p>
          {barBody && <p className="ui-status-body">{barBody}</p>}
        </div>
        {round.status === "SCHEDULED" && round.can.start && (
          <div className="ui-status-actions">
            <button type="button" className="primary" disabled={act.busy} onClick={() => doing("Round started. Students have been told.", () => roundsApi.start(round.id))}>
              Start the round
            </button>
          </div>
        )}
        {running && round.can.publish && !round.session && (
          <div className="ui-status-actions">
            <button
              type="button"
              className="primary"
              disabled={act.busy || changed.length > 0 || (round.hasResults && (round.counts.pending > 0 || round.counts.onHold > 0))}
              title={changed.length ? "Save your changes first" : undefined}
              onClick={() =>
                window.confirm(
                  round.hasResults
                    ? "Publish the results? Students not selected or absent leave the drive and everyone is told. This can't be undone."
                    : "Finish the talk? Absent students leave the drive.",
                ) && doing(round.hasResults ? "Results published. Everyone has been told." : "Done.", () => roundsApi.publish(round.id))
              }
            >
              {round.hasResults ? "Publish results" : "Finish the talk"}
            </button>
          </div>
        )}
      </section>

      <div className="rq-main">
      {running && round.mode === "OFFLINE" && <CheckIn round={round} onChange={setRound} />}
      {panelRound && <PanelsSetup roundId={round.id} running={running} over={round.status === "RESULTS_PUBLISHED" || round.status === "CANCELLED"} />}

      <section className="rq-card">
        <div className="rq-card-head rp-card-head">
          <div>
            <h2>
              Students <span className="ui-tab-count">{round.students.length}</span>
            </h2>
            {round.can.results && <p>Results stay hidden from students until you publish. A CSV from a test platform needs a roll number column and a result column.</p>}
          </div>
          {round.can.results && (
            <div className="rp-tools cy-round-tools">
              <label className="button rp-file cy-file-button">
                Upload results CSV
                <input type="file" accept=".csv,text/csv" onChange={importFile} hidden />
              </label>
              {Object.keys(recs).length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      ...Object.fromEntries(
                        round.students
                          .filter((s) => needsResult(s) && recs[s.participationId]?.recommendation)
                          .map((s) => [s.participationId, REC_TO_RESULT[recs[s.participationId]!.recommendation!]]),
                      ),
                    }))
                  }
                >
                  Use panel recommendations
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    ...Object.fromEntries(round.students.filter((s) => needsResult(s) && resultOf(s) === "PENDING").map((s) => [s.participationId, "SELECTED" as ResultValue])),
                  }))
                }
              >
                Mark the rest selected
              </button>
              <button type="button" className="primary" disabled={!changed.length || act.busy} onClick={() => doing("Results saved. Not visible to students yet.", () => roundsApi.setResults(round.id, changed.map(([participationId, result]) => ({ participationId, result }))))}>
                Save {changed.length || ""} change{changed.length === 1 ? "" : "s"}
              </button>
            </div>
          )}
        </div>
        {!round.students.length ? (
          <p className="rq-empty">No students in this round.</p>
        ) : (
          <div className="scroll">
            <table className="cy-table dd-table">
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Branch</th>
                  <th scope="col">CGPA</th>
                  {(round.tookAttendance || round.mode === "OFFLINE") && <th scope="col">Attendance</th>}
                  {Object.keys(recs).length > 0 && <th scope="col">Panel</th>}
                  {round.hasResults && <th scope="col">Result</th>}
                </tr>
              </thead>
              <tbody>
                {round.students.map((s) => (
                  <tr key={s.participationId}>
                    <td>
                      <span className="dd-name">{s.name}</span>
                      <span className="dd-roll">{s.rollNo}</span>
                    </td>
                    <td>
                      {s.branch} {s.batch}
                    </td>
                    <td>{s.cgpa ?? "—"}</td>
                    {(round.tookAttendance || round.mode === "OFFLINE") && (
                      <td>
                        <Attendance s={s} round={round} onChange={(r) => (setRound(r), setMsg(null))} />
                      </td>
                    )}
                    {Object.keys(recs).length > 0 && (
                      <td className="small">
                        <PanelSays rec={recs[s.participationId]} />
                      </td>
                    )}
                    {round.hasResults && (
                      <td>
                        {round.can.results && needsResult(s) ? (
                          <select
                            className="cy-result-select"
                            aria-label={`Result for ${s.name}`}
                            value={resultOf(s)}
                            onChange={(e) => setDraft((d) => ({ ...d, [s.participationId]: e.target.value as ResultValue }))}
                          >
                            {(["PENDING", "SELECTED", "REJECTED", "ON_HOLD"] as const).map((v) => (
                              <option key={v} value={v}>
                                {RESULT_LABELS[v]}
                              </option>
                            ))}
                          </select>
                        ) : !needsResult(s) ? (
                          <span className="stage stuck fam-ember">Absent</span>
                        ) : (
                          <span className={`stage ${RESULT_TONE[s.result]}`}>{RESULT_LABELS[s.result]}</span>
                        )}
                        {s.source === "IMPORT" && <span className="faint small"> · from CSV</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </div>
    </>
  );
}

const REC_TO_RESULT = { SELECT: "SELECTED", REJECT: "REJECTED", HOLD: "ON_HOLD" } as const;
const REC_WORD = { SELECT: "Select", REJECT: "Reject", HOLD: "Hold" } as const;

/** The panel's recommendation, ratings and key points for one student. */
function PanelSays({ rec }: { rec?: PanelOpinion }) {
  if (!rec) return <span className="faint">Not in a line</span>;
  if (!rec.recommendation && rec.status !== "DONE") return <span className="faint">{rec.panel}: {rec.status === "ABSENT" ? "Absent" : "Not interviewed yet"}</span>;
  return (
    <details className="cy-done-details">
      <summary>
        {rec.panel}: {rec.recommendation ? REC_WORD[rec.recommendation] : "No recommendation"}
        {rec.average != null ? ` · Avg ${rec.average.toFixed(1)}` : ""}
      </summary>
      <KeyPointsSummary k={rec} />
    </details>
  );
}

function Attendance({ s, round, onChange }: { s: RoundStudent; round: RoundView; onChange: (r: RoundView) => void }) {
  const form = useApiForm();
  const mark = (present: boolean) => {
    const reason = window.prompt(present ? `Why mark ${s.name} present by hand?` : `Why mark ${s.name} absent?`);
    if (!reason || reason.trim().length < 3) return;
    void form.run(async () => onChange(await roundsApi.manual(round.id, { participationId: s.participationId, present, reason: reason.trim() })));
  };
  return (
    <span className="cy-att">
      {s.present ? (
        <span className="stage done fam-lime" title={s.attendance?.reason ?? undefined}>
          {s.attendance?.method === "MANUAL" ? "Present (by hand)" : "Checked in"}
        </span>
      ) : round.tookAttendance || round.session ? (
        <span className="stage idle">Not checked in</span>
      ) : (
        <span className="faint small">—</span>
      )}
      {round.can.manual && (
        <button type="button" className="quiet" disabled={form.busy} onClick={() => mark(!s.present)}>
          {s.present ? "Mark absent" : "Mark present"}
        </button>
      )}
      {form.error && <span className="field-error">{form.error}</span>}
    </span>
  );
}

/** Opening check-in, and the rotating QR for the screen at the venue. */
function CheckIn({ round, onChange }: { round: RoundView; onChange: (r: RoundView) => void }) {
  const [useHere, setUseHere] = useState(round.venueLat == null);
  const [radius, setRadius] = useState(String(round.venueRadiusM ?? 150));
  const [locating, setLocating] = useState(false);
  const form = useApiForm();

  async function open() {
    await form.run(async () => {
      let pos: { lat: number; lng: number } | null = null;
      if (useHere) {
        setLocating(true);
        pos = await new Promise((resolve) =>
          navigator.geolocation
            ? navigator.geolocation.getCurrentPosition(
                (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
                () => resolve(null),
                { enableHighAccuracy: true, timeout: 10_000 },
              )
            : resolve(null),
        );
        setLocating(false);
      }
      await roundsApi.openCheckIn(round.id, { ...(pos ?? {}), radiusM: Number(radius) || 150 });
      onChange(await roundsApi.get(round.id));
    });
  }

  if (round.session) {
    return (
      <section className="rq-card">
        <div className="rq-card-head rp-card-head">
          <h2>
            Check-in <span className="stage working fam-azure">Open</span>
          </h2>
        </div>
        <QrScreen
          sessionId={round.session.id}
          title={`${round.drive.company.name} · ${round.title}`}
          total={round.counts.total}
          located={round.session.venueLat != null}
          onClose={() => void form.run(async () => onChange(await roundsApi.closeCheckIn(round.session!.id)))}
          onArrivals={() => void roundsApi.get(round.id).then(onChange, () => undefined)}
        />
        {form.error && <Alert>{form.error}</Alert>}
      </section>
    );
  }

  return (
    <section className="rq-card">
      <div className="rq-card-head">
        <h2>Check-in</h2>
        <p>Open check-in and put this page on a screen at the venue. Students scan the QR code with their phone. The code changes every few seconds, so a photo shared on a group stops working.</p>
      </div>
      <div className="rp-body">
        {form.error && <Alert>{form.error}</Alert>}
        <label className="cy-check">
          <input type="checkbox" checked={useHere} onChange={(e) => setUseHere(e.target.checked)} /> Only allow check-in near where I am now (uses this device's location)
        </label>
        {useHere && <Field label="How near" size="sm" type="number" min="20" max="2000" value={radius} onChange={(e) => setRadius(e.target.value)} hint="Metres. 150 covers a building; phone GPS indoors can be off by 30–50 m." />}
        <div className="buttons">
          <button type="button" className="primary" disabled={form.busy} onClick={() => void open()}>
            {locating ? "Finding your location…" : round.tookAttendance ? "Open check-in again" : "Open check-in"}
          </button>
        </div>
      </div>
    </section>
  );
}
