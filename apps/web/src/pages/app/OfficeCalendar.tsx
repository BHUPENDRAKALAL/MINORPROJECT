import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useAuth } from "../../app/useAuth";
import { PageHeader } from "../../components/kit";
import { Alert } from "../../components/ui";
import { ApiError, scheduleApi, type CalendarDeadline, type CalendarEvent } from "../../lib/api";
import { useTitle } from "../../lib/useTitle";

type View = "week" | "month";
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "2026-11-14" for a local date (the calendar works in the viewer's own day, like a wall calendar). */
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromKey = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};
const mondayOf = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/** The look of an event by what it is: waiting for approval, running, finished, or clashing. */
function tone(e: CalendarEvent) {
  if (e.clash) return "is-clash";
  if (e.driveStatus === "PENDING_APPROVAL") return "is-pending";
  if (e.roundStatus === "RESULTS_PUBLISHED" || e.driveStatus === "CLOSED" || e.driveStatus === "RESULTS_DECLARED") return "is-done";
  return "is-live";
}

/** Two of a day's rounds that run at the same time (any venue): marked so the day reads as crowded. */
function overlapIds(events: CalendarEvent[]) {
  const ids = new Set<string>();
  for (const a of events) for (const b of events) if (a !== b && a.driveId !== b.driveId && a.start < b.end && b.start < a.end) ids.add(a.id);
  return ids;
}

function EventCard({ e, overlapping, tpo }: { e: CalendarEvent; overlapping: boolean; tpo: boolean }) {
  const body = (
    <>
      <span className="cal-ev-time">
        {time(e.start)}–{time(e.end)}
        {e.clash && <span className="cal-flag">Same venue</span>}
        {!e.clash && overlapping && <span className="cal-flag is-soft">Overlaps</span>}
      </span>
      <span className="cal-ev-title">{e.title}</span>
      <span className="cal-ev-sub">
        {e.company} · {e.roleTitle}
      </span>
      <span className="cal-ev-sub">
        {e.mode === "ONLINE" ? "Online" : (e.venue ?? "Venue to be announced")}
        {e.joined > 0 && ` · ${e.joined} joined`}
      </span>
    </>
  );
  return tpo ? (
    <Link className={`cal-ev ${tone(e)}`} to={`/office/drives/${e.driveId}/rounds/${e.id}`} title={`${e.company} · ${e.roleTitle} · ${e.title}`}>
      {body}
    </Link>
  ) : (
    <div className={`cal-ev ${tone(e)}`}>{body}</div>
  );
}

/** The placement office's campus calendar: every round and joining deadline, by week or by month. */
export default function OfficeCalendar() {
  useTitle("Calendar");
  const { role } = useAuth();
  const tpo = role === "TPO";
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "month" ? "month" : "week";
  const anchor = params.get("date") ? fromKey(params.get("date")!) : new Date();
  const [data, setData] = useState<{ events: CalendarEvent[]; deadlines: CalendarDeadline[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The days on screen: one week from Monday, or the whole weeks that cover the month.
  const days = useMemo(() => {
    if (view === "week") return Array.from({ length: 7 }, (_, i) => addDays(mondayOf(anchor), i));
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = mondayOf(first);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    const n = Math.ceil((last.getTime() - start.getTime()) / DAY_MS / 7 + 1 / 7) * 7;
    return Array.from({ length: Math.max(35, n) }, (_, i) => addDays(start, i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, keyOf(anchor)]);
  const from = days[0]!;
  const to = addDays(days[days.length - 1]!, 1);

  useEffect(() => {
    let gone = false;
    setError(null);
    scheduleApi.calendar(from.toISOString(), to.toISOString()).then(
      (d) => !gone && setData(d),
      (e) => !gone && setError(e instanceof ApiError ? e.message : "Couldn't load the calendar."),
    );
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from.getTime(), to.getTime()]);

  const byDay = useMemo(() => {
    const m = new Map<string, { events: CalendarEvent[]; deadlines: CalendarDeadline[] }>();
    for (const d of days) m.set(keyOf(d), { events: [], deadlines: [] });
    for (const e of data?.events ?? []) m.get(keyOf(new Date(e.start)))?.events.push(e);
    for (const d of data?.deadlines ?? []) m.get(keyOf(new Date(d.at)))?.deadlines.push(d);
    return m;
  }, [data, days]);

  const go = (patch: { view?: View; date?: Date }) => {
    const next = new URLSearchParams(params);
    if (patch.view) next.set("view", patch.view);
    if (patch.date) next.set("date", keyOf(patch.date));
    setParams(next, { replace: true });
  };
  const step = (n: number) => go({ date: view === "week" ? addDays(anchor, 7 * n) : new Date(anchor.getFullYear(), anchor.getMonth() + n, 1) });
  const today = keyOf(new Date());
  const label =
    view === "week"
      ? `${days[0]!.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${days[6]!.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
      : anchor.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const clashes = (data?.events ?? []).filter((e) => e.clash).length;

  return (
    <>
      <PageHeader title="Calendar" description="Every round and joining deadline on campus, across all drives. Clashes in the same venue are marked in red." />

      <div className="cal-bar">
        <div className="cal-nav">
          <button type="button" className="small" onClick={() => go({ date: new Date() })}>
            Today
          </button>
          <button type="button" className="small cal-arrow" aria-label={view === "week" ? "Previous week" : "Previous month"} onClick={() => step(-1)}>
            ‹
          </button>
          <button type="button" className="small cal-arrow" aria-label={view === "week" ? "Next week" : "Next month"} onClick={() => step(1)}>
            ›
          </button>
          <h2 className="cal-label">{label}</h2>
        </div>
        <div className="ui-segmented" role="radiogroup" aria-label="View">
          {(["week", "month"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => go({ view: v })}>
              {v === "week" ? "Week" : "Month"}
            </button>
          ))}
        </div>
      </div>

      <div className="cal-legend" aria-label="Legend">
        <span className="cal-key is-live">Running</span>
        <span className="cal-key is-pending">Waiting for approval</span>
        <span className="cal-key is-done">Finished</span>
        <span className="cal-key is-clash">Same venue, same time</span>
        {clashes > 0 && <span className="cal-count">{clashes} clashing rounds this {view}</span>}
      </div>

      {error && <Alert>{error}</Alert>}

      {view === "week" ? (
        <div className="cal-week">
          {days.map((d, i) => {
            const k = keyOf(d);
            const cell = byDay.get(k)!;
            const overlap = overlapIds(cell.events);
            return (
              <section key={k} className={`cal-day${k === today ? " is-today" : ""}`} aria-label={d.toDateString()}>
                <header className="cal-day-head">
                  <span className="cal-dow">{WEEKDAYS[i]}</span>
                  <span className="cal-date">{d.getDate()}</span>
                  {cell.events.length > 0 && <span className="cal-n">{cell.events.length}</span>}
                </header>
                <div className="cal-day-body">
                  {cell.deadlines.map((dl) => (
                    <p key={dl.driveId} className="cal-deadline" title={`Joining closes at ${time(dl.at)}`}>
                      <span>Joining closes {time(dl.at)}</span>
                      {dl.company} · {dl.roleTitle}
                    </p>
                  ))}
                  {cell.events.map((e) => (
                    <EventCard key={e.id} e={e} overlapping={overlap.has(e.id)} tpo={tpo} />
                  ))}
                  {!cell.events.length && !cell.deadlines.length && <p className="cal-free">Free</p>}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="cal-month">
          {WEEKDAYS.map((w) => (
            <span key={w} className="cal-month-dow">
              {w}
            </span>
          ))}
          {days.map((d) => {
            const k = keyOf(d);
            const cell = byDay.get(k)!;
            const out = d.getMonth() !== anchor.getMonth();
            const clash = cell.events.some((e) => e.clash);
            const busy = cell.events.length;
            return (
              <button
                key={k}
                type="button"
                className={`cal-mday${out ? " is-out" : ""}${k === today ? " is-today" : ""}${clash ? " has-clash" : ""}`}
                onClick={() => go({ view: "week", date: d })}
                aria-label={`${d.toDateString()}: ${busy} round${busy === 1 ? "" : "s"}${cell.deadlines.length ? `, ${cell.deadlines.length} joining deadline${cell.deadlines.length === 1 ? "" : "s"}` : ""}${clash ? ", with a clash" : ""}`}
              >
                <span className="cal-mday-date">{d.getDate()}</span>
                <span className="cal-mday-dots" aria-hidden="true">
                  {cell.events.slice(0, 6).map((e) => (
                    <span key={e.id} className={`cal-dot ${tone(e)}`} />
                  ))}
                  {cell.events.length > 6 && <span className="cal-more">+{cell.events.length - 6}</span>}
                </span>
                {busy > 0 && (
                  <span className="cal-mday-n">
                    {busy} round{busy === 1 ? "" : "s"}
                  </span>
                )}
                {cell.deadlines.length > 0 && <span className="cal-mday-dl">{cell.deadlines.length} closing</span>}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
