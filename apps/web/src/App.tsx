import { useEffect, useMemo, type ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import type { Role } from "@cyrus/shared";
import { AuthProvider } from "./app/auth";
import { useAuth } from "./app/useAuth";
import { AREAS, homeFor, OFFICE_AREA, STUDENT_AREA, type NavArea } from "./app/nav";
import Shell from "./app/Shell";
import { EmptyState, ShapeDefs, Sprite } from "./components/ui";
import { APP_NAME } from "./lib/brand";
import AcceptInvite from "./pages/auth/AcceptInvite";
import { BarePage } from "./pages/auth/AuthLayout";
import { useTitle } from "./lib/useTitle";
import { ForgotPassword, ResetPassword } from "./pages/auth/PasswordReset";
import SignIn from "./pages/auth/SignIn";
import SignUp from "./pages/auth/SignUp";
import VerifyEmail from "./pages/auth/VerifyEmail";
import ChangePassword from "./pages/app/ChangePassword";
import Placeholder from "./pages/app/Placeholder";
import StudentHome from "./pages/app/StudentHome";
import StudentProfile from "./pages/app/StudentProfile";
import ReviewQueue from "./pages/app/ReviewQueue";
import Team from "./pages/app/Team";
import SystemStatus from "./pages/app/SystemStatus";

function Loading() {
  return (
    <div className="bare">
      <div className="loading" role="status">
        <Sprite name="smith" size={96} plays />
        <p className="faint">Opening {APP_NAME}…</p>
      </div>
    </div>
  );
}

/** Signed-in pages. While the start-up refresh runs, show a loader; when signed out, go to sign-in and come back after. */
function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <Loading />;
  if (status === "signedOut") return <Navigate to="/sign-in" replace state={{ from: location.pathname + location.search }} />;
  return <Shell />;
}

/** Public auth pages: someone already signed in goes home. */
function PublicOnly() {
  const { status } = useAuth();
  if (status === "loading") return <Loading />;
  if (status === "signedIn") return <Navigate to="/" replace />;
  return <Outlet />;
}

/** An area (student, office, company…) opens only for its roles. Opening it switches the active role when the person has one. */
function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { me, role, setRole } = useAuth();
  const allowed = useMemo(() => me?.roles.filter((r) => roles.includes(r)) ?? [], [me, roles]);
  const fits = role !== null && roles.includes(role);
  useEffect(() => {
    if (!fits && allowed.length) setRole(allowed[0]);
  }, [fits, allowed, setRole]);
  if (fits) return <>{children}</>;
  if (allowed.length) return null;
  return <NotForYou />;
}

function NotForYou() {
  const { role } = useAuth();
  useTitle("Not available");
  return (
    <>
      <header className="page-head">
        <h1 className="title">Not available</h1>
      </header>
      <EmptyState sprite="blocked" family="ember" action={{ to: role ? homeFor(role) : "/", label: "Back to my home" }}>
        This page is for a different role. Your account can't open it.
      </EmptyState>
    </>
  );
}

function NotFound() {
  useTitle("Page not found");
  return (
    <>
      <header className="page-head">
        <h1 className="title">Page not found</h1>
      </header>
      <EmptyState sprite="ask" family="sun" action={{ to: "/", label: "Back to my home" }}>
        There's nothing at this address. It may have moved, or the link has a typo.
      </EmptyState>
    </>
  );
}

function Home() {
  const { status, role } = useAuth();
  if (status === "loading") return <Loading />;
  if (status === "signedOut" || !role) return <Navigate to="/sign-in" replace />;
  return <Navigate to={homeFor(role)} replace />;
}

/** /status works signed in (inside the shell) and signed out (plain page). */
function StatusRoute() {
  const { status } = useAuth();
  if (status === "loading") return <Loading />;
  if (status === "signedIn")
    return (
      <Shell>
        <SystemStatus />
      </Shell>
    );
  return (
    <BarePage>
      <div className="panel status-panel">
        <SystemStatus />
        <p className="small">
          <Link to="/sign-in">Back to sign in</Link>
        </p>
      </div>
    </BarePage>
  );
}

/** Built pages; everything else shows its designed empty state until it is built. */
function pageFor(area: NavArea, key: string) {
  if (area === STUDENT_AREA && key === "home") return <StudentHome />;
  if (area === STUDENT_AREA && key === "profile") return <StudentProfile />;
  if (area === OFFICE_AREA && key === "review") return <ReviewQueue />;
  if (area === OFFICE_AREA && key === "team") return <Team />;
  return null;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route element={<PublicOnly />}>
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/sign-up" element={<SignUp />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Route>
      {/* Open either way: verifying signs you in and then shows a "you're in" screen. */}
      <Route path="/verify-email" element={<VerifyEmail />} />
      {/* An invite can add a role to someone already signed in, so it is open either way. */}
      <Route path="/invite/:token" element={<AcceptInvite />} />
      <Route path="/status" element={<StatusRoute />} />

      <Route element={<RequireAuth />}>
        {AREAS.map((area) =>
          area.items.map((item) => (
            <Route
              key={item.to}
              path={item.to}
              element={
                <RequireRole roles={item.only ?? area.roles}>
                  {pageFor(area, item.key) ?? <Placeholder item={item} />}
                </RequireRole>
              }
            />
          )),
        )}
        <Route path="/account/password" element={<ChangePassword />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ShapeDefs />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

