import { useEffect, useRef, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { notificationsApi } from "../lib/api";
import { useAuth } from "./useAuth";

/** One shared unread count for the whole app (the side panel badge, the tab bar, the notifications page). */
let unread = 0;
const listeners = new Set<() => void>();

export function announceUnread(n: number) {
  if (n === unread) return;
  unread = n;
  listeners.forEach((l) => l());
}

export function useUnread(): number {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => unread,
  );
}

const EVERY_MS = 15_000;

/**
 * Mounted once (in the shell). Checks the unread count every 15 s and when the tab comes back.
 * When it goes up, the new notices pop up as toasts with an "Open" button. Notices that were
 * already there when the page loaded don't pop up.
 */
export function useUnreadWatcher() {
  const { status } = useAuth();
  const navigate = useNavigate();
  // The router hands out a new navigate function as the page changes; keep the latest one in a ref
  // so the watcher starts once per sign-in instead of again on every page (which flooded the API).
  const go = useRef(navigate);
  go.current = navigate;
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (status !== "signedIn") return;
    let stop = false;

    const showNew = async () => {
      const list = await notificationsApi.list();
      if (stop) return;
      announceUnread(list.unread);
      if (!seen.current) {
        seen.current = new Set(list.items.map((n) => n.id));
        return;
      }
      const fresh = list.items.filter((n) => !n.readAt && !seen.current!.has(n.id)).reverse();
      for (const n of fresh.slice(-3)) {
        toast(n.title, {
          id: n.id,
          description: n.body,
          duration: 9000,
          action: n.path
            ? {
                label: "Open",
                onClick: () => {
                  void notificationsApi.read([n.id]).then((r) => announceUnread(r.unread));
                  go.current(n.path!);
                },
              }
            : undefined,
        });
      }
      list.items.forEach((n) => seen.current!.add(n.id));
    };

    const check = async () => {
      try {
        const { unread: count } = await notificationsApi.unreadCount();
        if (stop) return;
        if (seen.current === null || count > unread) await showNew();
        else announceUnread(count);
      } catch {
        // A missed check is fine; the next one catches up.
      }
    };

    void check();
    const t = setInterval(() => void check(), EVERY_MS);
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [status]);
}
