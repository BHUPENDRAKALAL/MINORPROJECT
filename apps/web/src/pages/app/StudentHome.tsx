// Adapted from Foundry (Apache-2.0), see src/vendor/foundry/LICENSE
// The overview's hero (overview.html): one loud panel with a cut-out, and the figures in a bar over it.
import { Link } from "react-router";
import { useAuth } from "../../app/useAuth";
import { CutOut, EmptyState, Icon, Sprite } from "../../components/ui";
import type { StudentStatus } from "../../lib/api";
import { useTitle } from "../../lib/useTitle";

const STATUS: Record<StudentStatus, { label: string; note: string; tone: string; family: "lime" | "sun" | "orchid" | "ember" }> = {
  PROFILE_INCOMPLETE: {
    label: "Profile incomplete",
    note: "Add your academic details and documents. The placement office checks them before you can apply to drives.",
    tone: "waiting",
    family: "sun",
  },
  PENDING_VERIFICATION: {
    label: "Waiting for verification",
    note: "The placement office is checking your details. We'll let you know when it's done.",
    tone: "working",
    family: "orchid",
  },
  VERIFIED: {
    label: "Verified",
    note: "Your profile is verified. Drives you are eligible for will appear under Drives.",
    tone: "done",
    family: "lime",
  },
  REJECTED: {
    label: "Needs changes",
    note: "The placement office asked for changes to your profile. Open it to see what to fix.",
    tone: "stuck",
    family: "ember",
  },
};

function Figure({ label, value, to }: { label: string; value: string; to: string }) {
  return (
    <div className="figure">
      <dt>{label}</dt>
      <dd>{value}</dd>
      <dd className="figure-go">
        <Link to={to}>
          <span className="hidden">Open {label}</span>
          <span className="go" aria-hidden="true" />
        </Link>
      </dd>
    </div>
  );
}

export default function StudentHome() {
  const { me } = useAuth();
  useTitle("Home");
  if (!me) return null;
  const first = (me.name ?? "").split(" ")[0] || "there";
  const s = me.student;

  if (!s) {
    return (
      <>
        <header className="page-head">
          <h1 className="title">Home</h1>
        </header>
        <EmptyState sprite="ask" family="sun">
          Your account has no student record yet. If you think this is wrong, contact the placement office.
        </EmptyState>
      </>
    );
  }

  const st = STATUS[s.status] ?? STATUS.PROFILE_INCOMPLETE;
  const incomplete = s.status === "PROFILE_INCOMPLETE" || s.status === "REJECTED";

  return (
    <>
      <header className="page-head">
        <h1 className="title">Home</h1>
      </header>

      <div className="hero">
        <CutOut family={st.family === "orchid" ? "orchid" : st.family} />
        <Sprite name={incomplete ? "ask" : s.placementStatus === "PLACED" ? "cheer" : "smith"} size={96} plays />
        <div className="hero-words">
          <h2>Hi {first}!</h2>
          <p className="hero-note">
            <span className={`stage ${st.tone}`}>{st.label}</span>
          </p>
          <p className="hero-note">{st.note}</p>
          {incomplete && (
            <p className="buttons hero-cta">
              <Link className="button primary" to="/student/profile">
                Complete your profile <Icon name="go" />
              </Link>
            </p>
          )}
        </div>
        <div className="hero-bar">
          <dl className="figures">
            <Figure label="Roll number" value={s.rollNo} to="/student/profile" />
            <Figure label="Branch" value={s.branch} to="/student/profile" />
            <Figure label="Batch" value={String(s.batch)} to="/student/profile" />
            <Figure label="Placement" value={s.placementStatus === "PLACED" ? "Placed" : "Not yet"} to="/student/drives" />
          </dl>
          <Link className="hero-go" to="/student/drives">
            See the drives <Icon name="go" />
          </Link>
        </div>
      </div>

      <section>
        <div className="section-head">
          <h2>What's next</h2>
        </div>
        <ul className="rows next-steps">
          <li className={incomplete ? "" : "is-done"}>
            <span className={`stage ${incomplete ? "waiting" : "done"}`}>{incomplete ? "To do" : "Done"}</span>
            <span>Complete your profile: marks, documents and resume.</span>
          </li>
          <li>
            <span className={`stage ${s.status === "VERIFIED" ? "done" : "idle"}`}>{s.status === "VERIFIED" ? "Done" : "Later"}</span>
            <span>The placement office verifies your details.</span>
          </li>
          <li>
            <span className="stage idle">Later</span>
            <span>Opt in to drives you are eligible for and follow each round here.</span>
          </li>
        </ul>
      </section>
    </>
  );
}
