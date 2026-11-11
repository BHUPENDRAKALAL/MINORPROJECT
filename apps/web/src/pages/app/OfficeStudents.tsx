import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Badge, FilterTabs, PageHeader } from "../../components/kit";
import { Alert } from "../../components/ui";
import { ApiError, officeStudentsApi, type OfficeStudentList, type StudentStatus } from "../../lib/api";
import { STUDENT_STATUS } from "./students";
import { useTitle } from "../../lib/useTitle";


type Tab = "all" | StudentStatus;
const FILTER_KEYS = ["q", "branch", "batch", "placed", "minCgpa", "maxBacklogs", "sort"] as const;

/** One labelled filter control in the toolbar. */
function Filter({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="st-filter">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Every student, for the TPO and placement staff: counts per profile state, filters kept in the address. */
export default function OfficeStudents() {
  useTitle("Students");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<OfficeStudentList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState(params.get("q") ?? "");
  const tab = (params.get("status") ?? "all") as Tab;
  const page = Number(params.get("page") ?? 1);
  const query = params.toString();

  // Ask the API again whenever the filters in the address change.
  useEffect(() => {
    let gone = false;
    setLoading(true);
    officeStudentsApi.list(query).then(
      (d) => {
        if (gone) return;
        setData(d);
        setError(null);
        setLoading(false);
      },
      (e) => {
        if (gone) return;
        setError(e instanceof ApiError ? e.message : "Couldn't load the students.");
        setLoading(false);
      },
    );
    return () => {
      gone = true;
    };
  }, [query]);

  // Typing in the search box filters after a short pause, not on every key.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q.trim()) set({ q: q.trim() || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function set(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  }

  const branches = useMemo(() => new Set((params.get("branch") ?? "").split(",").filter(Boolean)), [params]);
  const toggleBranch = (b: string) => {
    const next = new Set(branches);
    if (next.has(b)) next.delete(b);
    else next.add(b);
    set({ branch: [...next].join(",") || null });
  };
  const filtered = FILTER_KEYS.some((k) => params.get(k) && k !== "sort");
  const c = data?.counts;
  const from = data ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.total, data.page * data.pageSize) : 0;

  return (
    <>
      <PageHeader title="Students" description="Every registered student: where their profile is, their verified marks, placement and the drives they're in. Filter to find anyone." />

      <div className="st-bar">
        <div className="st-search">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input type="search" aria-label="Search students" placeholder="Search by name, roll number or email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="st-filters">
          <Filter label="Batch">
            <select value={params.get("batch") ?? ""} onChange={(e) => set({ batch: e.target.value || null })}>
              <option value="">All</option>
              {data?.batches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Filter>
          <Filter label="Placement">
            <select value={params.get("placed") ?? ""} onChange={(e) => set({ placed: e.target.value || null })}>
              <option value="">All</option>
              <option value="no">Not placed</option>
              <option value="yes">Placed</option>
            </select>
          </Filter>
          <Filter label="CGPA at least">
            <input type="number" min="0" max="10" step="0.5" inputMode="decimal" placeholder="Any" value={params.get("minCgpa") ?? ""} onChange={(e) => set({ minCgpa: e.target.value || null })} />
          </Filter>
          <Filter label="Backlogs at most">
            <input type="number" min="0" max="20" inputMode="numeric" placeholder="Any" value={params.get("maxBacklogs") ?? ""} onChange={(e) => set({ maxBacklogs: e.target.value || null })} />
          </Filter>
          <Filter label="Sort">
            <select value={params.get("sort") ?? "name"} onChange={(e) => set({ sort: e.target.value === "name" ? null : e.target.value })}>
              <option value="name">Name</option>
              <option value="roll">Roll number</option>
              <option value="cgpa">CGPA, highest first</option>
              <option value="recent">Newest sign-ups</option>
            </select>
          </Filter>
        </div>
      </div>

      {data && data.branches.length > 0 && (
        <div className="st-branches" role="group" aria-label="Branches">
          <span className="st-branches-label">Branch</span>
          {data.branches.map((b) => (
            <button key={b} type="button" className={`st-chip${branches.has(b) ? " is-on" : ""}`} aria-pressed={branches.has(b)} onClick={() => toggleBranch(b)}>
              {b}
            </button>
          ))}
          {filtered && (
            <button
              type="button"
              className="st-clear"
              onClick={() => {
                setQ("");
                setParams(params.get("status") ? { status: params.get("status")! } : {}, { replace: true });
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {c && (
        <FilterTabs
          label="Profile status"
          value={tab}
          onChange={(k) => set({ status: k === "all" ? null : k })}
          items={[
            { key: "all", label: "All", count: c.all },
            { key: "VERIFIED", label: "Verified", count: c.VERIFIED },
            { key: "PENDING_VERIFICATION", label: "Being checked", count: c.PENDING_VERIFICATION },
            { key: "REJECTED", label: "Needs changes", count: c.REJECTED },
            { key: "PROFILE_INCOMPLETE", label: "Not sent yet", count: c.PROFILE_INCOMPLETE },
          ]}
        />
      )}

      {error && <Alert>{error}</Alert>}

      {data && (
        <section className={`rq-card st-card${loading ? " is-loading" : ""}`} aria-busy={loading}>
          <div className="rq-card-head st-card-head">
            <p>
              {data.total ? (
                <>
                  Showing <b>{from}</b>–<b>{to}</b> of <b>{data.total}</b> student{data.total === 1 ? "" : "s"}
                  {c && c.placed > 0 && <> · {c.placed} placed</>}
                </>
              ) : (
                "No students match these filters."
              )}
            </p>
          </div>
          {data.students.length > 0 && (
            <div className="scroll">
              <table className="cy-table dd-table st-table">
                <thead>
                  <tr>
                    <th scope="col">Student</th>
                    <th scope="col">Branch</th>
                    <th scope="col" className="st-num">CGPA</th>
                    <th scope="col" className="st-num">Backlogs</th>
                    <th scope="col" className="st-num">10th / 12th</th>
                    <th scope="col">Profile</th>
                    <th scope="col">Placement</th>
                    <th scope="col" className="st-num">Drives</th>
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((s) => {
                    const st = STUDENT_STATUS[s.status];
                    const open = () => navigate(`/office/students/${s.id}`);
                    return (
                      <tr key={s.id} className="st-row" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === "Enter" && open()}>
                        <td>
                          <span className="dd-name">{s.name}</span>
                          <span className="dd-roll">{s.rollNo}</span>
                        </td>
                        <td>
                          {s.branch} {s.batch}
                        </td>
                        <td className="st-num">{s.cgpa ?? "—"}</td>
                        <td className={`st-num${s.activeBacklogs ? " st-warn" : ""}`}>{s.activeBacklogs ?? "—"}</td>
                        <td className="st-num st-soft">
                          {s.tenthPercent ?? "—"} / {s.twelfthPercent ?? (s.diplomaPercent != null ? `${s.diplomaPercent} (dip.)` : "—")}
                        </td>
                        <td>
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </td>
                        <td>{s.placementStatus === "PLACED" ? <Badge tone="accent">Placed</Badge> : <span className="st-soft">Not yet</span>}</td>
                        <td className="st-num st-soft" title={`${s.drives.invited} invited · ${s.drives.joined} joined · ${s.drives.selected} selected`}>
                          {s.drives.invited ? (
                            <>
                              {s.drives.joined}/{s.drives.invited}
                              {s.drives.selected > 0 && <span className="st-sel"> · {s.drives.selected} sel.</span>}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {data.total > data.pageSize && (
            <div className="st-pages">
              <button type="button" className="small" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
                Previous
              </button>
              <span>
                Page {data.page} of {Math.ceil(data.total / data.pageSize)}
              </span>
              <button type="button" className="small" disabled={to >= data.total} onClick={() => set({ page: String(page + 1) })}>
                Next
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
