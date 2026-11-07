import { useCallback, useEffect, useState } from "react";
import { QUEUES, ROUTE_CLASSES } from "@cyrus/shared";
import { apiGet } from "../../lib/api";
import { useTitle } from "../../lib/useTitle";

interface Check {
  ok: boolean;
  ms: number;
  error?: string;
}
interface Ready {
  status: "ready" | "not_ready";
  checks: { database: Check; redis: Check };
}
type Row = { name: string; state: "checking" | "ok" | "down"; note: string };

const TONE = { checking: "working", ok: "done", down: "stuck" } as const;

/** Development page: is the API, database and Redis reachable? (Was the first setup-check screen.) */
export default function SystemStatus() {
  useTitle("System status");
  const [rows, setRows] = useState<Row[]>([
    { name: "API", state: "checking", note: "" },
    { name: "Database", state: "checking", note: "" },
    { name: "Redis", state: "checking", note: "" },
  ]);

  const run = useCallback(async () => {
    setRows((r) => r.map((x) => ({ ...x, state: "checking", note: "" })));
    try {
      await apiGet<{ status: string }>("/health");
      const ready = await apiGet<Ready>("/ready", [503]);
      const show = (c: Check): Pick<Row, "state" | "note"> =>
        c.ok ? { state: "ok", note: `${c.ms} ms` } : { state: "down", note: c.error ?? "not reachable" };
      setRows([
        { name: "API", state: "ok", note: "responding" },
        { name: "Database", ...show(ready.checks.database) },
        { name: "Redis", ...show(ready.checks.redis) },
      ]);
    } catch {
      setRows([
        { name: "API", state: "down", note: "not running — start it with pnpm dev:api" },
        { name: "Database", state: "down", note: "unknown until the API runs" },
        { name: "Redis", state: "down", note: "unknown until the API runs" },
      ]);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <>
      <header className="page-head list-head">
        <h1 className="title">System status</h1>
        <button type="button" onClick={() => void run()}>
          Check again
        </button>
        <p className="lead">Development only: whether the local services are running.</p>
      </header>
      <table className="list" aria-live="polite">
        <thead>
          <tr>
            <th>Service</th>
            <th>State</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="title-cell strong">{r.name}</td>
              <td data-label="State">
                <span className={`stage ${TONE[r.state]}`}>{r.state === "checking" ? "Checking" : r.state === "ok" ? "Up" : "Down"}</span>
              </td>
              <td data-label="Note" className="faint">
                {r.state === "checking" ? "checking…" : r.note}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <section>
        <div className="section-head">
          <h2>Job queues</h2>
        </div>
        <p className="faint">{Object.values(QUEUES).map((q) => q.name).join(" · ")}</p>
        <div className="section-head">
          <h2>Route classes</h2>
        </div>
        <p className="faint">{Object.values(ROUTE_CLASSES).map((c) => c.label).join(" · ")}</p>
      </section>
    </>
  );
}
