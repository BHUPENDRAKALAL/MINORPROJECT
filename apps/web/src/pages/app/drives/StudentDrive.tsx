import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useApiForm } from "../../../components/useApiForm";
import { Alert, EmptyState, PageTitle } from "../../../components/ui";
import { drivesApi, offersApi, type StudentDriveView } from "../../../lib/api";
import { OfferChip } from "./Offers";
import { openLink } from "./format";
import { useTitle } from "../../../lib/useTitle";
import { DriveStatusChip, ParticipationChip, RoundTimeline } from "./shared";
import { eligibilityLines, jobLabel, pay, timeLeft, when } from "./format";

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
      <header className="page-head">
        <PageTitle trail={[{ label: "Drives", to: "/student/drives" }]} here={`${drive.company} · ${drive.roleTitle}`} />
        <p className="lead cy-drive-sub">
          <span>{jobLabel(drive.jobType)}</span>
          <DriveStatusChip status={drive.status} />
          {drive.inDrive && <ParticipationChip status={drive.me.status} />}
        </p>
      </header>
      {drive.inDrive ? (
        <FullDrive drive={drive} onChange={setDrive} />
      ) : (
        <EmptyState sprite="blocked" family="azure">
          {drive.company} is hiring for {drive.roleTitle}. Only students invited to this drive can see its details and rounds. Invites go to verified students who match the company's rules,
          by email.
        </EmptyState>
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
      <div className="banner fam-ember">
        <div className="banner-words">
          <p className="banner-title">This drive was cancelled</p>
          {drive.cancelReason && <p className="banner-detail">{drive.cancelReason}</p>}
        </div>
      </div>
    );
  }

  const checkInRound = drive.rounds.find((r) => r.my?.checkInOpen && !r.my.attended);
  const TEXT: Partial<Record<typeof me.status, [string, string, string]>> = {
    INVITED: ["You're invited to this drive", "", "fam-azure"],
    OPTED_IN: ["You've joined this drive", "Follow the rounds below. You'll be told when results or the schedule change.", "fam-lime"],
    OPTED_OUT: ["You skipped this drive", "", "fam-sun"],
    EXPIRED: ["You didn't answer in time", "The joining deadline has passed.", "fam-sun"],
    ELIMINATED: ["You're out of this drive", "You weren't selected in one of the rounds. Your results are below. Keep going: other drives are coming.", "fam-sun"],
    NO_SHOW: ["You were marked absent", "You missed a round after joining, so you're out of this drive. Talk to the placement office if this is a mistake.", "fam-ember"],
    SELECTED: ["You're selected!", "You cleared every round. The company will share the offer letter here.", "fam-lime"],
    OFFERED: ["You have an offer", "Read the letter and answer before the deadline.", "fam-lime"],
    PLACED: ["You're placed!", "You accepted this offer. Congratulations. The placement office has your placement on record.", "fam-lime"],
    OFFER_DECLINED: ["You declined this offer", "You can still take part in other drives you're invited to.", "fam-sun"],
  };
  const [title, base, family] = TEXT[me.status] ?? ["", "", "fam-sun"];
  const detail =
    me.status === "OPTED_IN" && checkInRound
      ? `Check-in is open for ${checkInRound.title}. Scan the QR code on the screen at the venue with your phone camera.`
      : me.status === "OPTED_IN"
        ? `${base}${me.canSkip ? ` You can still leave until ${when(drive.optInDeadline)}.` : ""}`
        : me.canJoin || me.canSkip
          ? `Answer by ${when(drive.optInDeadline)} (${timeLeft(drive.optInDeadline).toLowerCase()}). You can change your mind until then.`
          : base;

  return (
    <div className={`banner ${family} cy-next`}>
      <div className="banner-words">
        <p className="banner-title">{title}</p>
        {detail && <p className="banner-detail">{detail}</p>}
        {form.error && <p className="banner-detail cy-strong">{form.error}</p>}
        {me.canJoin && (
          <label className="cy-check cy-consent">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I agree to share my profile, marks and resume with {drive.company}.
          </label>
        )}
      </div>
      <div className="cy-next-actions">
        {me.canJoin && (
          <button type="button" className="banner-go" disabled={!agree || form.busy} onClick={() => void form.run(async () => onChange(await drivesApi.join(drive.id)))}>
            Join the drive
          </button>
        )}
        {me.canSkip && (
          <button type="button" className="banner-go cy-go-quiet" disabled={form.busy} onClick={() => void form.run(async () => onChange(await drivesApi.skip(drive.id)))}>
            {me.status === "OPTED_IN" ? "Leave the drive" : "Skip"}
          </button>
        )}
      </div>
    </div>
  );
}

function FullDrive({ drive, onChange }: { drive: Full; onChange: (d: StudentDriveView) => void }) {
  return (
    <>
      <Answer drive={drive} onChange={onChange} />
      {drive.offer && <OfferCard drive={drive} onChange={onChange} />}
      <div className="cy-two">
        <section>
          <div className="section-head">
            <h2>Rounds</h2>
          </div>
          <RoundTimeline rounds={drive.rounds} />
          {drive.me.canJoin && drive.rounds.some((r) => r.mode === "ONLINE") && <p className="faint small">Online test links appear here after you join.</p>}
        </section>
        <section className="stack">
          <div className="panel stack">
            <h2 className="cy-h3">The job</h2>
            <dl className="cy-facts">
              <div><dt>Pay</dt><dd>{pay(drive)}</dd></div>
              <div><dt>Location</dt><dd>{drive.location ?? "—"}</dd></div>
              <div><dt>Bond</dt><dd>{drive.bondMonths ? `${drive.bondMonths} months` : "None"}</dd></div>
              <div><dt>Join by</dt><dd>{when(drive.optInDeadline)}</dd></div>
            </dl>
            {drive.description && <p className="small cy-pre">{drive.description}</p>}
          </div>
          <div className="panel stack">
            <h2 className="cy-h3">About {drive.company}</h2>
            {drive.companyAbout && <p className="small">{drive.companyAbout}</p>}
            {drive.companyWebsite && (
              <p className="small">
                <a href={drive.companyWebsite} target="_blank" rel="noreferrer">
                  {drive.companyWebsite.replace(/^https?:\/\//, "")}
                </a>
              </p>
            )}
            <h3 className="cy-h3">Who could apply</h3>
            <ul className="cy-list small">{eligibilityLines(drive.eligibility).map((l) => <li key={l}>{l}</li>)}</ul>
          </div>
        </section>
      </div>
    </>
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
    <section className="panel stack cy-offer" aria-label="Your offer">
      <div className="cy-card-top">
        <p className="cy-h3">Offer: {o.roleTitle}</p>
        <OfferChip status={o.status} forStudent />
      </div>
      <dl className="cy-facts">
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
      <div className="buttons">
        <button type="button" onClick={() => void form.run(() => openLink(() => offersApi.letter(o.id)))}>
          Read the offer letter
        </button>
        {o.status === "SENT" && (
          <>
            <button type="button" className="primary" disabled={form.busy} onClick={() => answer(true)}>
              Accept offer
            </button>
            <button type="button" className="quiet" disabled={form.busy} onClick={() => answer(false)}>
              Decline
            </button>
          </>
        )}
      </div>
      {o.status === "EXPIRED" && <p className="faint small">The deadline passed without an answer. Talk to the placement office if you still want this offer.</p>}
    </section>
  );
}
