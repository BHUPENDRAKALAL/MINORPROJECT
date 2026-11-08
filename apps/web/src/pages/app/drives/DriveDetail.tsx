import { useCallback, useEffect, useId, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useAuth } from "../../../app/useAuth";
import { useApiForm } from "../../../components/useApiForm";
import { Alert, PageTitle, Saved } from "../../../components/ui";
import { drivesApi, type EligibleStudent, type OfficeDrive, type Participant } from "../../../lib/api";
import { useTitle } from "../../../lib/useTitle";
import { FeedbackReview } from "./Interviews";
import { OffersTab } from "./Offers";
import { offersApi } from "../../../lib/api";
import { DriveStatusChip, ParticipationChip, RoundTimeline } from "./shared";
import { drivePaths, eligibilityLines, jobLabel, pay, timeLeft, when } from "./format";

/** One drive for HR and the TPO: what it is, what happens next, and its students. */
export default function DriveDetail() {
  const { id } = useParams() as { id: string };
  const { role } = useAuth();
  const paths = drivePaths(role);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (["students", "feedback", "offers"] as const).find((t) => t === params.get("tab")) ?? "overview";
  const [drive, setDrive] = useState<OfficeDrive | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const load = useApiForm();
  const act = useApiForm();
  useTitle(drive ? drive.roleTitle : "Drive");

  const runLoad = load.run;
  const reload = useCallback(() => void runLoad(async () => setDrive(await drivesApi.get(id))), [id, runLoad]);
  useEffect(reload, [reload]);

  if (!drive) return load.error ? <Alert>{load.error}</Alert> : null;

  const doing = (msg: string, fn: () => Promise<OfficeDrive | void>) =>
    void act.run(async () => {
      setDone(null);
      const d = await fn();
      if (d) setDrive(d);
      setDone(msg);
    });

  return (
    <>
      <header className="page-head">
        <PageTitle trail={[{ label: "Drives", to: paths.list }]} here={drive.roleTitle} />
        <p className="lead cy-drive-sub">
          <span>{drive.company.name}</span>
          <DriveStatusChip status={drive.status} />
        </p>
      </header>

      {act.error && <Alert>{act.error}</Alert>}
      {done && <Saved>{done}</Saved>}
      <NextStep drive={drive} doing={doing} onDelete={() => void act.run(async () => (await drivesApi.remove(drive.id), navigate(paths.list)))} />

      <nav className="tabs" aria-label="Drive sections">
        <a href="?tab=overview" aria-current={tab === "overview" ? "page" : undefined} onClick={(e) => (e.preventDefault(), setParams({}))}>
          Overview
        </a>
        <a href="?tab=students" aria-current={tab === "students" ? "page" : undefined} onClick={(e) => (e.preventDefault(), setParams({ tab: "students" }))}>
          Students <span className="pill">{drive.counts.total}</span>
        </a>
        {["ONGOING", "RESULTS_DECLARED", "CLOSED"].includes(drive.status) && (
          <a href="?tab=offers" aria-current={tab === "offers" ? "page" : undefined} onClick={(e) => (e.preventDefault(), setParams({ tab: "offers" }))}>
            Offers
          </a>
        )}
        {role === "TPO" && drive.status !== "DRAFT" && (
          <a href="?tab=feedback" aria-current={tab === "feedback" ? "page" : undefined} onClick={(e) => (e.preventDefault(), setParams({ tab: "feedback" }))}>
            Feedback to check
          </a>
        )}
      </nav>

      {tab === "overview" ? (
        <Overview drive={drive} />
      ) : tab === "feedback" ? (
        <FeedbackReview driveId={drive.id} />
      ) : tab === "offers" ? (
        <OffersTab driveId={drive.id} />
      ) : (
        <Students drive={drive} onChange={reload} />
      )}
    </>
  );
}

/** The one banner that says where the drive is and the next thing to do. */
function NextStep({ drive, doing, onDelete }: { drive: OfficeDrive; doing: (msg: string, fn: () => Promise<OfficeDrive | void>) => void; onDelete: () => void }) {
  const { role } = useAuth();
  const tpo = role === "TPO";
  const paths = drivePaths(role);
  const [asking, setAsking] = useState<"reject" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const c = drive.can;

  let family = "fam-azure";
  let title = "";
  let detail = "";
  if (drive.status === "DRAFT") {
    family = "fam-sun";
    title = "Draft";
    detail = drive.missing.length ? `Still to add: ${drive.missing.join(", ").toLowerCase()}.` : tpo ? "Everything is filled in. Publish it when ready." : "Everything is filled in. Send it to the placement office.";
  } else if (drive.status === "REJECTED") {
    family = "fam-ember";
    title = "Sent back by the placement office";
    detail = drive.rejectionReason ?? "";
  } else if (drive.status === "PENDING_APPROVAL") {
    family = "fam-sun";
    title = tpo ? "Waiting for your approval" : "Waiting for the placement office";
    detail = tpo ? "Check the details, who can apply and the rounds below, then approve or send it back." : "The TPO is checking it. You'll be told when it's approved. Students see nothing yet.";
  } else if (drive.status === "PUBLISHED" || drive.status === "ONGOING") {
    family = "fam-lime";
    title = drive.counts.total ? `${drive.counts.joined} joined · ${drive.counts.invited} haven't answered` : "Approved. Invite eligible students.";
    detail = `${timeLeft(drive.optInDeadline)} to join (${when(drive.optInDeadline)}).`;
  } else if (drive.status === "CANCELLED") {
    family = "fam-ember";
    title = "Cancelled";
    detail = drive.rejectionReason ?? "";
  } else if (drive.status === "RESULTS_DECLARED") {
    family = "fam-orchid";
    title = "Final results are out";
    detail = tpo ? "Offers are being sent. Close the drive when it's done; HR then can't change anything." : "Send each selected student's offer letter from the Offers tab.";
  } else if (drive.status === "CLOSED") {
    title = "Closed";
    detail = "This drive is finished and kept for the placement history.";
  }

  return (
    <div className={`banner ${family} cy-next`}>
      <div className="banner-words">
        <p className="banner-title">{title}</p>
        {detail && <p className="banner-detail">{detail}</p>}
        {asking && (
          <div className="cy-reason">
            <label htmlFor={reasonId}>{asking === "reject" ? "What should HR change?" : "Why is it cancelled? Students will see this."}</label>
            <textarea id={reasonId} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="buttons">
              <button
                type="button"
                className="banner-go"
                onClick={() => {
                  const r = reason;
                  setAsking(null);
                  setReason("");
                  if (asking === "reject") doing("Sent back to HR with your note.", () => drivesApi.reject(drive.id, r));
                  else doing("Drive cancelled. Students and HR have been told.", () => drivesApi.cancel(drive.id, r));
                }}
              >
                {asking === "reject" ? "Send back" : "Cancel the drive"}
              </button>
              <button type="button" className="quiet" onClick={() => setAsking(null)}>
                Never mind
              </button>
            </div>
          </div>
        )}
      </div>
      {!asking && (
        <div className="cy-next-actions">
          {c.decide && (
            <>
              <button type="button" className="banner-go" onClick={() => doing("Approved. HR can now invite students.", () => drivesApi.approve(drive.id))}>
                Approve
              </button>
              <button type="button" className="banner-go cy-go-quiet" onClick={() => setAsking("reject")}>
                Send back…
              </button>
            </>
          )}
          {c.submit && !drive.missing.length && (
            <Link className="banner-go" to={paths.edit(drive.id, "review")}>
              {tpo ? "Review and publish" : "Review and send"}
            </Link>
          )}
          {(c.edit || c.editRounds) && (
            <Link className="banner-go cy-go-quiet" to={paths.edit(drive.id)}>
              Edit
            </Link>
          )}
          {c.withdraw && (
            <button type="button" className="banner-go cy-go-quiet" onClick={() => doing("Taken back. You can edit it again.", () => drivesApi.withdraw(drive.id))}>
              Take back to edit
            </button>
          )}
          {c.invite && (
            <Link className="banner-go" to="?tab=students">
              Invite students
            </Link>
          )}
          {c.delete && (
            <button type="button" className="banner-go cy-go-quiet" onClick={() => window.confirm("Delete this draft? This can't be undone.") && onDelete()}>
              Delete draft
            </button>
          )}
          {drive.status === "RESULTS_DECLARED" && (
            <Link className="banner-go" to="?tab=offers">
              Offers
            </Link>
          )}
          {tpo && drive.status === "RESULTS_DECLARED" && (
            <button
              type="button"
              className="banner-go cy-go-quiet"
              onClick={() => window.confirm("Close this drive? HR won't be able to send or change offers after this.") && doing("Drive closed.", async () => (await offersApi.closeDrive(drive.id), drivesApi.get(drive.id)))}
            >
              Close drive
            </button>
          )}
          {c.cancel && drive.status !== "DRAFT" && drive.status !== "REJECTED" && drive.status !== "RESULTS_DECLARED" && (
            <button type="button" className="banner-go cy-go-quiet" onClick={() => setAsking("cancel")}>
              Cancel drive…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Overview({ drive }: { drive: OfficeDrive }) {
  const { role } = useAuth();
  const paths = drivePaths(role);
  const live = ["PUBLISHED", "ONGOING", "RESULTS_DECLARED", "CLOSED"].includes(drive.status);
  return (
    <div className="cy-two">
      <section>
        <div className="section-head">
          <h2>Rounds</h2>
        </div>
        <RoundTimeline rounds={drive.rounds} linkTo={live ? (rid) => paths.round(drive.id, rid) : undefined} />
        {live && <p className="faint small">Open a round to start it, run check-in and enter results.</p>}
      </section>
      <section className="stack">
        <div className="panel stack">
          <h2 className="cy-h3">Job</h2>
          <dl className="cy-facts">
            <div><dt>Type</dt><dd>{jobLabel(drive.jobType)}</dd></div>
            <div><dt>Pay</dt><dd>{pay(drive)}</dd></div>
            <div><dt>Location</dt><dd>{drive.location ?? "—"}</dd></div>
            <div><dt>Bond</dt><dd>{drive.bondMonths ? `${drive.bondMonths} months` : "None"}</dd></div>
            <div><dt>Join by</dt><dd>{drive.optInDeadline ? when(drive.optInDeadline) : "—"}</dd></div>
          </dl>
          {drive.description && <p className="small cy-pre">{drive.description}</p>}
        </div>
        <div className="panel stack">
          <h2 className="cy-h3">Who can apply</h2>
          <ul className="cy-list small">{eligibilityLines(drive.eligibility).map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      </section>
    </div>
  );
}

function Students({ drive, onChange }: { drive: OfficeDrive; onChange: () => void }) {
  const [people, setPeople] = useState<Participant[] | null>(null);
  const [eligible, setEligible] = useState<{ count: number; students: EligibleStudent[] } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const form = useApiForm();
  const run = form.run;
  const id = drive.id;

  const load = useCallback(
    () =>
      void run(async () => {
        const [p, e] = await Promise.all([drivesApi.participants(id), drivesApi.preview(id)]);
        setPeople(p.participants);
        setEligible(e);
        setPicked([]);
      }),
    [id, run],
  );
  useEffect(load, [load]);

  const notYet = eligible?.students.filter((s) => !s.inDrive || s.inDrive === "REMOVED") ?? [];
  const invite = (body: { all?: boolean; studentIds?: string[] }) =>
    void run(async () => {
      const r = await drivesApi.invite(id, body);
      setMsg(r.invited ? `Invited ${r.invited} student${r.invited === 1 ? "" : "s"}. They've been told by email.` : "Everyone picked was already invited.");
      load();
      onChange();
    });

  return (
    <div className="stack">
      {form.error && <Alert>{form.error}</Alert>}
      {msg && <Saved>{msg}</Saved>}

      <section>
        <div className="section-head">
          <h2>In this drive</h2>
        </div>
        {people && !people.length && <p className="faint">No one invited yet.</p>}
        {people && people.length > 0 && (
          <div className="scroll">
            <table className="cy-table">
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Branch</th>
                  <th scope="col">CGPA</th>
                  <th scope="col">Answer</th>
                  <th scope="col"><span className="hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.name}
                      <br />
                      <span className="faint small">{p.rollNo}</span>
                    </td>
                    <td>
                      {p.branch} {p.batch}
                    </td>
                    <td>{p.cgpa ?? "—"}</td>
                    <td>
                      <ParticipationChip status={p.status} />
                    </td>
                    <td>
                      {p.status === "INVITED" && drive.can.invite && (
                        <button type="button" className="quiet" onClick={() => void run(async () => (await drivesApi.uninvite(id, p.id), load(), onChange()))}>
                          Take back
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>Eligible, not invited yet</h2>
          {eligible && <span className="pill">{notYet.length}</span>}
        </div>
        {!drive.can.invite && (
          <p className="faint">
            {drive.status === "DRAFT" || drive.status === "REJECTED" || drive.status === "PENDING_APPROVAL"
              ? "You can invite students once the placement office approves the drive. This is who matches right now."
              : "This drive is no longer taking students."}
          </p>
        )}
        {eligible && !notYet.length && <p className="faint">Everyone who matches is already invited.</p>}
        {notYet.length > 0 && (
          <>
            {drive.can.invite && (
              <div className="buttons cy-invite-bar">
                <button type="button" className="primary" disabled={form.busy} onClick={() => invite({ all: true })}>
                  Invite all {notYet.length} eligible
                </button>
                <button type="button" disabled={form.busy || !picked.length} onClick={() => invite({ studentIds: picked })}>
                  Invite {picked.length || ""} picked
                </button>
              </div>
            )}
            <div className="scroll">
              <table className="cy-table">
                <thead>
                  <tr>
                    {drive.can.invite && <th scope="col"><span className="hidden">Pick</span></th>}
                    <th scope="col">Student</th>
                    <th scope="col">Branch</th>
                    <th scope="col">CGPA</th>
                    <th scope="col">Backlogs</th>
                  </tr>
                </thead>
                <tbody>
                  {notYet.map((s) => (
                    <tr key={s.id}>
                      {drive.can.invite && (
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Pick ${s.name}`}
                            checked={picked.includes(s.id)}
                            onChange={(e) => setPicked((x) => (e.target.checked ? [...x, s.id] : x.filter((k) => k !== s.id)))}
                          />
                        </td>
                      )}
                      <td>
                        {s.name}
                        <br />
                        <span className="faint small">{s.rollNo}</span>
                      </td>
                      <td>
                        {s.branch} {s.batch}
                      </td>
                      <td>{s.cgpa ?? "—"}</td>
                      <td>{s.activeBacklogs ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="faint small">Only verified students who match the drive's rules are listed. Contact details are shared with the company only after a student joins.</p>
          </>
        )}
      </section>
    </div>
  );
}
