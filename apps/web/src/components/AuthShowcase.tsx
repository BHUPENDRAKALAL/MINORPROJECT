import { useEffect, useRef, useState } from "react";

const ROUNDS = ["Online test", "Technical", "Interview", "HR"];
const NOTES = [
  { title: "Your turn", body: "Go to Room 204 now. Panel A is ready for you." },
  { title: "You're selected", body: "You cleared every round of Software Engineer." },
  { title: "Offer received", body: "Northwind Systems · ₹12 LPA. Answer by Fri." },
];
// One loop of the story, in steps: 0 invite, 1 joined, 2–5 rounds fill, 6–8 notices, then start again.
const STEPS = 10;
const STEP_MS = 1300;

/**
 * The quiet "what Cyrus does" preview on the sign-in pages' art panel: an invite gets joined, the rounds fill in,
 * and the notices a student gets arrive one by one. Decorative (hidden from screen readers). The cards drift a
 * little with the pointer. For people who prefer reduced motion it shows the finished story and stays still.
 */
export function AuthShowcase() {
  // matchMedia is missing in some test environments; treat that as "motion is fine".
  const still = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [step, setStep] = useState(still ? STEPS - 1 : 0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (still) return;
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS), STEP_MS);
    return () => clearInterval(t);
  }, [still]);

  // A little depth: the cards move a few pixels against the pointer, smoothed.
  useEffect(() => {
    const el = root.current;
    if (!el || still) return;
    const target = { x: 0, y: 0 };
    const pos = { x: 0, y: 0 };
    let frame = 0;
    const tick = () => {
      pos.x += (target.x - pos.x) * 0.08;
      pos.y += (target.y - pos.y) * 0.08;
      el.style.setProperty("--px", pos.x.toFixed(3));
      el.style.setProperty("--py", pos.y.toFixed(3));
      frame = Math.abs(target.x - pos.x) + Math.abs(target.y - pos.y) > 0.002 ? requestAnimationFrame(tick) : 0;
    };
    const onMove = (e: PointerEvent) => {
      target.x = e.clientX / window.innerWidth - 0.5;
      target.y = e.clientY / window.innerHeight - 0.5;
      if (!frame) frame = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, [still]);

  const joined = step >= 1;
  const roundsDone = Math.max(0, Math.min(ROUNDS.length, step - 1));
  const noteIndex = step >= 6 ? Math.min(NOTES.length - 1, step - 6) : -1;

  return (
    <div className="sc" ref={root} aria-hidden="true">
      <div className="sc-card sc-invite">
        <div className="sc-row">
          <span className="sc-logo">N</span>
          <span className="sc-text">
            <span className="sc-title">Software Engineer</span>
            <span className="sc-sub">Northwind Systems · ₹12 LPA · Jaipur</span>
          </span>
        </div>
        <div className="sc-row sc-foot">
          <span className="sc-sub">{joined ? "You're in this drive" : "Join by Sat, 6:00 pm"}</span>
          <span className={`sc-btn${joined ? " is-done" : ""}${step === 0 ? " is-pressing" : ""}`}>
            {joined ? (
              <>
                <svg viewBox="0 0 16 16" width="12" height="12">
                  <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Joined
              </>
            ) : (
              "Join"
            )}
          </span>
        </div>
      </div>

      <div className="sc-card sc-rounds">
        <p className="sc-label">Rounds</p>
        <ol className="sc-steps">
          {ROUNDS.map((r, i) => (
            <li key={r} className={i < roundsDone ? "is-done" : i === roundsDone && joined ? "is-now" : ""}>
              <span className="sc-dot" />
              <span>{r}</span>
            </li>
          ))}
        </ol>
        <div className="sc-track">
          <span style={{ width: `${(roundsDone / ROUNDS.length) * 100}%` }} />
        </div>
      </div>

      <div className="sc-notes">
        {NOTES.map((n, i) => (
          <div key={n.title} className={`sc-card sc-note${i <= noteIndex ? " is-in" : ""}${i < noteIndex ? " is-under" : ""}`} style={{ ["--i" as string]: noteIndex - i }}>
            <span className={`sc-note-dot${i === 2 ? " is-offer" : ""}`} />
            <span className="sc-text">
              <span className="sc-title">{n.title}</span>
              <span className="sc-sub">{n.body}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
