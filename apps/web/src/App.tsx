import { useCallback, useEffect, useState } from "react";
import { QUEUES, ROUTE_CLASSES } from "@placesync/shared";
import { apiGet } from "./lib/api";
import "./App.css";

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

/**
 * Temporary setup-check screen: shows whether the API, database and Redis are reachable.
 * Replaced by the real sign-in screen once the auth module lands.
 */
export default function App() {
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
    <main className="setup">
      <header>
        <p className="eyebrow">PlaceSync · development build</p>
        <h1>Setup check</h1>
        <p className="muted">This screen confirms the local services are running. It will be replaced by sign-in.</p>
      </header>

      <ul className="checks" aria-live="polite">
        {rows.map((r) => (
          <li key={r.name} className={`check ${r.state}`}>
            <span className="dot" aria-hidden="true" />
            <span className="name">{r.name}</span>
            <span className="note">{r.state === "checking" ? "checking…" : r.note}</span>
          </li>
        ))}
      </ul>

      <button type="button" onClick={() => void run()}>
        Check again
      </button>

      <section className="facts">
        <div>
          <h2>Job queues</h2>
          <p>{Object.values(QUEUES).map((q) => q.name).join(" · ")}</p>
        </div>
        <div>
          <h2>Route classes</h2>
          <p>{Object.values(ROUTE_CLASSES).map((c) => c.label).join(" · ")}</p>
        </div>
      </section>
    </main>
  );
}
