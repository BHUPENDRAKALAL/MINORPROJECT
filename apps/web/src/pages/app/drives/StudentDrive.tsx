import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { PARTICIPATION_LABELS } from "@cyrus/shared";
import { Aside, Badge } from "../../../components/kit";
import { useApiForm } from "../../../components/useApiForm";
import { Alert } from "../../../components/ui";
import { drivesApi, offersApi, type StudentDriveView } from "../../../lib/api";
import { OfferChip } from "./Offers";
import { openLink } from "./format";
import { useTitle } from "../../../lib/useTitle";
import { RoundTimeline } from "./shared";
import { PARTICIPATION_TONE, eligibilityLines, jobLabel, pay, timeLeft, when } from "./format";

type Full = Extract<StudentDriveView, { inDrive: true }>;

export default function StudentDrive() {
  const { id } = useParams() as { id: string };
  const [drive, setDrive] = useState<StudentDriveView | null>(null);
  const load = useApiForm();
  const run = load.run;
  useEffect(() => void run(async () => setDrive(await drivesApi.mineOne(id))), [id, run]);
  // While I'm in an interview line or check-in is open, keep my place and turn up to date.
  const live = !!drive && drive.inDrive && drive.rounds.some((r) => r.my?.checkInOpen || (r.my?.line && ["WAITING", "CALLED", "IN_INTERVIEW"].includes(r.my.line.status)));
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void drivesApi.mineOne(id).then(setDrive, () => undefined), 10_000);
    return () => clearInterval(t);
  }, [id, live]);
  useTitle(drive ? `${drive.company} · ${drive.roleTitle}` : "Drive");

  if (!drive) return load.error ? <Alert>{load.error}</Alert> : null;

  return (
    <>
      <header className="rq-head">
        <div className="rq-head-text">
          <p className="rq-crumb">
            <Link to="/student/drives">Drives</Link>
            <span aria-hidden="true">/</span>
            <span>{drive.company}</span>
          </p>
          <h1 className="rq-title">{drive.roleTitle}</h1>
          <p className="rq-meta">
            <span>{drive.company}</span>
            <span>{jobLabel(drive.jobType)}</span>
            {drive.inDrive ? <Badge tone={PARTICIPATION_TONE[drive.me.status]}>{PARTICIPATION_LABELS[drive.me.status]}</Badge> : <Badge tone="neutral">Invite only</Badge>}
          </p>
        </div>
      </header>
      {drive.inDrive ? (
        <FullDrive drive={drive} onChange={setDrive} />
      ) : (
        <div className="rq-empty-state sd-locked">
          <p className="rq-empty-title">Only invited students can see this drive</p>
          <p>
            {drive.company} is hiring for {drive.roleTitle}. Invites go by email to verified students who match the company's rules.
          </p>
        </div>
      )}
    </>
  );
}

function Answer({ drive, onChange }: { drive: Full; onChange: (d: StudentDriveView) => void }) {
  const [agree, setAgree] = useState(false);
  const form = useApiForm();
  const { me } = drive;
  if (drive.status === "CANCELLED") {
    return (
      <section className="ui-status tone-danger" aria-label="Where you are in this drive">
        <span className="ui-status-dot" aria-hidden="true" />
        <div className="ui-status-text">
          <p className="ui-status-title">This drive was cancelled</p>
          {drive.cancelReason && <p className="ui-status-body">{drive.cancelReason}</p>}
        </div>
      </section>
    );
  }

  const checkInRound = drive.rounds.find((r) => r.my?.checkInOpen && !r.my.attended);
  const TEXT: Partial<Record<typeof me.status, [string, string, string]>> = {
    INVITED: ["You're invited to this drive", "", "warning"],
    OPTED_IN: ["You've joined this drive", "Follow the rounds below. You'll be told when results or the schedule change.", "success"],
    OPTED_OUT: ["You skipped this drive", "", "warning"],
    EXPIRED: ["You didn't answer in time", "The joining deadline has passed.", "warning"],
    ELIMINATED: ["You're out of this drive", "You weren't selected in one of the rounds. Your results are below. Keep going: other drives are coming.", "warning"],
    NO_SHOW: ["You were marked absent", "You missed a round after joining, so you're out of this drive. Talk to the placement office if this is a mistake.", "danger"],
    SELECTED: ["You're selected!", "You cleared every round. The company will share the offer letter here.", "success"],
    OFFERED: ["You have an offer", "Read the letter and answer before the deadline.", "success"],
    PLACED: ["You're placed!", "You accepted this offer. Congratulations. The placement office has your placement on record.", "success"],
    OFFER_DECLINED: ["You declined this offer", "You can still take part in other drives you're invited to.", "warning"],
  };
  const [title, base, tone] = TEXT[me.status] ?? ["", "", "warning"];
  const detail =
    me.status === "OPTED_IN" && checkInRound
      ? `Check-in is open for ${checkInRound.title}. Scan the QR code on the screen at the venue with your phone camera.`
      : me.status === "OPTED_IN"
        ? `${base}${me.canSkip ? ` You can still leave until ${when(drive.optInDeadline)}.` : ""}`
        : me.canJoin || me.canSkip
          ? `Answer by ${when(drive.optInDeadline)} (${timeLeft(drive.optInDeadline).toLowerCase()}). You can change your mind until then.`
          : base;

  return (
    <section className={`ui-status sd-status tone-${tone}`} aria-label="Where you are in this drive">
      <span className="ui-status-dot" aria-hidden="true" />
      <div className="ui-status-text">
        <p className="ui-status-title">{title}</p>
        {detail && <p className="ui-status-body">{detail}</p>}
        {form.error && <p className="ui-status-body sd-error">{form.error}</p>}
        {me.canJoin && (
          <label className="sd-consent">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I agree to share my profile, marks and resume with {drive.company}.
          </label>
        )}
      </div>
      {(me.canJoin || me.canSkip) && (
        <div className="ui-status-actions">
          {me.canJoin && (
            <button type="button" className="primary" disabled={!agree || form.busy} onClick={() => void form.run(async () => onChange(await drivesApi.join(drive.id)))}>
              Join the drive
            </button>
          )}
          {me.canSkip && (
            <button type="button" disabled={form.busy} onClick={() => void form.run(async () => onChange(await drivesApi.skip(drive.id)))}>
              {me.status === "OPTED_IN" ? "Leave the drive" : "Skip"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function FullDrive({ drive, onChange }: { drive: Full; onChange: (d: StudentDriveView) => void }) {
  return (
    <>
      <Answer drive={drive} onChange={onChange} />
      <div className="ui-split rq-split">
        <div className="rq-main">
          {drive.offer && <OfferCard drive={drive} onChange={onChange} />}
          {drive.selected && drive.selected.count > 0 && <SelectedCard drive={drive} />}
          <section className="rq-card">
            <div className="rq-card-head">
              <h2>Rounds</h2>
              <p>
                {drive.rounds.length} round{drive.rounds.length === 1 ? "" : "s"}, in order. Your check-in, place in line and results show under each one.
                {drive.me.canJoin && drive.rounds.some((r) => r.mode === "ONLINE") && " Online test links appear after you join."}
              </p>
            </div>
            <div className="sd-rounds">
              <RoundTimeline rounds={drive.rounds} />
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
          <Aside title="The job">
            <dl className="sh-facts sd-facts">
              <div><dt>Type</dt><dd>{jobLabel(drive.jobType)}</dd></div>
              <div><dt>Pay</dt><dd>{pay(drive)}</dd></div>
              <div><dt>Location</dt><dd>{drive.location ?? "Not given"}</dd></div>
              <div><dt>Bond</dt><dd>{drive.bondMonths ? `${drive.bondMonths} months` : "None"}</dd></div>
              <div><dt>Join by</dt><dd>{when(drive.optInDeadline)}</dd></div>
            </dl>
          </Aside>
          <Aside title={`About ${drive.company}`}>
            {drive.companyAbout ? <p className="sd-about">{drive.companyAbout}</p> : <p className="sd-about faint">No description yet.</p>}
            {drive.companyWebsite && (
              <a className="sd-site" href={drive.companyWebsite} target="_blank" rel="noreferrer">
                {drive.companyWebsite.replace(/^https?:\/\//, "")}
              </a>
            )}
          </Aside>
          <Aside title="Who could apply">
            <ul className="rq-rules">{eligibilityLines(drive.eligibility).map((l) => <li key={l}>{l}</li>)}</ul>
          </Aside>
        </div>
      </div>
    </>
  );
}

const SELECTED_ME = new Set(["SELECTED", "OFFERED", "PLACED"]);

/** Who was selected: the count once the final results are out; names once the placement office announces them. */
function SelectedCard({ drive }: { drive: Full }) {
  const sel = drive.selected!;
  const me = SELECTED_ME.has(drive.me.status);
  const others = sel.count - (me ? 1 : 0);
  const head = me
    ? sel.count === 1
      ? "You're the only one selected"
      : `You're 1 of ${sel.count} selected`
    : `${sel.count} student${sel.count === 1 ? "" : "s"} selected`;
  return (
    <section className="rq-card sd-selected" aria-label="Who was selected">
      <div className="rq-card-head">
        <h2>{head}</h2>
        <p>
          {sel.announcedAt
            ? `Announced by the placement office ${when(sel.announcedAt)}.${sel.hidden ? " Some students chose not to be named." : ""}`
            : `The placement office hasn't announced the names yet${me && others ? `, so you'll see who the other ${others === 1 ? "one is" : others} are once it does` : ""}.`}
        </p>
      </div>
      {sel.announcedAt && (
        <ul className="sd-sel-list">
          {sel.names.map((n) => (
            <li key={`${n.name}-${n.branch}`}>
              <span className="sd-sel-avatar" aria-hidden="true">
                {n.name
                  .split(/\s+/)
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <span className="sd-sel-name">{n.name}</span>
              <span className="sd-sel-branch">{n.branch}</span>
            </li>
          ))}
          {sel.hidden > 0 && <li className="sd-sel-more">+{sel.hidden} more who chose not to be named</li>}
        </ul>
      )}
      {sel.announcedAt && me && (
        <p className="sd-sel-foot">
          Don't want your name here? <Link to="/student/profile">Turn it off in your profile</Link>.
        </p>
      )}
    </section>
  );
}

/** The student's offer: read the letter, accept or decline before the deadline. */
function OfferCard({ drive, onChange }: { drive: Full; onChange: (d: StudentDriveView) => void }) {
  const form = useApiForm();
  const o = drive.offer!;
  const answer = (accept: boolean) =>
    window.confirm(accept ? `Accept the offer from ${drive.company}? You'll be marked placed, and the college's one-offer rule applies.` : `Decline the offer from ${drive.company}? This can't be undone.`) &&
    void form.run(async () => {
      await (accept ? offersApi.accept(o.id) : offersApi.decline(o.id));
      onChange(await drivesApi.mineOne(drive.id));
    });
  return (
    <section className="rq-card sd-offer" aria-label="Your offer">
      <div className="rq-card-head sd-offer-head">
        <h2>Offer: {o.roleTitle}</h2>
        <OfferChip status={o.status} forStudent />
      </div>
      <dl className="sd-offer-facts">
        <div>
          <dt>CTC</dt>
          <dd>{o.ctcLpa != null ? `₹${o.ctcLpa} LPA` : "As in the letter"}</dd>
        </div>
        <div>
          <dt>Joining</dt>
          <dd>{o.joiningDate ? when(o.joiningDate, false) : "As in the letter"}</dd>
        </div>
        <div>
          <dt>{o.status === "SENT" ? "Answer by" : "Answered"}</dt>
          <dd>{o.status === "SENT" ? when(o.respondBy) : o.respondedAt ? when(o.respondedAt) : "—"}</dd>
        </div>
      </dl>
      {form.error && <Alert>{form.error}</Alert>}
      <div className="sd-offer-actions">
        <button type="button" onClick={() => void form.run(() => openLink(() => offersApi.letter(o.id)))}>
          Read the offer letter
        </button>
        {o.status === "SENT" && (
          <>
            <button type="button" className="primary" disabled={form.busy} onClick={() => answer(true)}>
              Accept offer
            </button>
            <button type="button" className="sd-decline" disabled={form.busy} onClick={() => answer(false)}>
              Decline
            </button>
          </>
        )}
      </div>
      {o.status === "EXPIRED" && <p className="sd-offer-note">The deadline passed without an answer. Talk to the placement office if you still want this offer.</p>}
    </section>
  );
}
