import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { DriveStatus } from "@cyrus/shared";
import { useAuth } from "../../../app/useAuth";
import { Badge, Callout, FilterTabs, PageHeader, Steps, type Tone } from "../../../components/kit";
import { useApiForm } from "../../../components/useApiForm";
import { Alert, EmptyState } from "../../../components/ui";
import { drivesApi, type DriveListItem } from "../../../lib/api";
import { useTitle } from "../../../lib/useTitle";
import { drivePaths, jobLabel, pay, timeLeft, when } from "./format";

const STATUS: Record<DriveStatus, [string, Tone]> = {
  DRAFT: ["Draft", "neutral"],
  PENDING_APPROVAL: ["Awaiting approval", "warning"],
  REJECTED: ["Changes requested", "danger"],
  PUBLISHED: ["Open for joining", "success"],
  ONGOING: ["Rounds running", "info"],
  RESULTS_DECLARED: ["Results out", "accent"],
  CLOSED: ["Closed", "neutral"],
  CANCELLED: ["Cancelled", "danger"],
};

type TabKey = "all" | "action" | "active" | "drafts" | "finished";

/** Drives somebody has to act on: the TPO approves; HR fixes what was sent back. */
const needsAction = (d: DriveListItem, tpo: boolean) => (tpo ? d.status === "PENDING_APPROVAL" : d.status === "REJECTED");

const TABS: Record<TabKey, (d: DriveListItem, tpo: boolean) => boolean> = {
  all: () => true,
  action: needsAction,
  active: (d) => d.status === "PUBLISHED" || d.status === "ONGOING" || d.status === "RESULTS_DECLARED",
  drafts: (d) => d.status === "DRAFT" || d.status === "REJECTED" || d.status === "PENDING_APPROVAL",
  finished: (d) => d.status === "CLOSED" || d.status === "CANCELLED",
};

/** Where the drive is in its life, in one short line. */
function progressText(d: DriveListItem): string {
  if (d.status === "DRAFT" || d.status === "REJECTED") return d.rounds ? `${d.rounds} round${d.rounds === 1 ? "" : "s"} planned` : "No rounds yet";
  if (d.status === "PENDING_APPROVAL") return `${d.rounds} round${d.rounds === 1 ? "" : "s"} planned`;
  if (d.status === "PUBLISHED") return "Joining open, rounds not started";
  if (d.currentRound) return `Round ${d.roundsDone + 1} of ${d.rounds} · ${d.currentRound}`;
  if (d.status === "ONGOING" && d.nextRound.title) return `${d.roundsDone} of ${d.rounds} done · next ${d.nextRound.title}`;
  if (d.status === "RESULTS_DECLARED" || d.status === "CLOSED") return `All ${d.rounds} rounds done`;
  return `${d.roundsDone} of ${d.rounds} rounds done`;
}

/** The people line: only the numbers that mean something at this stage. */
function people(d: DriveListItem): { main: string; sub?: string } {
  if (d.status === "DRAFT" || d.status === "REJECTED" || d.status === "PENDING_APPROVAL") return { main: "Not invited yet" };
  if (!d.invited) return { main: "No one invited", sub: "Invite eligible students" };
  if (d.status === "PUBLISHED") return { main: `${d.joined} joined`, sub: d.awaiting ? `${d.awaiting} still to answer` : `of ${d.invited} invited` };
  if (d.status === "ONGOING") return { main: `${d.active} still in`, sub: `${d.joined} joined` };
  return { main: `${d.selected} selected`, sub: d.placed ? `${d.placed} placed` : d.selected ? "offers pending" : undefined };
}

/** The date that matters now. */
function timing(d: DriveListItem): { main: string; sub?: string } {
  if (d.status === "PUBLISHED") return { main: timeLeft(d.optInDeadline), sub: d.optInDeadline ? `joining closes ${when(d.optInDeadline, false)}` : undefined };
  if (d.status === "ONGOING" && !d.currentRound && d.nextRound.title) return { main: d.nextRound.startsAt ? when(d.nextRound.startsAt) : "Date to be announced", sub: `next: ${d.nextRound.title}` };
  if (d.status === "ONGOING") return { main: "Round running now" };
  return { main: `Updated ${when(d.updatedAt, false)}` };
}

/** HR: their company's drives (their home). TPO: every company's drives. */
export default function DriveList() {
  const { role } = useAuth();
  const tpo = role === "TPO";
  const paths = drivePaths(role);
  useTitle("Drives");
  const [data, setData] = useState<{ companies: { id: string; name: string }[] | null; drives: DriveListItem[] } | null>(null);
  const [tab, setTab] = useState<TabKey>("all");
  const [q, setQ] = useState("");
  const load = useApiForm();
  const run = load.run;
  useEffect(() => void run(async () => setData(await drivesApi.list())), [run]);

  const all = useMemo(
    () => [...(data?.drives ?? [])].sort((a, b) => Number(needsAction(b, tpo)) - Number(needsAction(a, tpo)) || b.updatedAt.localeCompare(a.updatedAt)),
    [data, tpo],
  );
  const term = q.trim().toLowerCase();
  const shown = all.filter((d) => TABS[tab](d, tpo) && (!term || `${d.roleTitle} ${d.company.name}`.toLowerCase().includes(term)));
  const actionCount = all.filter((d) => needsAction(d, tpo)).length;
  const company = data?.companies?.[0]?.name;

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "all", label: "All", count: all.length },
    { key: "action", label: tpo ? "To approve" : "Sent back", count: actionCount },
    { key: "active", label: "Active", count: all.filter((d) => TABS.active(d, tpo)).length },
    { key: "drafts", label: tpo ? "Not live yet" : "Drafts", count: all.filter((d) => TABS.drafts(d, tpo)).length },
    { key: "finished", label: "Finished", count: all.filter((d) => TABS.finished(d, tpo)).length },
  ];

  return (
    <>
      <PageHeader
        eyebrow={tpo ? "Placements" : company}
        title="Drives"
        description={
          tpo
            ? "Every company's placement drives in one place. Approve new ones before students can see them, and follow the ones running."
            : "Your placement drives at this college. Create a drive, send it to the placement office for approval, then invite the students who match."
        }
        actions={
          <Link className="button primary" to={paths.create}>
            New drive
          </Link>
        }
      />

      {load.error && <Alert>{load.error}</Alert>}

      {actionCount > 0 && tab !== "action" && (
        <Callout
          tone={tpo ? "warning" : "danger"}
          title={tpo ? `${actionCount} drive${actionCount === 1 ? " is" : "s are"} waiting for your approval` : `${actionCount} drive${actionCount === 1 ? " was" : "s were"} sent back by the placement office`}
          action={
            <button type="button" onClick={() => setTab("action")}>
              {tpo ? "Review now" : "See what to change"}
            </button>
          }
        >
          {tpo ? "Students see nothing about a drive until you approve it." : "Open the drive to read the note, make the changes and send it again."}
        </Callout>
      )}

      {data && !all.length ? (
        <EmptyState sprite="designer" family="azure" action={{ to: paths.create, label: "Create the first drive" }}>
          No drives yet. A drive has the job details, who can apply, and its rounds.
        </EmptyState>
      ) : (
        data && (
          <>
            <div className="ui-toolbar">
              <FilterTabs label="Filter drives" items={tabs} value={tab} onChange={setTab} />
              <input className="ui-search" type="search" placeholder="Search role or company" aria-label="Search drives" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {!shown.length ? (
              <div className="ui-rows">
                <p className="ui-rows-empty">{term ? `No drive matches "${q.trim()}".` : "Nothing here right now."}</p>
              </div>
            ) : (
              <ul className="ui-rows cy-drive-rows" aria-label="Drives">
                {shown.map((d) => {
                  const [label, tone] = STATUS[d.status];
                  const p = people(d);
                  const t = timing(d);
                  const running = d.status === "ONGOING";
                  return (
                    <li key={d.id}>
                      <Link className="ui-row" to={paths.item(d.id)}>
                        <span className="ui-row-main">
                          <span className="ui-row-title">{d.roleTitle}</span>
                          <span className="ui-row-sub">
                            {tpo && <span>{d.company.name}</span>}
                            <span>{jobLabel(d.jobType)}</span>
                            <span>{pay(d)}</span>
                          </span>
                        </span>
                        <span className="ui-col ui-hide-sm">
                          <Steps done={d.roundsDone} total={d.rounds} current={running} label={`${d.roundsDone} of ${d.rounds} rounds done`} />
                          <span>{progressText(d)}</span>
                        </span>
                        <span className="ui-col ui-hide-sm">
                          <span className="ui-num">{p.main}</span>
                          {p.sub && <span className="ui-col-label">{p.sub}</span>}
                        </span>
                        <span className="ui-col ui-hide-sm">
                          <span>{t.main}</span>
                          {t.sub && <span className="ui-col-label">{t.sub}</span>}
                        </span>
                        <Badge tone={tone}>{label}</Badge>
                        <span className="ui-chevron" aria-hidden="true">
                          ›
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )
      )}
    </>
  );
}
