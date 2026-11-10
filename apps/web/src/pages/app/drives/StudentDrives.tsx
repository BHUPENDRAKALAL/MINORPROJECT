import { useEffect, useState } from "react";
import { Link } from "react-router";
import { PARTICIPATION_LABELS } from "@cyrus/shared";
import { useAuth } from "../../../app/useAuth";
import { Badge, Callout, FilterTabs, PageHeader } from "../../../components/kit";
import { useApiForm } from "../../../components/useApiForm";
import { Alert } from "../../../components/ui";
import { drivesApi, type MyDriveCard, type OtherDrive } from "../../../lib/api";
import { useTitle } from "../../../lib/useTitle";
import { PARTICIPATION_TONE, isActiveForStudent, jobLabel, pay, timeLeft, when } from "./format";

type Tab = "active" | "past";

function Chevron() {
  return (
    <svg className="ui-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** What the student should know next about this drive, in one short line. */
function nextLine(d: MyDriveCard) {
  if (d.status === "CANCELLED") return { text: "Cancelled by the placement office", urgent: false };
  if (d.me.canJoin && d.me.status === "INVITED") return { text: `Answer by ${when(d.optInDeadline)} · ${timeLeft(d.optInDeadline)}`, urgent: true };
  if (d.nextRound) return { text: `Next: ${d.nextRound.title}, ${when(d.nextRound.startsAt)}`, urgent: false };
  return { text: `${d.rounds} round${d.rounds === 1 ? "" : "s"}`, urgent: false };
}

/** A student's drives: the ones they are in, in full; every other running drive by name only. */
export default function StudentDrives() {
  useTitle("Drives");
  const { me } = useAuth();
  const [data, setData] = useState<{ mine: MyDriveCard[]; others: OtherDrive[] } | null>(null);
  const [tab, setTab] = useState<Tab>("active");
  const load = useApiForm();
  const run = load.run;
  useEffect(() => void run(async () => setData(await drivesApi.mine())), [run]);
  const verified = me?.student?.status === "VERIFIED";
  const toAnswer = data?.mine.filter((d) => d.me.canJoin && d.me.status === "INVITED") ?? [];
  // Invites waiting for an answer come first, then the rest in the order the API gives.
  const active = (data?.mine.filter((d) => isActiveForStudent(d.me.status, d.status)) ?? []).sort((a, b) => Number(toAnswer.includes(b)) - Number(toAnswer.includes(a)));
  const past = data?.mine.filter((d) => !active.includes(d)) ?? [];
  const rows = tab === "active" ? active : past;

  return (
    <>
      <PageHeader title="Drives" description="Drives you're invited to, with their rounds and your results. Other drives on campus are listed by name only." />
      {load.error && <Alert>{load.error}</Alert>}
      {!verified && (
        <Callout
          tone="warning"
          title="Get your profile verified to be invited"
          action={
            <Link className="button small" to="/student/profile">
              My profile
            </Link>
          }
        >
          Companies invite only verified students who match their rules.
        </Callout>
      )}
      {toAnswer.length > 0 && (
        <Callout tone="warning" title={`${toAnswer.length} invite${toAnswer.length === 1 ? "" : "s"} waiting for your answer`}>
          Join or skip before the deadline. After it, you can't change your answer.
        </Callout>
      )}

      {data && (
        <>
          <section className="sd-section" aria-labelledby="your-drives">
            <h2 id="your-drives" className="sr-only">
              Your drives
            </h2>
            <FilterTabs
              label="Your drives"
              value={tab}
              onChange={setTab}
              items={[
                { key: "active", label: "Active", count: active.length },
                { key: "past", label: "Past", count: past.length },
              ]}
            />
            {rows.length ? (
              <ul className="ui-rows sd-rows">
                {rows.map((d) => {
                  const next = nextLine(d);
                  return (
                    <li key={d.id}>
                      <Link className="ui-row sd-row" to={`/student/drives/${d.id}`}>
                        <span className="sd-logo" aria-hidden="true">
                          {d.company.slice(0, 1)}
                        </span>
                        <span className="ui-row-main">
                          <span className="ui-row-title">{d.roleTitle}</span>
                          <span className="ui-row-sub">
                            <span>{d.company}</span>
                            <span>{jobLabel(d.jobType)}</span>
                            <span>{pay(d)}</span>
                            {d.location && <span>{d.location}</span>}
                          </span>
                        </span>
                        <span className={`sd-next${next.urgent ? " is-urgent" : ""}`}>{next.text}</span>
                        <Badge tone={PARTICIPATION_TONE[d.me.status]}>{PARTICIPATION_LABELS[d.me.status]}</Badge>
                        <Chevron />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="rq-empty-state">
                <p className="rq-empty-title">{tab === "active" ? "No active drives" : "Nothing here yet"}</p>
                <p>
                  {tab === "active"
                    ? "When a company invites students who match its rules, you'll get an email and the drive shows up here."
                    : "Drives you finished, skipped or were out of show up here."}
                </p>
              </div>
            )}
          </section>

          <section className="sd-section" aria-labelledby="other-drives">
            <div className="sd-section-head">
              <h2 id="other-drives">Other drives on campus</h2>
              <p>Only invited students can see a drive's details and rounds.</p>
            </div>
            {!data.others.length ? (
              <p className="sh-empty">No other drives are running right now.</p>
            ) : (
              <ul className="ui-rows">
                {data.others.map((d) => (
                  <li key={d.id}>
                    <Link to={`/student/drives/${d.id}`} className="ui-row sd-row sd-other cy-other">
                      <span className="sd-logo is-muted" aria-hidden="true">
                        {d.company.slice(0, 1)}
                      </span>
                      <span className="ui-row-main">
                        <span className="ui-row-title">{d.roleTitle}</span>
                        <span className="ui-row-sub">
                          <span>{d.company}</span>
                          <span>{jobLabel(d.jobType)}</span>
                        </span>
                      </span>
                      <span className="sd-lock">
                        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                          <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
                          <path d="M5.5 7V5a2.5 2.5 0 015 0v2" fill="none" stroke="currentColor" strokeWidth="1.3" />
                        </svg>
                        Invite only
                      </span>
                      <Chevron />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
