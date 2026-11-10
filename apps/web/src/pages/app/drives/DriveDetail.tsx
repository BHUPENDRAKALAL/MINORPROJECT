import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useAuth } from "../../../app/useAuth";
import { useApiForm } from "../../../components/useApiForm";
import { Aside, Stat } from "../../../components/kit";
import { Alert, Saved } from "../../../components/ui";
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
      <header className="rq-head">
        <div className="rq-head-text">
          <p className="rq-crumb">
            <Link to={paths.list}>Drives</Link>
            <span aria-hidden="true">/</span>
            <span>{drive.company.name}</span>
          </p>
          <h1 className="rq-title">{drive.roleTitle}</h1>
          <p className="rq-meta">
            <span>{drive.company.name}</span>
            <span>{jobLabel(drive.jobType)}</span>
            <span>{pay(drive)}</span>
            {drive.location && <span>{drive.location}</span>}
            <DriveStatusChip status={drive.status} />
          </p>
        </div>
      </header>

      {act.error && <Alert>{act.error}</Alert>}
      {done && <Saved>{done}</Saved>}
      <NextStep drive={drive} doing={doing} onDelete={() => void act.run(async () => (await drivesApi.remove(drive.id), navigate(paths.list)))} />

      <nav className="ui-tabs dd-tabs" aria-label="Drive sections">
        <a className="ui-tab" href="?tab=overview" aria-current={tab === "overview" ? "page" : undefined} onClick={(e) => (e.preventDefault(), setParams({}))}>
          Overview
        </a>
        <a className="ui-tab" href="?tab=students" aria-current={tab === "students" ? "page" : undefined} onClick={(e) => (e.preventDefault(), setParams({ tab: "students" }))}>
          Students <span className="ui-tab-count">{drive.counts.total}</span>
        </a>
        {["ONGOING", "RESULTS_DECLARED", "CLOSED"].includes(drive.status) && (
          <a className="ui-tab" href="?tab=offers" aria-current={tab === "offers" ? "page" : undefined} onClick={(e) => (e.preventDefault(), setParams({ tab: "offers" }))}>
            Offers
          </a>
        )}
        {role === "TPO" && drive.status !== "DRAFT" && (
          <a className="ui-tab" href="?tab=feedback" aria-current={tab === "feedback" ? "page" : undefined} onClick={(e) => (e.preventDefault(), setParams({ tab: "feedback" }))}>
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

/** One quiet bar: where the drive is, the next thing to do, and the rarer actions behind "More". */
function NextStep({ drive, doing, onDelete }: { drive: OfficeDrive; doing: (msg: string, fn: () => Promise<OfficeDrive | void>) => void; onDelete: () => void }) {
  const { role } = useAuth();
  const tpo = role === "TPO";
  const paths = drivePaths(role);
  const [asking, setAsking] = useState<"reject" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const c = drive.can;
  // How many students match the rules but aren't invited yet: the invite button shows only while there are some.
  const [notInvited, setNotInvited] = useState<number | null>(null);
  const canInvite = c.invite;
  const invitedNow = drive.counts.total;
  useEffect(() => {
    if (!canInvite) return;
    let gone = false;
    drivesApi.preview(drive.id).then(
      (r) => !gone && setNotInvited(r.students.filter((x) => !x.inDrive || x.inDrive === "REMOVED").length),
      () => !gone && setNotInvited(null),
    );
    return () => {
      gone = true;
    };
  }, [canInvite, drive.id, invitedNow]);

  let tone = "neutral";
  let title = "";
  let detail = "";
  if (drive.status === "DRAFT") {
    tone = "warning";
    title = "Draft";
    detail = drive.missing.length ? `Still to add: ${drive.missing.join(", ").toLowerCase()}.` : tpo ? "Everything is filled in. Publish it when ready." : "Everything is filled in. Send it to the placement office.";
  } else if (drive.status === "REJECTED") {
    tone = "danger";
    title = "Sent back by the placement office";
    detail = drive.rejectionReason ?? "";
  } else if (drive.status === "PENDING_APPROVAL") {
    tone = "warning";
    title = tpo ? "Waiting for your approval" : "Waiting for the placement office";
    detail = tpo ? "Check the details, who can apply and the rounds below, then approve or send it back." : "The TPO is checking it. You'll be told when it's approved. Students see nothing yet.";
  } else if (drive.status === "PUBLISHED" || drive.status === "ONGOING") {
    tone = "success";
    title = drive.counts.total ? `${drive.counts.joined} joined · ${drive.counts.invited} haven't answered` : "Approved. Invite eligible students.";
    detail = `${timeLeft(drive.optInDeadline)} to join (${when(drive.optInDeadline)}).`;
  } else if (drive.status === "CANCELLED") {
    tone = "danger";
    title = "Cancelled";
    detail = drive.rejectionReason ?? "";
  } else if (drive.status === "RESULTS_DECLARED") {
    tone = "accent";
    title = "Final results are out";
    detail = tpo ? "Offers are being sent. Close the drive when it's done; HR then can't change anything." : "Send each selected student's offer letter from the Offers tab.";
  } else if (drive.status === "CLOSED") {
    title = "Closed";
    detail = "This drive is finished and kept for the placement history.";
  }

  type Act = { label: string; to?: string; run?: () => void; danger?: boolean };
  const main: Act[] = [];
  const more: Act[] = [];
  if (c.decide) {
    main.push({ label: "Approve", run: () => doing("Approved. HR can now invite students.", () => drivesApi.approve(drive.id)) });
    main.push({ label: "Send back…", run: () => setAsking("reject") });
  }
  if (c.submit && !drive.missing.length) main.push({ label: tpo ? "Review and publish" : "Review and send", to: paths.edit(drive.id, "review") });
  if (c.invite && notInvited !== 0) main.push({ label: invitedNow && notInvited ? `Invite ${notInvited} more` : "Invite students", to: "?tab=students" });
  if (drive.status === "RESULTS_DECLARED") main.push({ label: "Offers", to: "?tab=offers" });
  if (c.edit || c.editRounds) (main.length ? more : main).push({ label: "Edit drive", to: paths.edit(drive.id) });
  if (c.withdraw) more.push({ label: "Take back to edit", run: () => doing("Taken back. You can edit it again.", () => drivesApi.withdraw(drive.id)) });
  if (tpo && drive.status === "RESULTS_DECLARED")
    more.push({
      label: "Close drive",
      run: () => window.confirm("Close this drive? HR won't be able to send or change offers after this.") && doing("Drive closed.", async () => (await offersApi.closeDrive(drive.id), drivesApi.get(drive.id))),
    });
  if (c.delete) more.push({ label: "Delete draft", danger: true, run: () => window.confirm("Delete this draft? This can't be undone.") && onDelete() });
  if (c.cancel && !["DRAFT", "REJECTED", "RESULTS_DECLARED"].includes(drive.status)) more.push({ label: "Cancel drive…", danger: true, run: () => setAsking("cancel") });

  const button = (a: Act, i: number) =>
    a.to ? (
      <Link key={a.label} className={`button${i === 0 ? " primary" : ""}`} to={a.to}>
        {a.label}
      </Link>
    ) : (
      <button key={a.label} type="button" className={i === 0 ? "primary" : undefined} onClick={a.run}>
        {a.label}
      </button>
    );

  return (
    <section className={`ui-status tone-${tone}`} aria-label="Where this drive is">
      <span className="ui-status-dot" aria-hidden="true" />
      <div className="ui-status-text">
        <p className="ui-status-title banner-title">{title}</p>
        {detail && <p className="ui-status-body">{detail}</p>}
      </div>
      {!asking && (main.length > 0 || more.length > 0) && (
        <div className="ui-status-actions">
          {main.map(button)}
          {more.length > 0 && <MoreMenu items={more} />}
        </div>
      )}
      {asking && (
        <div className="ui-status-ask">
          <label htmlFor={reasonId}>{asking === "reject" ? "What should HR change?" : "Why is it cancelled? Students will see this."}</label>
          <textarea id={reasonId} rows={2} value={reason} autoFocus onChange={(e) => setReason(e.target.value)} />
          <div className="buttons">
            <button
              type="button"
              className="primary"
              disabled={!reason.trim()}
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
            <button type="button" onClick={() => setAsking(null)}>
              Never mind
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** The less common actions, behind one "More" button, so the bar holds one or two buttons at most. */
function MoreMenu({ items }: { items: { label: string; to?: string; run?: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="ui-more" ref={ref}>
      <button type="button" className="ui-more-toggle" aria-expanded={open} aria-haspopup="menu" aria-label="More actions" onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.4" fill="currentColor" />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" />
          <circle cx="12.5" cy="8" r="1.4" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="ui-more-menu" role="menu">
          {items.map((a) =>
            a.to ? (
              <Link key={a.label} role="menuitem" className={`ui-more-item${a.danger ? " is-danger" : ""}`} to={a.to} onClick={() => setOpen(false)}>
                {a.label}
              </Link>
            ) : (
              <button
                key={a.label}
                type="button"
                role="menuitem"
                className={`ui-more-item${a.danger ? " is-danger" : ""}`}
                onClick={() => {
                  setOpen(false);
                  a.run?.();
                }}
              >
                {a.label}
              </button>
            ),
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
  const c = drive.counts;
  return (
    <div className="ui-split rq-split">
      <div className="rq-main">
        <section className="rq-card">
          <div className="rq-card-head dd-card-head">
            <div>
              <h2>Rounds</h2>
              <p>{live ? "Open a round to start it, run check-in and enter results." : "Rounds open once the drive is approved."}</p>
            </div>
            {(drive.can.edit || drive.can.editRounds) && (
              <Link className="button small" to={paths.edit(drive.id, "rounds")}>
                Edit rounds
              </Link>
            )}
          </div>
          <div className="sd-rounds">
            <RoundTimeline rounds={drive.rounds} linkTo={live ? (rid) => paths.round(drive.id, rid) : undefined} />
          </div>
        </section>
        {drive.description && (
          <section className="rq-card">
            <div className="rq-card-head">
              <h2>About the job</h2>
            </div>
            <p className="sd-desc">{drive.description}</p>
          </section>
        )}
      </div>
      <div className="rq-side">
        <Aside title="Students">
          <div className="ui-stats">
            <Stat label="Invited" value={c.total} />
            <Stat label="Joined" value={c.joined} />
            <Stat label="Still to answer" value={c.invited} />
            <Stat label="Skipped or out" value={Math.max(0, c.total - c.joined - c.invited)} />
          </div>
        </Aside>
        <Aside title="The job">
          <dl className="sh-facts sd-facts">
            <div><dt>Type</dt><dd>{jobLabel(drive.jobType)}</dd></div>
            <div><dt>Pay</dt><dd>{pay(drive)}</dd></div>
            <div><dt>Location</dt><dd>{drive.location ?? "Not given"}</dd></div>
            <div><dt>Bond</dt><dd>{drive.bondMonths ? `${drive.bondMonths} months` : "None"}</dd></div>
            <div><dt>Join by</dt><dd>{drive.optInDeadline ? when(drive.optInDeadline) : "Not set"}</dd></div>
          </dl>
        </Aside>
        <Aside title="Who can apply">
          <ul className="rq-rules">{eligibilityLines(drive.eligibility).map((l) => <li key={l}>{l}</li>)}</ul>
        </Aside>
      </div>
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
    <div className="rq-main">
      {form.error && <Alert>{form.error}</Alert>}
      {msg && <Saved>{msg}</Saved>}

      <section className="rq-card">
        <div className="rq-card-head">
          <h2>In this drive</h2>
          <p>Everyone invited, and their answer. Contact details unlock when a student joins.</p>
        </div>
        {people && !people.length && <p className="rq-empty">No one invited yet.</p>}
        {people && people.length > 0 && (
          <div className="scroll">
            <table className="cy-table dd-table">
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
                      <span className="dd-name">{p.name}</span>
                      <span className="dd-roll">{p.rollNo}</span>
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
                        <button type="button" className="small" onClick={() => void run(async () => (await drivesApi.uninvite(id, p.id), load(), onChange()))}>
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

      <section className="rq-card">
        <div className="rq-card-head dd-card-head">
          <div>
            <h2>
              Eligible, not invited yet {eligible && <span className="ui-tab-count">{notYet.length}</span>}
            </h2>
            <p>Verified students who match the drive's rules.</p>
          </div>
          {drive.can.invite && notYet.length > 0 && (
            <div className="dd-invite">
              <button type="button" disabled={form.busy || !picked.length} onClick={() => invite({ studentIds: picked })}>
                Invite {picked.length || ""} picked
              </button>
              <button type="button" className="primary" disabled={form.busy} onClick={() => invite({ all: true })}>
                Invite all {notYet.length} eligible
              </button>
            </div>
          )}
        </div>
        {!drive.can.invite && (
          <p className="rq-empty">
            {drive.status === "DRAFT" || drive.status === "REJECTED" || drive.status === "PENDING_APPROVAL"
              ? "You can invite students once the placement office approves the drive. This is who matches right now."
              : "This drive is no longer taking students."}
          </p>
        )}
        {eligible && !notYet.length && <p className="rq-empty">Everyone who matches is already invited.</p>}
        {notYet.length > 0 && (
          <>
            <div className="scroll">
              <table className="cy-table dd-table">
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
                        <span className="dd-name">{s.name}</span>
                        <span className="dd-roll">{s.rollNo}</span>
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
            <p className="dd-foot">Only verified students who match the drive's rules are listed. Contact details are shared with the company only after a student joins.</p>
          </>
        )}
      </section>
    </div>
  );
}
