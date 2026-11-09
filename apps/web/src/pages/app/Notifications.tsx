import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useApiForm } from "../../components/useApiForm";
import { Alert, EmptyState, Tile } from "../../components/ui";
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

  return (
    <>
      <header className="page-head">
        <div className="section-head">
          <Tile icon="needs" family="sun" />
          <h1 className="title">Notifications</h1>
          {unread > 0 && <span className="pill pill-needs">{unread} new</span>}
          {unread > 0 && (
            <button type="button" className="quiet cy-head-action" onClick={() => void form.run(() => markRead())}>
              Mark all as read
            </button>
          )}
        </div>
      </header>
      {form.error && <Alert>{form.error}</Alert>}
      {items && !items.length && (
        <EmptyState sprite="smith" family="sun">
          Nothing yet. Invites, round results, your turn in an interview line and offers will show up here.
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <ul className="cy-notes-list">
          {items.map((n) => (
            <li key={n.id} className={n.readAt ? "" : "is-unread"}>
              <button type="button" className="cy-note" onClick={() => open(n)}>
                <span className="cy-note-dot" aria-hidden="true" />
                <span className="cy-note-main">
                  <span className="cy-note-title">
                    {!n.readAt && <span className="hidden">Unread: </span>}
                    {n.title}
                  </span>
                  <span className="small cy-note-body">{n.body}</span>
                </span>
                <span className="cy-note-meta faint small">
                  <span>{CHANNEL[n.channel]}</span>
                  <span>{ago(n.createdAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {more && items && (
        <p className="buttons">
          <button
            type="button"
            className="quiet"
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
        </p>
      )}
    </>
  );
}
