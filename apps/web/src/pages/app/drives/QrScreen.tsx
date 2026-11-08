import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { roundsApi } from "../../../lib/api";

/**
 * The rotating check-in QR. It asks the API for the current code every few seconds (the code itself
 * changes every QR_WINDOW_SECONDS). "Full screen" fills the window for a projector at the venue.
 */
export function QrScreen({
  sessionId,
  title,
  total,
  located,
  onClose,
  onArrivals,
}: {
  sessionId: string;
  title: string;
  total: number;
  located: boolean;
  onClose: () => void;
  /** Called when the checked-in count goes up, so the page can refresh its list. */
  onArrivals?: () => void;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [present, setPresent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const arrivals = useRef(onArrivals);
  useEffect(() => {
    arrivals.current = onArrivals;
  }, [onArrivals]);

  useEffect(() => {
    let stop = false;
    let last = "";
    let seen = -1;
    const tick = async () => {
      try {
        const q = await roundsApi.qr(sessionId);
        if (stop) return;
        setPresent(q.present);
        if (seen >= 0 && q.present > seen) arrivals.current?.();
        seen = q.present;
        setError(null);
        if (q.url !== last) {
          last = q.url;
          setUrl(q.url);
          setSvg(await QRCode.toString(q.url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }));
        }
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [sessionId]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const body = (
    <>
      <div className="cy-qr" role="img" aria-label="Check-in QR code" data-url={url ?? undefined} dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />
      <p className="cy-qr-count" role="status">
        <strong>{present}</strong> of {total} checked in
      </p>
    </>
  );

  if (full) {
    return (
      <div className="cy-qr-full" role="dialog" aria-label="Check-in screen">
        <p className="cy-qr-title">{title}</p>
        <p className="cy-qr-hint">Scan with your phone camera to check in{located ? " (you need to be at the venue)" : ""}</p>
        {body}
        <button type="button" className="quiet" onClick={() => setFull(false)}>
          Exit full screen (Esc)
        </button>
      </div>
    );
  }

  return (
    <div className="panel cy-qr-panel">
      {body}
      {error && <p className="field-error">{error}</p>}
      <p className="faint small">{located ? "Students must be near the venue to check in." : "Anyone in the round with the code can check in (no location check)."}</p>
      <div className="buttons">
        <button type="button" className="primary" onClick={() => setFull(true)}>
          Full screen for the venue
        </button>
        <button type="button" onClick={() => window.confirm("Close check-in? Students who haven't checked in will count as absent unless marked by hand.") && onClose()}>
          Close check-in
        </button>
      </div>
    </div>
  );
}
