import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Role } from "@cyrus/shared";
import {
  authApi,
  clearSession,
  getSession,
  meApi,
  onSessionChange,
  onSessionLost,
  refreshSession,
  setSessionFromTokens,
  type Me,
  type Tokens,
} from "../lib/api";
import { ROLE_PRIORITY } from "../lib/constants";

import { AuthContext, type AuthContextValue, type Status } from "./useAuth";

const ROLE_KEY = "cyrus-role";
/** Refresh this long before the access token runs out. */
const REFRESH_EARLY_MS = 60_000;

function readSavedRole(): Role | null {
  try {
    return localStorage.getItem(ROLE_KEY) as Role | null;
  } catch {
    return null;
  }
}

function pickRole(roles: Role[], wanted: Role | null): Role | null {
  if (wanted && roles.includes(wanted)) return wanted;
  return ROLE_PRIORITY.find((r) => roles.includes(r)) ?? roles[0] ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [role, setRoleState] = useState<Role | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadMe = useCallback(async () => {
    const profile = await meApi.get();
    setMe(profile);
    setRoleState((current) => pickRole(profile.roles, current ?? readSavedRole()));
    setStatus("signedIn");
    return profile;
  }, []);

  // On start: try the refresh cookie once. StrictMode runs this twice; refreshSession() shares one request.
  useEffect(() => {
    let alive = true;
    (async () => {
      const tokens = getSession().accessToken ? true : await refreshSession();
      if (!alive) return;
      if (!tokens) {
        setStatus("signedOut");
        return;
      }
      try {
        await loadMe();
      } catch {
        if (alive) setStatus("signedOut");
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadMe]);

  // Any request that could not refresh sends the person back to sign-in.
  useEffect(
    () =>
      onSessionLost(() => {
        setMe(null);
        setStatus("signedOut");
      }),
    [],
  );

  // Refresh shortly before the access token expires.
  useEffect(() => {
    const schedule = (expiresAt: number | null) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (!expiresAt) return;
      const wait = Math.max(5_000, expiresAt - Date.now() - REFRESH_EARLY_MS);
      timer.current = setTimeout(() => {
        void refreshSession().then((t) => {
          if (!t) {
            setMe(null);
            setStatus("signedOut");
          }
        });
      }, wait);
    };
    schedule(getSession().expiresAt);
    const off = onSessionChange((s) => schedule(s.expiresAt));
    return () => {
      off();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const signIn = useCallback(
    async (t: Tokens) => {
      setSessionFromTokens(t);
      return loadMe();
    },
    [loadMe],
  );

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Signing out locally still works when the server can't be reached.
    }
    clearSession();
    setMe(null);
    setStatus("signedOut");
  }, []);

  const setRole = useCallback((r: Role) => {
    setRoleState(r);
    try {
      localStorage.setItem(ROLE_KEY, r);
    } catch {
      // Remembering the role is only a convenience.
    }
  }, []);

  const reloadMe = useCallback(async () => {
    await loadMe();
  }, [loadMe]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, me, role, setRole, signIn, signOut, reloadMe }),
    [status, me, role, setRole, signIn, signOut, reloadMe],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
