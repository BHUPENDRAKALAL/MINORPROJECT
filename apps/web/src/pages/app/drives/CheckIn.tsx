import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Alert, EmptyState, Sticker } from "../../../components/ui";
import { ApiError, roundsApi, type CheckInResult } from "../../../lib/api";
import { useTitle } from "../../../lib/useTitle";

/** Where the venue QR code leads: checks the student in, with their location when the venue asks for it. */
export default function CheckIn() {
  useTitle("Check in");
  const [params] = useSearchParams();
  const token = params.get("t") ?? "";
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [done, setDone] = useState<CheckInResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    const send = async (pos?: { lat: number; lng: number }) => {
      try {
        setDone(await roundsApi.checkIn({ token, ...(pos ?? {}) }));
        setState("done");
      } catch (e) {
        // The venue wants a location and the browser didn't give one yet: ask, then try again.
        if (e instanceof ApiError && e.code === "LOCATION_NEEDED" && !pos) return locate(true);
        setError(e instanceof ApiError ? e.message : "Couldn't check you in. Try scanning again.");
        setState("failed");
      }
    };
    const locate = (needed: boolean) => {
      if (!navigator.geolocation) return needed ? fail("This browser can't share your location. Ask the coordinator to mark you by hand.") : void send();
      navigator.geolocation.getCurrentPosition(
        (p) => void send({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => (needed ? fail("Allow location access for this site, then scan the code again. The venue needs to know you're there.") : void send()),
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
      );
    };
    const fail = (m: string) => (setError(m), setState("failed"));
    // Try with the location straight away; most venues ask for it.
    locate(false);
  }, [token]);

  if (!token) {
    return (
      <EmptyState sprite="ask" family="sun" action={{ to: "/student/drives", label: "My drives" }}>
        Scan the QR code shown at the venue with your phone camera to check in.
      </EmptyState>
    );
  }

  return (
    <div className="panel stack cy-wide cy-checkin">
      {state === "working" && (
        <>
          <Sticker name="working" size={96} />
          <h1 className="title">Checking you in…</h1>
          <p className="faint">If your browser asks to use your location, allow it.</p>
        </>
      )}
      {state === "done" && done && (
        <>
          <Sticker name="approved" size={96} />
          <h1 className="title">{done.alreadyCheckedIn ? "You're already checked in" : "You're checked in"}</h1>
          <p>
            {done.company} · {done.roleTitle}: <strong>{done.round}</strong>
          </p>
          <p className="buttons">
            <Link className="button primary" to={`/student/drives/${done.driveId}`}>
              Open the drive
            </Link>
          </p>
        </>
      )}
      {state === "failed" && (
        <>
          <Sticker name="blocked" size={96} />
          <h1 className="title">Not checked in</h1>
          <Alert>{error}</Alert>
          <p className="faint small">Scan the code on the screen again. If it keeps failing, the coordinator can mark you present by hand.</p>
        </>
      )}
    </div>
  );
}
