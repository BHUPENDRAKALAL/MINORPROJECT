import { useEffect, useState } from "react";
import { Link } from "react-router";
import { PARTICIPATION_LABELS } from "@cyrus/shared";
import { useAuth } from "../../app/useAuth";
import { Aside, Badge, PageHeader, type Tone } from "../../components/kit";
import { Avatar } from "../../components/ui";
import { drivesApi, type MyDriveCard, type PlacementNews, type StudentStatus } from "../../lib/api";
import { useTitle } from "../../lib/useTitle";
import { PARTICIPATION_TONE, isActiveForStudent, pay, timeLeft, when } from "./drives/format";

const STATUS: Record<StudentStatus, { label: string; tone: Tone }> = {
  PROFILE_INCOMPLETE: { label: "Profile incomplete", tone: "warning" },
  PENDING_VERIFICATION: { label: "Waiting for verification", tone: "info" },
  VERIFIED: { label: "Verified", tone: "success" },
  REJECTED: { label: "Needs changes", tone: "danger" },
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

type StepState = "done" | "now" | "later";

/** The three steps from sign-up to drives, with the one action that moves the student forward. */
function Setup({ status }: { status: StudentStatus }) {
  const profile: StepState = status === "PROFILE_INCOMPLETE" || status === "REJECTED" ? "now" : "done";
  const check: StepState = status === "VERIFIED" ? "done" : status === "PENDING_VERIFICATION" ? "now" : "later";
  const drives: StepState = status === "VERIFIED" ? "now" : "later";
  const steps: { state: StepState; title: string; body: string; action?: { to: string; label: string } }[] = [
    {
      state: profile,
      title: status === "REJECTED" ? "Fix your profile" : "Complete your profile",
      body: status === "REJECTED" ? "The placement office asked for changes. Open your profile to see what to fix." : "Your marks, marksheets and resume, exactly as on your documents.",
      action: profile === "now" ? { to: "/student/profile", label: status === "REJECTED" ? "See what to fix" : "Complete your profile" } : undefined,
    },
    {
      state: check,
      title: "Placement office checks it",
      body: check === "now" ? "Usually within a day or two. You'll get an email when it's done." : "Every number is matched against your marksheets once.",
    },
    {
      state: drives,
      title: "Join drives",
      body: "Companies invite verified students who match their rules. You answer each invite here.",
      action: drives === "now" ? { to: "/student/drives", label: "See your drives" } : undefined,
    },
  ];
  const done = steps.filter((s) => s.state === "done").length;
  return (
    <section className="sh-card" aria-labelledby="setup-title">
      <div className="sh-card-head">
        <h2 id="setup-title">Getting placement-ready</h2>
        <span className="sh-count">
          {done} of {steps.length} done
        </span>
      </div>
      <div className="sh-progress" aria-hidden="true">
        <span style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="sh-steps">
        {steps.map((s, i) => (
          <li key={s.title} className={`is-${s.state}`}>
            <span className="sh-step-mark" aria-hidden="true">
              {s.state === "done" ? (
                <svg viewBox="0 0 16 16" width="12" height="12">
                  <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <div className="sh-step-text">
              <p className="sh-step-title">
                {s.title}
                {s.state === "done" && <span className="sr-only"> (done)</span>}
              </p>
              <p className="sh-step-body">{s.body}</p>
            </div>
            {s.action && (
              <Link className="button primary small" to={s.action.to}>
                {s.action.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** What needs the student now: invites to answer, then rounds coming up. */
function Upcoming({ drives }: { drives: MyDriveCard[] }) {
  const active = drives.filter((d) => isActiveForStudent(d.me.status, d.status));
  const toAnswer = active.filter((d) => d.me.canJoin && d.me.status === "INVITED");
  const rest = active.filter((d) => !toAnswer.includes(d));
  if (!active.length) {
    return (
      <section className="sh-card">
        <div className="sh-card-head">
          <h2>Your drives</h2>
        </div>
        <p className="sh-empty">No drives yet. When a company invites students who match its rules, you'll get an email and the drive shows up here.</p>
      </section>
    );
  }
  return (
    <section className="sh-card">
      <div className="sh-card-head">
        <h2>Your drives</h2>
        <Link className="sh-head-link" to="/student/drives">
          All drives
        </Link>
      </div>
      <ul className="sh-list">
        {[...toAnswer, ...rest].map((d) => (
          <li key={d.id}>
            <Link to={`/student/drives/${d.id}`} className="sh-item">
              <span className="sh-item-main">
                <span className="sh-item-title">
                  {d.roleTitle} <span className="sh-item-co">at {d.company}</span>
                </span>
                <span className="sh-item-sub">
                  {toAnswer.includes(d) ? (
                    <span className="sh-due">Answer by {when(d.optInDeadline)} · {timeLeft(d.optInDeadline)}</span>
                  ) : d.nextRound ? (
                    <span>
                      Next: {d.nextRound.title}, {when(d.nextRound.startsAt)}
                    </span>
                  ) : (
                    <span>{pay(d)}</span>
                  )}
                </span>
              </span>
              <Badge tone={PARTICIPATION_TONE[d.me.status]}>{toAnswer.includes(d) ? "Needs your answer" : PARTICIPATION_LABELS[d.me.status]}</Badge>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Placement news: drives where the placement office announced who was selected. */
function News({ items }: { items: PlacementNews[] }) {
  if (!items.length) return null;
  return (
    <section className="sh-card" aria-labelledby="news-title">
      <div className="sh-card-head">
        <h2 id="news-title">Placement news</h2>
      </div>
      <ul className="sh-news">
        {items.map((n) => {
          const shown = n.names.slice(0, 4);
          const more = n.count - shown.length;
          return (
            <li key={n.id} className="sh-news-item">
              <p className="sh-news-title">
                <span className="sh-news-count">{n.count}</span> selected at {n.company} <span className="sh-item-co">· {n.roleTitle}</span>
              </p>
              <p className="sh-news-names">
                {shown.map((x) => `${x.name} (${x.branch})`).join(", ")}
                {more > 0 && `${shown.length ? " and " : ""}${more} more`}
              </p>
              <p className="sh-news-when">
                {pay(n)} · announced {when(n.announcedAt)}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function StudentHome() {
  const { me } = useAuth();
  useTitle("Home");
  const [drives, setDrives] = useState<MyDriveCard[] | null>(null);
  const [news, setNews] = useState<PlacementNews[]>([]);
  const verified = me?.student?.status === "VERIFIED";
  useEffect(() => {
    drivesApi.announcements().then((r) => setNews(r.announcements), () => setNews([]));
  }, []);
  useEffect(() => {
    if (verified) drivesApi.mine().then((d) => setDrives(d.mine), () => setDrives([]));
  }, [verified]);
  if (!me) return null;
  const first = (me.name ?? "").split(" ")[0] || "there";
  const s = me.student;

  if (!s) {
    return (
      <>
        <PageHeader title={`${greeting()}, ${first}`} description="Your account has no student record yet. If you think this is wrong, contact the placement office." />
      </>
    );
  }

  const st = STATUS[s.status] ?? STATUS.PROFILE_INCOMPLETE;
  const placed = s.placementStatus === "PLACED";

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${first}`}
        description={
          placed
            ? "You're placed. Congratulations. Your offer is on record with the placement office."
            : verified
              ? "Your profile is verified. Here's what is happening in your drives."
              : "A few steps and you're ready for placement drives."
        }
      />
      <div className="ui-split">
        <div className="sh-main">
          {!verified && <Setup status={s.status} />}
          {verified && (drives ? <Upcoming drives={drives} /> : <div className="sh-card sh-loading" aria-busy="true" />)}
          <News items={news} />
        </div>
        <div className="rq-side">
          <section className="sh-profile" aria-label="Your profile">
            <div className="sh-profile-top">
              <Avatar name={me.name ?? me.email} />
              <div className="sh-profile-who">
                <p className="sh-profile-name">{me.name ?? me.email}</p>
                <p className="sh-profile-roll">{s.rollNo}</p>
              </div>
            </div>
            <dl className="sh-facts">
              <div>
                <dt>Branch</dt>
                <dd>{s.branch}</dd>
              </div>
              <div>
                <dt>Batch</dt>
                <dd>{s.batch}</dd>
              </div>
              <div>
                <dt>Profile</dt>
                <dd>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </dd>
              </div>
              <div>
                <dt>Placement</dt>
                <dd>{placed ? <Badge tone="accent">Placed</Badge> : "Not yet"}</dd>
              </div>
            </dl>
            <Link className="button sh-profile-go" to="/student/profile">
              Open my profile
            </Link>
          </section>
          <Aside title="Good to know">
            <ul className="rq-rules">
              <li>Only verified students get invites.</li>
              <li>Answer each invite before its deadline; after it, you can't change your answer.</li>
              <li>Once you accept an offer, the college's one-offer rule applies.</li>
            </ul>
          </Aside>
        </div>
      </div>
    </>
  );
}
