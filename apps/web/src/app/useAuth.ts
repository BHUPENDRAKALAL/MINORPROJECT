import { createContext, useContext } from "react";
import type { Role } from "@cyrus/shared";
import type { Me, Tokens } from "../lib/api";

export type Status = "loading" | "signedOut" | "signedIn";

export interface AuthContextValue {
  status: Status;
  me: Me | null;
  /** The role whose pages are shown. Only one at a time; the role switcher changes it. */
  role: Role | null;
  setRole: (r: Role) => void;
  /** Store tokens from login / verify / invite and load the profile. */
  signIn: (t: Tokens) => Promise<Me>;
  signOut: () => Promise<void>;
  reloadMe: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
