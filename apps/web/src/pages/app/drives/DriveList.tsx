import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { DriveStatus } from "@cyrus/shared";
import { useAuth } from "../../../app/useAuth";
import { useApiForm } from "../../../components/useApiForm";
import { Alert, EmptyState, Icon, Tile } from "../../../components/ui";
import { drivesApi, type DriveListItem } from "../../../lib/api";
import { useTitle } from "../../../lib/useTitle";
import { DriveStatusChip } from "./shared";
import { drivePaths, jobLabel, pay, timeLeft } from "./format";

const FILTERS: { key: string; label: string; match: (s: DriveStatus) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "approval", label: "Waiting for approval", match: (s) => s === "PENDING_APPROVAL" },
  { key: "open", label: "Open", match: (s) => s === "PUBLISHED" || s === "ONGOING" },
  { key: "drafts", label: "Drafts", match: (s) => s === "DRAFT" || s === "REJECTED" },
  { key: "past", label: "Past", match: (s) => ["RESULTS_DECLARED", "CLOSED", "CANCELLED"].includes(s) },
];

/** HR: their company's drives (their home). TPO: every drive, approvals first. */
export default function DriveList() {
  const { role } = useAuth();
  const tpo = role === "TPO";
  const paths = drivePaths(role);
  useTitle("Drives");
  const [data, setData] = useState<{ companies: { id: string; name: string }[] | null; drives: DriveListItem[] } | null>(null);
  const [filter, setFilter] = useState("all");
  const load = useApiForm();
  const run = load.run;
  useEffect(() => void run(async () => setData(await drivesApi.list())), [run]);

  const drives = (data?.drives ?? [])
    .filter((d) => FILTERS.find((f) => f.key === filter)!.match(d.status))
    // Approvals waiting on the TPO go first
    .sort((a, b) => Number(b.status === "PENDING_APPROVAL") - Number(a.status === "PENDING_APPROVAL"));
  const waiting = data?.drives.filter((d) => d.status === "PENDING_APPROVAL").length ?? 0;
  const company = data?.companies?.[0]?.name;

  return (
    <>
      <header className="page-head">
        <div className="section-head">
          <Tile icon="jobs" family="azure" />
          <h1 className="title">Drives</h1>
          <Link className="button primary cy-head-action" to={paths.create}>
            New drive
          </Link>
        </div>
        <p className="lead">
          {tpo
            ? "Every company's drives. Approve new ones, and follow the open ones."
            : `${company ? `${company}: your` : "Your"} placement drives. Create one, send it to the placement office, then invite eligible students.`}
        </p>
      </header>

      {load.error && <Alert>{load.error}</Alert>}
      {tpo && waiting > 0 && (
        <div className="banner fam-sun">
          <div className="banner-words">
            <p className="banner-title">
              {waiting} drive{waiting === 1 ? "" : "s"} waiting for your approval
            </p>
            <p className="banner-detail">Students see nothing about a drive until you approve it.</p>
          </div>
          <button type="button" className="banner-go" onClick={() => setFilter("approval")}>
            Show them
          </button>
        </div>
      )}

      {data && !data.drives.length ? (
        <EmptyState sprite="designer" family="azure" action={{ to: paths.create, label: "Create the first drive" }}>
          No drives yet. Create one with the job details, who can apply and the rounds.
        </EmptyState>
      ) : (
        data && (
          <>
            <div className="chips" role="group" aria-label="Filter drives">
              {FILTERS.map((f) => (
                <button key={f.key} type="button" className="chip-link" aria-current={filter === f.key ? "true" : undefined} onClick={() => setFilter(f.key)}>
                  {f.label} <b>{data.drives.filter((d) => f.match(d.status)).length}</b>
                </button>
              ))}
            </div>
            <ul className="cy-cards">
              {drives.map((d) => (
                <li key={d.id}>
                  <Link className="panel cy-card" to={paths.item(d.id)}>
                    <span className="cy-card-top">
                      {tpo && <span className="faint small">{d.company.name}</span>}
                      <DriveStatusChip status={d.status} />
                    </span>
                    <strong className="cy-card-title">{d.roleTitle}</strong>
                    <span className="small">
                      {jobLabel(d.jobType)} · {pay(d)}
                    </span>
                    <span className="cy-card-figures small">
                      <span>{d.rounds} round{d.rounds === 1 ? "" : "s"}</span>
                      <span>{d.invited} invited</span>
                      <span>{d.joined} joined</span>
                      {(d.status === "PUBLISHED" || d.status === "ONGOING") && <span>{timeLeft(d.optInDeadline)}</span>}
                    </span>
                    <span className="cy-card-go" aria-hidden="true">
                      <Icon name="go" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {!drives.length && <p className="faint">No drives here.</p>}
          </>
        )
      )}
    </>
  );
}
