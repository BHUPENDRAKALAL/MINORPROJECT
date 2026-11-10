import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "../../app/useAuth";
import { PageHeader } from "../../components/kit";
import { Alert } from "../../components/ui";
import { ApiError, overviewApi, workApi, type OfficeOverview, type ReviewQueueOverview } from "../../lib/api";
import { since } from "../../lib/time";
import { useTitle } from "../../lib/useTitle";
import { when } from "./drives/format";

/**
 * Foundry's colour rule, one job per family:
 *   lime = done · azure = in progress · orchid = waiting on someone else · sun = needs input · ember = stuck · none = idle
 */
type Fam = "lime" | "azure" | "orchid" | "sun" | "ember" | "none";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Go() {
  return (
    <svg className="ov-go" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M3.5 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A soft chip beside a cell's title: green when things moved, sun when someone should look, ember when stuck. */
function Delta({ fam, children }: { fam: Fam; children: ReactNode }) {
  return <span className={`ov-delta fam-${fam}`}>{children}</span>;
}

/** One cell of the panel: a title (and a chip), one big number, one line, then whatever chart fits. */
function Cell({ span, title, chip, figure, note, to, children }: { span: 3 | 4 | 6 | 8 | 12; title: string; chip?: ReactNode; figure?: ReactNode; note?: ReactNode; to?: string; children?: ReactNode }) {
  return (
    <section className={`ov-cell span-${span}`} aria-label={title}>
      <div className="ov-cell-head">
        {to ? (
          <Link to={to} className="ov-cell-title is-link">
            {title}
            <Go />
          </Link>
        ) : (
          <h2 className="ov-cell-title">{title}</h2>
        )}
        {chip}
      </div>
      {figure !== undefined && <p className="ov-cell-figure">{figure}</p>}
      {note && <p className="ov-cell-note">{note}</p>}
      {children}
    </section>
  );
}

/** A thin bar that fills to a share (Foundry's meter). */
function Meter({ value, of, fam }: { value: number; of: number; fam: Fam }) {
  const pct = of > 0 ? Math.min(100, (value / of) * 100) : 0;
  return (
    <div className={`ov-meter fam-${fam}`} role="img" aria-label={`${Math.round(pct)}%`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

type Part = { key: string; label: string; value: number; fam: Fam; to?: string };

/** One flat bar cut into stages, and how many sit at each under it (Foundry's stage bar and stage list). */
function Stages({ parts, label }: { parts: Part[]; label: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <>
      <div className="ov-stagebar" role="img" aria-label={`${label}: ${parts.map((p) => `${p.value} ${p.label.toLowerCase()}`).join(", ")}`}>
        {total === 0 ? <span className="ov-seg-track" /> : parts.filter((p) => p.value > 0).map((p) => <span key={p.key} className={`ov-seg fam-${p.fam}`} style={{ flexGrow: p.value }} title={`${p.label}: ${p.value}`} />)}
      </div>
      <ul className="ov-stages">
        {parts.map((p) => {
          const body = (
            <>
              <span className="ov-stage-name">
                <span className={`ov-diamond fam-${p.fam}`} aria-hidden="true" />
                {p.label}
              </span>
              <span className={`ov-stage-count${p.value ? "" : " is-empty"}`}>{p.value}</span>
            </>
          );
          return <li key={p.key}>{p.to ? <Link className="ov-stage" to={p.to}>{body}</Link> : <span className="ov-stage">{body}</span>}</li>;
        })}
      </ul>
    </>
  );
}

/** A ring for "how much of this is settled" (Foundry's donut), with the share in the middle. */
function Donut({ parts, middle, under }: { parts: Part[]; middle: string; under: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const r = 46;
  const c = 2 * Math.PI * r;
  let at = 0;
  return (
    <div className="ov-donut-wrap">
      <svg className="ov-donut" viewBox="0 0 120 120" role="img" aria-label={parts.map((p) => `${p.value} ${p.label.toLowerCase()}`).join(", ")}>
        <circle className="ov-donut-track" cx="60" cy="60" r={r} />
        {total > 0 &&
          parts
            .filter((p) => p.value > 0)
            .map((p) => {
              const len = (p.value / total) * c;
              const el = <circle key={p.key} className={`ov-donut-part fam-${p.fam}`} cx="60" cy="60" r={r} strokeDasharray={`${Math.max(0, len - 2)} ${c}`} strokeDashoffset={-at} />;
              at += len;
              return el;
            })}
        <text className="ov-donut-middle" x="60" y="60">
          {middle}
        </text>
        <text className="ov-donut-under" x="60" y="78">
          {under}
        </text>
      </svg>
      <ul className="ov-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <span className={`ov-diamond fam-${p.fam}`} aria-hidden="true" />
            <span>{p.label}</span>
            <b>{p.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A name, a number and a thin bar per row (Foundry's thin bars). */
function ThinBars({ rows }: { rows: { key: string; label: string; value: number; fam: Fam }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="ov-thin">
      {rows.map((r) => (
        <li key={r.key}>
          <span>{r.label}</span>
          <b>{r.value}</b>
          <Meter value={r.value} of={max} fam={r.fam} />
        </li>
      ))}
    </ul>
  );
}

type Need = { key: string; fam: Fam; tag: string; title: string; why: string; to: string };

/** The placement office's home: what needs someone, then today's numbers in one panel cut into cells. */
export default function OfficeOverview() {
  useTitle("Overview");
  const { me, role } = useAuth();
  const tpo = role === "TPO";
  const volunteer = role === "VOLUNTEER";
  const [data, setData] = useState<OfficeOverview | null>(null);
  const [queue, setQueue] = useState<ReviewQueueOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : "Couldn't load the overview.");
    if (volunteer) workApi.queue().then(setQueue, fail);
    else overviewApi.get().then(setData, fail);
  }, [volunteer]);

  const first = (me?.name ?? "").split(" ")[0] || "there";
  const head = (
    <PageHeader
      title={`${greeting()}, ${first}`}
      description={volunteer ? "Your review work today." : "Where placements stand today, and what needs someone."}
      actions={
        tpo ? (
          <>
            <Link className="button" to="/office/review">
              Review queue
            </Link>
            <Link className="button primary" to="/office/drives/new">
              New drive
            </Link>
          </>
        ) : (
          <Link className="button primary" to="/office/review">
            Open the review queue
          </Link>
        )
      }
    />
  );

  if (error)
    return (
      <>
        {head}
        <Alert>{error}</Alert>
      </>
    );

  // Volunteers see only their own review numbers, never the whole college's.
  if (volunteer) {
    if (!queue) return head;
    const st = queue.stats;
    return (
      <>
        {head}
        <div className="ov-panel">
          <Cell span={3} title="Waiting for you" to="/office/review" figure={st.waiting} chip={st.waiting ? <Delta fam={st.oldestWaitingMinutes > 48 * 60 ? "ember" : "sun"}>{since(st.oldestWaitingMinutes)} oldest</Delta> : <Delta fam="lime">All clear</Delta>} note="Tasks you may take now" />
          <Cell span={3} title="Done today" figure={st.doneToday} note="Decisions you made since midnight" />
          <Cell span={3} title="This week" figure={st.doneWeek} note="Over the last 7 days" />
          <Cell span={3} title="Being checked" figure={st.inProgress} note="Taken by other reviewers right now" />
        </div>
      </>
    );
  }

  if (!data) return head;
  const d = data.drives;
  const s = data.students;
  const open = (d.PUBLISHED ?? 0) + (d.ONGOING ?? 0);
  const drivesTo = tpo ? "/office/drives" : undefined;
  const offersTotal = Object.values(data.offers).reduce((a, b) => a + b, 0);
  const accepted = data.offers.ACCEPTED ?? 0;

  const needs: Need[] = [
    ...data.pendingDrives.map((p) => ({
      key: `d-${p.id}`,
      fam: "sun" as Fam,
      tag: "Drive",
      title: `Approve ${p.roleTitle}`,
      why: `${p.company} sent it ${since(Math.round((Date.now() - new Date(p.waitingSince).getTime()) / 60_000))} ago`,
      to: `/office/drives/${p.id}`,
    })),
    ...(data.review.escalated && tpo
      ? [{ key: "esc", fam: "sun" as Fam, tag: "Review", title: `${data.review.escalated} profile${data.review.escalated === 1 ? "" : "s"} sent to you`, why: "Reviewers weren't sure; you decide", to: "/office/review" }]
      : []),
    ...(data.feedbackToCheck && tpo
      ? [{ key: "fb", fam: "sun" as Fam, tag: "Interviews", title: `${data.feedbackToCheck} panel remark${data.feedbackToCheck === 1 ? "" : "s"} to check`, why: "Students see them only after you send them", to: "/office/drives" }]
      : []),
    ...(data.review.waiting
      ? [{ key: "q", fam: (data.review.oldestWaitingMinutes > 48 * 60 ? "ember" : "azure") as Fam, tag: "Review", title: `${data.review.waiting} task${data.review.waiting === 1 ? "" : "s"} in the queue`, why: `Oldest waiting ${since(data.review.oldestWaitingMinutes)}`, to: "/office/review" }]
      : []),
  ].filter((n) => tpo || n.tag === "Review");

  return (
    <>
      {head}

      {needs.length > 0 && (
        <section className="ov-needs-wrap" aria-labelledby="needs-title">
          <h2 id="needs-title" className="ov-section-title">
            Needs you <span className="ui-tab-count">{needs.length}</span>
          </h2>
          <ul className="ov-needs">
            {needs.map((n) => (
              <li key={n.key}>
                <Link className="ov-need" to={n.to}>
                  <span className="ov-need-tag">
                    <span className={`ov-diamond fam-${n.fam}`} aria-hidden="true" />
                    {n.tag}
                  </span>
                  <span className="ov-need-title">{n.title}</span>
                  <span className="ov-need-why">{n.why}</span>
                  <Go />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="ov-panel">
        <Cell
          span={3}
          title="Review queue"
          to="/office/review"
          figure={data.review.waiting}
          chip={data.review.waiting ? <Delta fam={data.review.oldestWaitingMinutes > 48 * 60 ? "ember" : "sun"}>{since(data.review.oldestWaitingMinutes)} oldest</Delta> : <Delta fam="lime">All clear</Delta>}
          note="Profiles and marks waiting for a check"
        />
        <Cell span={3} title="Drives open" to={drivesTo} figure={open} chip={d.PENDING_APPROVAL ? <Delta fam="sun">{d.PENDING_APPROVAL} to approve</Delta> : undefined} note={`${data.companies} compan${data.companies === 1 ? "y" : "ies"} on Cyrus`} />
        <Cell span={3} title="Verified" figure={s.verified} note={`of ${s.total} students signed up`}>
          <Meter value={s.verified} of={s.total} fam="lime" />
        </Cell>
        <Cell span={3} title="Placed" figure={s.placed} chip={s.placed ? <Delta fam="lime">{s.verified ? Math.round((s.placed / s.verified) * 100) : 0}% of verified</Delta> : undefined} note={s.placed ? "Accepted an offer this season" : "No one yet this season"}>
          <Meter value={s.placed} of={Math.max(1, s.verified)} fam="lime" />
        </Cell>

        <Cell span={6} title="Students" figure={s.total} note="Where every signed-up student's profile is">
          <Stages
            label="Students"
            parts={[
              { key: "v", label: "Verified", value: s.verified, fam: "lime" },
              { key: "p", label: "Being checked", value: s.pending, fam: "azure", to: "/office/review" },
              { key: "r", label: "Asked to fix", value: s.rejected, fam: "sun" },
              { key: "i", label: "Not sent yet", value: s.incomplete, fam: "none" },
            ]}
          />
        </Cell>
        <Cell span={6} title="Drives" to={drivesTo} figure={Object.values(d).reduce((a, b) => a + b, 0)} note="Every drive this season, by stage">
          <Stages
            label="Drives"
            parts={[
              { key: "a", label: "Waiting for approval", value: d.PENDING_APPROVAL ?? 0, fam: "sun", to: drivesTo },
              { key: "o", label: "Open and running", value: open, fam: "azure", to: drivesTo },
              { key: "r", label: "Results out, offers going", value: d.RESULTS_DECLARED ?? 0, fam: "orchid", to: drivesTo },
              { key: "c", label: "Closed", value: d.CLOSED ?? 0, fam: "lime", to: drivesTo },
            ]}
          />
        </Cell>

        <Cell span={4} title="Offers" note="Letters sent by companies, and the answers">
          <Donut
            middle={offersTotal ? `${Math.round((accepted / offersTotal) * 100)}%` : "—"}
            under={offersTotal ? "accepted" : "no offers yet"}
            parts={[
              { key: "a", label: "Accepted", value: accepted, fam: "lime" },
              { key: "s", label: "Waiting for the student", value: data.offers.SENT ?? 0, fam: "orchid" },
              { key: "d", label: "Declined", value: data.offers.DECLINED ?? 0, fam: "none" },
              { key: "e", label: "Expired or withdrawn", value: (data.offers.EXPIRED ?? 0) + (data.offers.REVOKED ?? 0), fam: "ember" },
            ]}
          />
        </Cell>
        <Cell span={4} title="In the queue" to="/office/review" note="Open review tasks by kind">
          <ThinBars
            rows={[
              { key: "v", label: "Profile checks", value: data.review.byType.STUDENT_VERIFICATION ?? 0, fam: "azure" },
              { key: "s", label: "Second checks", value: data.review.byType.SECOND_CHECK ?? 0, fam: "azure" },
              { key: "a", label: "Marks changes", value: data.review.byType.ACADEMIC_UPDATE ?? 0, fam: "azure" },
              { key: "e", label: "Sent to the TPO", value: data.review.escalated, fam: "sun" },
            ]}
          />
        </Cell>
        <Cell span={4} title="Coming up" note={data.upcomingRounds.length ? "The next rounds on the calendar" : undefined}>
          {data.upcomingRounds.length ? (
            <ul className="ov-upcoming">
              {data.upcomingRounds.map((r) => (
                <li key={r.id}>
                  <span className="ov-up-when">{when(r.startsAt)}</span>
                  {tpo ? (
                    <Link to={`/office/drives/${r.driveId}/rounds/${r.id}`} className="ov-up-title">
                      {r.title}
                    </Link>
                  ) : (
                    <span className="ov-up-title">{r.title}</span>
                  )}
                  <span className="ov-up-sub">
                    {r.company} · {r.roleTitle}
                    {r.where ? ` · ${r.where}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ov-no-data">No rounds scheduled</p>
          )}
        </Cell>

        <div className="ov-strip">
          <span>
            Companies <b>{data.companies}</b>
          </span>
          <span>
            Remarks to check <b>{data.feedbackToCheck}</b>
          </span>
          <span>
            With the TPO <b>{data.review.escalated}</b>
          </span>
          {tpo && (
            <Link className="ov-strip-link" to="/office/drives">
              All drives <Go />
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
