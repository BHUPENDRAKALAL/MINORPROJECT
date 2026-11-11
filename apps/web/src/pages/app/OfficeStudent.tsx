import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { DOCUMENT_LABELS, PARTICIPATION_LABELS } from "@cyrus/shared";
import { useAuth } from "../../app/useAuth";
import { Aside, Badge } from "../../components/kit";
import { Alert } from "../../components/ui";
import { ApiError, filesApi, officeStudentsApi, type OfficeStudentDetail } from "../../lib/api";
import { useTitle } from "../../lib/useTitle";
import { PARTICIPATION_TONE, jobLabel, openLink, pay, when } from "./drives/format";
import { STUDENT_STATUS } from "./students";

/** One student, for the TPO and placement staff: profile, verified marks, marksheets and every drive they were in. */
export default function OfficeStudent() {
  const { id } = useParams() as { id: string };
  const { role } = useAuth();
  const [data, setData] = useState<OfficeStudentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useTitle(data ? data.profile.name : "Student");

  useEffect(() => {
    officeStudentsApi.get(id).then(setData, (e) => setError(e instanceof ApiError ? e.message : "Couldn't load this student."));
  }, [id]);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const p = data.profile;
  const st = STUDENT_STATUS[p.status];
  const open = (fileId: string) => void openLink(() => filesApi.link(fileId)).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't open the file."));
  const marks: [string, string | number | null][] = [
    ["CGPA", p.cgpa],
    ["Active backlogs", p.activeBacklogs],
    ["Total backlogs", p.totalBacklogs],
    ["Class 10 %", p.tenthPercent],
    ["Class 12 %", p.twelfthPercent],
    ["Diploma %", p.diplomaPercent],
  ];

  return (
    <>
      <header className="rq-head">
        <div className="rq-head-text">
          <p className="rq-crumb">
            <Link to="/office/students">Students</Link>
            <span aria-hidden="true">/</span>
            <span>{p.rollNo}</span>
          </p>
          <h1 className="rq-title">{p.name}</h1>
          <p className="rq-meta">
            <span>{p.rollNo}</span>
            <span>
              {p.branch} {p.batch}
            </span>
            <Badge tone={st.tone}>{st.label}</Badge>
            {p.placementStatus === "PLACED" && <Badge tone="accent">Placed</Badge>}
          </p>
        </div>
        {p.resumeFileId && (
          <div className="rq-head-tools">
            <button type="button" className="small" onClick={() => open(p.resumeFileId!)}>
              Open resume
            </button>
          </div>
        )}
      </header>

      <div className="ui-split rq-split">
        <div className="rq-main">
          {data.pendingUpdate && (
            <section className="ui-status tone-info" aria-label="Change request">
              <span className="ui-status-dot" aria-hidden="true" />
              <div className="ui-status-text">
                <p className="ui-status-title">Marks change request waiting</p>
                <p className="ui-status-body">Sent {when(data.pendingUpdate.createdAt)}. It's in the review queue.</p>
              </div>
            </section>
          )}

          <section className="rq-card">
            <div className="rq-card-head">
              <h2>Marks</h2>
              <p>{p.status === "VERIFIED" ? `Verified${p.verifiedAt ? ` ${when(p.verifiedAt, false)}` : ""}. These are the marks companies see.` : "Not verified yet: nothing here is final."}</p>
            </div>
            <table className="rq-marks">
              <tbody>
                {marks
                  .filter(([, v]) => v !== null)
                  .map(([label, v]) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      <td>{v}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {marks.every(([, v]) => v === null) && <p className="rq-empty">No verified marks yet.</p>}
          </section>

          <section className="rq-card">
            <div className="rq-card-head">
              <h2>Drives</h2>
              <p>Every drive this student was invited to, and how far they got.</p>
            </div>
            {data.drives.length ? (
              <div className="scroll">
                <table className="cy-table dd-table">
                  <thead>
                    <tr>
                      <th scope="col">Drive</th>
                      <th scope="col">Pay</th>
                      <th scope="col">Invited</th>
                      <th scope="col">Where they are</th>
                      <th scope="col">Offer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.drives.map((d) => (
                      <tr key={d.id}>
                        <td>
                          {role === "TPO" ? (
                            <Link className="dd-name st-link" to={`/office/drives/${d.driveId}`}>
                              {d.roleTitle}
                            </Link>
                          ) : (
                            <span className="dd-name">{d.roleTitle}</span>
                          )}
                          <span className="dd-roll">
                            {d.company} · {jobLabel(d.jobType)}
                          </span>
                        </td>
                        <td className="st-soft">{pay(d)}</td>
                        <td className="st-soft">{when(d.invitedAt, false)}</td>
                        <td>
                          <Badge tone={PARTICIPATION_TONE[d.status]}>{PARTICIPATION_LABELS[d.status]}</Badge>
                        </td>
                        <td className="st-soft">{d.offer ? `${d.offer.status.toLowerCase()}${d.offer.ctcLpa != null ? ` · ₹${d.offer.ctcLpa} LPA` : ""}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rq-empty">Not invited to any drive yet.</p>
            )}
          </section>

          <section className="rq-card">
            <div className="rq-card-head">
              <h2>Marksheets</h2>
              <p>Cleaned copies; they open in a new tab.</p>
            </div>
            {data.documents.length ? (
              <ul className="sp-docs">
                {data.documents.map((d) => (
                  <li key={d.id} className="sp-doc">
                    <span className="rq-doc-icon" aria-hidden="true">
                      <svg viewBox="0 0 16 16" width="16" height="16">
                        <path d="M4 1.5h5.5L12.5 4.5v10h-8.5z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                        <path d="M9.5 1.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="cy-doc-main">
                      <span className="cy-doc-label">
                        {DOCUMENT_LABELS[d.type]}
                        {d.semester ? `, semester ${d.semester}` : ""}
                      </span>
                      <span className="cy-doc-file">{d.file.originalName}</span>
                    </span>
                    <Badge tone={d.status === "ACCEPTED" ? "success" : "neutral"}>{d.status === "ACCEPTED" ? "Accepted" : "Uploaded"}</Badge>
                    {d.file.scanStatus === "CLEAN" ? (
                      <button type="button" className="small" onClick={() => open(d.file.id)}>
                        Open
                      </button>
                    ) : (
                      <Badge tone="warning">{d.file.scanStatus === "INFECTED" ? "Refused" : "Being cleaned"}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rq-empty">No marksheets uploaded.</p>
            )}
          </section>
        </div>

        <div className="rq-side">
          <Aside title="Contact">
            <dl className="sh-facts sd-facts">
              <div>
                <dt>Email</dt>
                <dd className="st-break">{p.email}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{p.phone ?? "Not given"}</dd>
              </div>
              <div>
                <dt>Signed up</dt>
                <dd>{when(p.joinedAt, false)}</dd>
              </div>
            </dl>
          </Aside>
          <Aside title="On record">
            <dl className="sh-facts sd-facts">
              <div>
                <dt>Drives invited</dt>
                <dd>{data.drives.length}</dd>
              </div>
              <div>
                <dt>Joined</dt>
                <dd>{data.drives.filter((d) => !["INVITED", "OPTED_OUT", "EXPIRED", "REMOVED"].includes(d.status)).length}</dd>
              </div>
              <div>
                <dt>No-shows</dt>
                <dd className={p.noShowCount ? "st-warn" : undefined}>{p.noShowCount}</dd>
              </div>
            </dl>
          </Aside>
          {p.skills.length > 0 && (
            <Aside title="Skills">
              <p className="ps-skills">
                {p.skills.map((k) => (
                  <span key={k} className="ui-tag">
                    {k}
                  </span>
                ))}
              </p>
            </Aside>
          )}
        </div>
      </div>
    </>
  );
}
