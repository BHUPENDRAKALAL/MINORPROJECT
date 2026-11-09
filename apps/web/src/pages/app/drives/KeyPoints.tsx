import { useId } from "react";
import { INTERVIEW_CRITERIA, RATING_LABELS, RESULT_LABELS, type Criterion } from "@cyrus/shared";
import type { EarlierRound, KeyPoints, Recommendation } from "../../../lib/api";

const REC_LABEL: Record<Recommendation, string> = { SELECT: "Select", REJECT: "Reject", HOLD: "Hold" };
const REC_TONE: Record<Recommendation, string> = { SELECT: "done fam-lime", REJECT: "stuck fam-ember", HOLD: "waiting fam-sun" };

export function RecommendationChip({ rec }: { rec: Recommendation }) {
  return <span className={`stage ${REC_TONE[rec]}`}>{REC_LABEL[rec]}</span>;
}

/** One row per criterion with five buttons (1 Poor … 5 Excellent). Click a chosen score again to clear it. */
export function RatingInput({ criteria, value, onChange }: { criteria: Criterion[]; value: Record<string, number>; onChange: (v: Record<string, number>) => void }) {
  const legend = useId();
  if (!criteria.length) return null;
  return (
    <fieldset className="cy-fieldset cy-ratings" aria-labelledby={legend}>
      <legend id={legend}>Ratings (1 = poor, 5 = excellent)</legend>
      {criteria.map((c) => (
        <div key={c.key} className="cy-rating-row" role="radiogroup" aria-label={c.label}>
          <span className="cy-rating-name">{c.label}</span>
          <span className="cy-rating-dots">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={value[c.key] === n}
                aria-label={`${c.label}: ${n} ${RATING_LABELS[n]}`}
                title={RATING_LABELS[n]}
                className={`cy-dot${value[c.key] !== undefined && n <= value[c.key]! ? " is-on" : ""}`}
                onClick={() => {
                  const next = { ...value };
                  if (next[c.key] === n) delete next[c.key];
                  else next[c.key] = n;
                  onChange(next);
                }}
              >
                {n}
              </button>
            ))}
          </span>
          <span className="faint small cy-rating-word">{value[c.key] ? RATING_LABELS[value[c.key]!] : "Not rated"}</span>
        </div>
      ))}
    </fieldset>
  );
}

/** Every criterion's label, in a stable order (the order they appear across round kinds). */
const ALL_CRITERIA: Criterion[] = Object.values(INTERVIEW_CRITERIA)
  .flat()
  .filter((c, i, all) => all.findIndex((x) => x.key === c.key) === i);

/** Ratings, strengths, concerns and notes of one finished interview, read-only. */
export function KeyPointsSummary({ k, criteria, label: heading }: { k: KeyPoints; criteria?: Criterion[]; label?: string }) {
  const order = [...(criteria ?? []), ...ALL_CRITERIA];
  const label = (key: string) => order.find((c) => c.key === key)?.label ?? key.replace(/_/g, " ");
  const rank = (key: string) => {
    const i = order.findIndex((c) => c.key === key);
    return i < 0 ? 999 : i;
  };
  const ratings = Object.entries(k.ratings ?? {}).sort(([a], [b]) => rank(a) - rank(b));
  return (
    <div className="cy-kp">
      <p className="cy-kp-head">
        {heading && <strong>{heading}</strong>}
        {k.recommendation && <RecommendationChip rec={k.recommendation} />}
        {k.average != null && <span className="pill">Avg {k.average.toFixed(1)} / 5</span>}
      </p>
      {ratings.length > 0 && (
        <ul className="cy-kp-ratings">
          {ratings.map(([key, n]) => (
            <li key={key}>
              <span>{label(key)}</span>
              <span className="cy-bar" aria-label={`${n} of 5`}>
                <span style={{ width: `${(n / 5) * 100}%` }} />
              </span>
              <span className="small">{n}</span>
            </li>
          ))}
        </ul>
      )}
      {k.strengths.length > 0 && (
        <div className="small">
          <span className="cy-kp-label cy-kp-good">Strengths</span>
          <ul className="cy-list">{k.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
      {k.concerns.length > 0 && (
        <div className="small">
          <span className="cy-kp-label cy-kp-bad">Concerns</span>
          <ul className="cy-list">{k.concerns.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
      {k.privateNotes && <p className="small cy-pre">{k.privateNotes}</p>}
    </div>
  );
}

const RESULT_TONE = { SELECTED: "done fam-lime", REJECTED: "stuck fam-ember", ON_HOLD: "waiting fam-sun", PENDING: "idle" } as const;

/** Everything earlier rounds say about a student: for the interviewer before and during the interview. */
export function EarlierRounds({ history }: { history: EarlierRound[] }) {
  if (!history.length) return null;
  return (
    <details className="cy-earlier" open>
      <summary>Earlier rounds ({history.length})</summary>
      <ol className="cy-earlier-list">
        {history.map((r) => (
          <li key={r.roundId}>
            <p className="cy-kp-head">
              <strong>{r.title}</strong>
              {r.result ? <span className={`stage ${RESULT_TONE[r.result]}`}>{RESULT_LABELS[r.result]}</span> : <span className="stage idle">No result</span>}
              {r.attended && <span className="stage done">Checked in</span>}
            </p>
            {r.interviews.length === 0 ? (
              <p className="faint small">No interview notes for this round.</p>
            ) : (
              r.interviews.map((iv, i) => <KeyPointsSummary key={i} k={iv} label={`${iv.panel}${iv.interviewer ? ` · ${iv.interviewer}` : ""}`} />)
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
