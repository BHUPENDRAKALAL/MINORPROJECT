import { useEffect, useState } from "react";
import { notificationsApi } from "../lib/api";
import { useAuth } from "./useAuth";

/** Pages that change the count (the notifications page) tell the side panel right away. */
const listeners = new Set<(n: number) => void>();
export function announceUnread(n: number) {
  listeners.forEach((l) => l(n));
}

const EVERY_MS = 30_000;

/** How many notifications the signed-in person hasn't read. Checked every 30 s and when the tab comes back. */
export function useUnread(): number {
  const { status } = useAuth();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (status !== "signedIn") return;
    let stop = false;
    const check = () => void notificationsApi.unreadCount().then((r) => !stop && setCount(r.unread), () => undefined);
    check();
    const t = setInterval(check, EVERY_MS);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    listeners.add(setCount);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      listeners.delete(setCount);
    };
  }, [status]);
  return count;
}
