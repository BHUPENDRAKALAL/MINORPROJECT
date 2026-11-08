import { DRIVE_STATUS_LABELS, PARTICIPATION_LABELS, ROUND_KINDS, type DriveStatus, type ParticipationStatus } from "@cyrus/shared";
import { Link } from "react-router";
import type { Round } from "../../../lib/api";
import { when } from "./format";

const STATUS_TONE: Record<DriveStatus, { tone: string; family: string }> = {
  DRAFT: { tone: "idle", family: "" },
  PENDING_APPROVAL: { tone: "waiting", family: "fam-sun" },
  PUBLISHED: { tone: "done", family: "fam-lime" },
  ONGOING: { tone: "working", family: "fam-azure" },
  RESULTS_DECLARED: { tone: "done", family: "fam-orchid" },
  CLOSED: { tone: "idle", family: "" },
  REJECTED: { tone: "stuck", family: "fam-ember" },
  CANCELLED: { tone: "stuck", family: "fam-ember" },
};

export function DriveStatusChip({ status }: { status: DriveStatus }) {
  const t = STATUS_TONE[status];
  return <span className={`stage ${t.tone} ${t.family}`}>{DRIVE_STATUS_LABELS[status]}</span>;
}

const PART_TONE: Record<ParticipationStatus, string> = {
  INVITED: "waiting fam-sun",
  OPTED_IN: "done fam-lime",
  OPTED_OUT: "idle",
  EXPIRED: "idle",
  ELIMINATED: "stuck fam-ember",
  NO_SHOW: "stuck fam-ember",
  SELECTED: "done fam-lime",
  OFFERED: "done fam-orchid",
  PLACED: "done fam-orchid",
  OFFER_DECLINED: "idle",
  REMOVED: "idle",
};

export function ParticipationChip({ status }: { status: ParticipationStatus }) {
  return <span className={`stage ${PART_TONE[status]}`}>{PARTICIPATION_LABELS[status]}</span>;
}

const ROUND_STATUS: Record<NonNullable<Round["status"]>, [string, string]> = {
  SCHEDULED: ["Upcoming", "waiting"],
  IN_PROGRESS: ["Happening now", "working fam-azure"],
  RESULTS_PENDING: ["Results awaited", "working fam-sun"],
  RESULTS_PUBLISHED: ["Results out", "done fam-lime"],
  CANCELLED: ["Cancelled", "stuck fam-ember"],
};

/** True when the round's name already says its kind ("Technical round 2"), so the kind tag would repeat it. */
const namesKind = (r: Round) => {
  const kind = ROUND_KINDS[r.type].title.toLowerCase();
  return kind !== "" && r.title.toLowerCase().startsWith(kind);
};

/** The drive's rounds in order, as a numbered timeline. Used by HR, the TPO and students. */
export function RoundTimeline({ rounds, showLinks = true, linkTo }: { rounds: Round[]; showLinks?: boolean; linkTo?: (roundId: string) => string }) {
  if (!rounds.length) return <p className="faint">No rounds added yet.</p>;
  return (
    <ol className="cy-rounds">
      {rounds.map((r, i) => {
        const [label, tone] = ROUND_STATUS[r.status ?? "SCHEDULED"];
        return (
          <li key={r.id ?? i} className={`cy-round-item is-${(r.status ?? "SCHEDULED").toLowerCase()}`}>
            <span className="cy-round-no" aria-hidden="true">
              {i + 1}
            </span>
            <div className="cy-round-body">
              <div className="cy-round-top">
                {linkTo && r.id ? (
                  <Link to={linkTo(r.id)} className="cy-round-link">
                    <strong>{r.title}</strong>
                  </Link>
                ) : (
                  <strong>{r.title}</strong>
                )}
                {/* The kind, unless the name already says it ("Technical round 2") */}
                {!namesKind(r) && <span className="pill">{ROUND_KINDS[r.type].label}</span>}
                <span className={`stage ${tone}`}>{label}</span>
              </div>
              <p className="small cy-round-meta">
                <span>{when(r.startsAt)}</span>
                <span>{r.mode === "ONLINE" ? "Online" : r.venue || "Venue to be announced"}</span>
              </p>
              {r.mode === "ONLINE" && showLinks && r.onlineLink && (
                <p className="small">
                  <a href={r.onlineLink} target="_blank" rel="noreferrer">
                    Open the test / meeting link
                  </a>
                </p>
              )}
              {r.instructions && <p className="small cy-round-note">{r.instructions}</p>}
              {r.my && <MyRound my={r.my} />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A student's own part in a round: checked in, result, or a nudge to check in now. */
function MyRound({ my }: { my: NonNullable<Round["my"]> }) {
  const bits = [];
  if (my.out === "ABSENT") bits.push(<span key="o" className="stage stuck fam-ember">You were absent</span>);
  else if (my.result === "SELECTED") bits.push(<span key="r" className="stage done fam-lime">You cleared this round</span>);
  else if (my.result === "REJECTED") bits.push(<span key="r" className="stage stuck fam-ember">Not selected</span>);
  if (my.attended && my.out !== "ABSENT") bits.push(<span key="a" className="stage done">Checked in</span>);
  if (my.checkInOpen && !my.attended) bits.push(<span key="c" className="stage working fam-azure">Check-in is open: scan the QR code at the venue</span>);
  const l = my.line;
  if (l?.status === "CALLED") bits.push(<span key="l" className="stage working fam-lime cy-your-turn">Your turn: go to {l.location ?? l.panel} now</span>);
  else if (l?.status === "IN_INTERVIEW") bits.push(<span key="l" className="stage working fam-azure">In your interview ({l.panel})</span>);
  else if (l?.status === "WAITING")
    bits.push(
      <span key="l" className="stage waiting fam-sun">
        You're number {l.position} in line for {l.panel}
        {l.location ? ` (${l.location})` : ""}, about {l.waitMinutes} min
      </span>,
    );
  else if (l?.status === "ABSENT") bits.push(<span key="l" className="stage stuck fam-ember">You missed your turn at {l.panel}: talk to the coordinator</span>);
  else if (l?.status === "DONE") bits.push(<span key="l" className="stage done">Interview done</span>);
  if (!bits.length && !my.feedback.length) return null;
  return (
    <>
      {bits.length > 0 && <p className="cy-my-round">{bits}</p>}
      {my.feedback.map((f, i) => (
        <blockquote key={i} className="cy-remark">
          <span className="faint small">From the panel:</span> {f}
        </blockquote>
      ))}
    </>
  );
}
