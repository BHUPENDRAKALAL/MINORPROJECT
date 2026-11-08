import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../../../app/useAuth";
import { useApiForm } from "../../../components/useApiForm";
import { Alert, EmptyState, Icon, Tile } from "../../../components/ui";
import { drivesApi, type MyDriveCard, type OtherDrive } from "../../../lib/api";
import { useTitle } from "../../../lib/useTitle";
import { DriveStatusChip, ParticipationChip } from "./shared";
import { jobLabel, pay, timeLeft, when } from "./format";

/** A student's drives: the ones they are in, in full; every other running drive by name only. */
export default function StudentDrives() {
  useTitle("Drives");
  const { me } = useAuth();
  const [data, setData] = useState<{ mine: MyDriveCard[]; others: OtherDrive[] } | null>(null);
  const load = useApiForm();
  const run = load.run;
  useEffect(() => void run(async () => setData(await drivesApi.mine())), [run]);
  const verified = me?.student?.status === "VERIFIED";
  const toAnswer = data?.mine.filter((d) => d.me.canJoin && d.me.status === "INVITED") ?? [];

  return (
    <>
      <header className="page-head">
        <div className="section-head">
          <Tile icon="jobs" family="azure" />
          <h1 className="title">Drives</h1>
        </div>
        <p className="lead">Drives you are invited to, with their rounds. Other drives on campus are listed by name only.</p>
      </header>
      {load.error && <Alert>{load.error}</Alert>}
      {!verified && (
        <div className="banner fam-sun">
          <div className="banner-words">
            <p className="banner-title">Get your profile verified to be invited</p>
            <p className="banner-detail">Companies invite only verified students who match their rules.</p>
          </div>
          <Link className="banner-go" to="/student/profile">
            My profile
          </Link>
        </div>
      )}
      {toAnswer.length > 0 && (
        <div className="banner fam-lime">
          <div className="banner-words">
            <p className="banner-title">
              {toAnswer.length} invite{toAnswer.length === 1 ? "" : "s"} waiting for your answer
            </p>
            <p className="banner-detail">Join or skip before the deadline. After it, you can't change your answer.</p>
          </div>
        </div>
      )}

      {data && (
        <>
          <section className="cy-section">
            <div className="section-head">
              <h2>Your drives</h2>
            </div>
            {!data.mine.length ? (
              <EmptyState sprite="designer" family="azure">
                You haven't been invited to a drive yet. When a company picks students who match its rules, you'll get an email and the drive shows up here.
              </EmptyState>
            ) : (
              <ul className="cy-cards">
                {data.mine.map((d) => (
                  <li key={d.id}>
                    <Link className="panel cy-card" to={`/student/drives/${d.id}`}>
                      <span className="cy-card-top">
                        <span className="faint small">{d.company}</span>
                        <ParticipationChip status={d.me.status} />
                      </span>
                      <strong className="cy-card-title">{d.roleTitle}</strong>
                      <span className="small">
                        {jobLabel(d.jobType)} · {pay(d)}
                        {d.location ? ` · ${d.location}` : ""}
                      </span>
                      <span className="cy-card-figures small">
                        {d.status === "CANCELLED" ? (
                          <DriveStatusChip status="CANCELLED" />
                        ) : d.me.canJoin || (d.me.canSkip && d.me.status === "INVITED") ? (
                          <span className="cy-strong">Join by {when(d.optInDeadline)} · {timeLeft(d.optInDeadline)}</span>
                        ) : d.nextRound ? (
                          <span>
                            Next: {d.nextRound.title}, {when(d.nextRound.startsAt)}
                          </span>
                        ) : (
                          <span>{d.rounds} round{d.rounds === 1 ? "" : "s"}</span>
                        )}
                      </span>
                      <span className="cy-card-go" aria-hidden="true">
                        <Icon name="go" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="cy-section">
            <div className="section-head">
              <h2>Other drives on campus</h2>
            </div>
            {!data.others.length ? (
              <p className="faint">No other drives are running right now.</p>
            ) : (
              <>
                <p className="faint small">Only invited students can see a drive's details and rounds.</p>
                <ul className="rows cy-others">
                  {data.others.map((d) => (
                    <li key={d.id}>
                      <Link to={`/student/drives/${d.id}`} className="cy-other">
                        <span className="pill">Invite only</span>
                        <span className="cy-other-name">
                          <strong>{d.company}</strong> · {d.roleTitle}
                        </span>
                        <span className="faint small">{jobLabel(d.jobType)}</span>
                        <DriveStatusChip status={d.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
