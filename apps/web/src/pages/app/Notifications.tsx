import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useApiForm } from "../../components/useApiForm";
import { FilterTabs, PageHeader } from "../../components/kit";
import { Alert } from "../../components/ui";
import { notificationsApi, type NotificationItem } from "../../lib/api";
import { useTitle } from "../../lib/useTitle";
import { announceUnread } from "../../app/useUnread";

const CHANNEL: Record<NotificationItem["channel"], string> = { QUEUE: "Interview line", DRIVES: "Drives", OFFERS: "Offers", GENERAL: "General" };

/** "just now", "5 min ago", "3 h ago", "2 days ago", then the date. */
function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} day${s < 2 * 86_400 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** Everything the app has told me: newest first, unread marked, click to open the page it's about. */
export default function Notifications() {
  useTitle("Notifications");
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [more, setMore] = useState(false);
  const form = useApiForm();
  const run = form.run;

  const load = useCallback(
    () =>
      void run(async () => {
        const r = await notificationsApi.list();
        setItems(r.items);
        setUnread(r.unread);
        setMore(r.more);
        announceUnread(r.unread);
      }),
    [run],
  );
  useEffect(load, [load]);

  const markRead = async (ids?: string[]) => {
    const r = await notificationsApi.read(ids);
    setUnread(r.unread);
    announceUnread(r.unread);
    const at = new Date().toISOString();
    setItems((list) => list?.map((n) => (!ids || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? at } : n)) ?? null);
  };

  const open = (n: NotificationItem) =>
    void form.run(async () => {
      if (!n.readAt) await markRead([n.id]);
      if (n.path) navigate(n.path);
    });

  const [tab, setTab] = useState<"all" | "unread">("all");
  const shown = (items ?? []).filter((n) => tab === "all" || !n.readAt);
  // Newest first, in three plain groups so a long list stays easy to scan.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = startOfToday.getTime() - 6 * 86_400_000;
  const groups: { title: string; items: NotificationItem[] }[] = [
    { title: "Today", items: shown.filter((n) => new Date(n.createdAt).getTime() >= startOfToday.getTime()) },
    { title: "This week", items: shown.filter((n) => { const t = new Date(n.createdAt).getTime(); return t < startOfToday.getTime() && t >= weekAgo; }) },
    { title: "Older", items: shown.filter((n) => new Date(n.createdAt).getTime() < weekAgo) },
  ].filter((g) => g.items.length);

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Invites, round results, your turn in an interview line and offers. Open one to go to the page it's about."
        actions={
          unread > 0 && (
            <button type="button" onClick={() => void form.run(() => markRead())}>
              Mark all as read
            </button>
          )
        }
      />
      {form.error && <Alert>{form.error}</Alert>}
      {items && (
        <FilterTabs
          label="Show"
          value={tab}
          onChange={setTab}
          items={[
            { key: "all", label: "All", count: items.length },
            { key: "unread", label: "Unread", count: unread },
          ]}
        />
      )}
      {items && !shown.length && (
        <div className="rq-empty-state">
          <p className="rq-empty-title">{tab === "unread" ? "You're all caught up" : "Nothing yet"}</p>
          <p>{tab === "unread" ? "No unread notifications." : "Invites, round results, your turn in an interview line and offers will show up here."}</p>
        </div>
      )}
      {groups.map((g) => (
        <section key={g.title} className="nt-group" aria-label={g.title}>
          <h2 className="nt-group-title">{g.title}</h2>
          <ul className="ui-rows cy-notes-list">
            {g.items.map((n) => (
              <li key={n.id} className={n.readAt ? "" : "is-unread"}>
                <button type="button" className="ui-row nt-row cy-note" onClick={() => open(n)}>
                  <span className="nt-dot" aria-hidden="true" />
                  <span className="ui-row-main">
                    <span className="ui-row-title nt-title">
                      {!n.readAt && <span className="hidden">Unread: </span>}
                      {n.title}
                    </span>
                    <span className="nt-body">{n.body}</span>
                  </span>
                  <span className="nt-meta">
                    <span className="ui-tag">{CHANNEL[n.channel]}</span>
                    <span className="nt-time">{ago(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {more && items && tab === "all" && (
        <div className="nt-more">
          <button
            type="button"
            onClick={() =>
              void form.run(async () => {
                const r = await notificationsApi.list(items[items.length - 1]!.createdAt);
                setItems([...items, ...r.items]);
                setMore(r.more);
              })
            }
          >
            Show older
          </button>
        </div>
      )}
    </>
  );
}
