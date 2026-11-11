import { useEffect, useId, useState } from "react";
import { MAX_ROUNDS, nextRoundTitle, ROUND_KINDS, ROUND_TEMPLATES, ROUND_TYPES, type RoundType } from "@cyrus/shared";
import { Field, SelectField, TextField } from "../../../components/form";
import { scheduleApi, type Round, type SlotNote } from "../../../lib/api";
import { fromLocalInput, renumber, toLocalInput } from "./format";

const blank = (type: RoundType, existing: Round[]): Round => ({
  type,
  title: nextRoundTitle(type, existing),
  mode: type === "OA" ? "ONLINE" : "OFFLINE",
  startsAt: null,
  venue: null,
  onlineLink: null,
  instructions: null,
});

export function RoundBuilder({ rounds, onChange, errors = {}, driveId }: { rounds: Round[]; onChange: (r: Round[]) => void; errors?: Record<string, string>; driveId?: string }) {
  const full = rounds.length >= MAX_ROUNDS;
  const set = (i: number, patch: Partial<Round>) => onChange(rounds.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...rounds];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    onChange(renumber(next));
  };

  return (
    <div className="cy-builder">
      <div className="chips" role="group" aria-label="Add a round">
        <span className="chips-label">Add a round:</span>
        {ROUND_TYPES.map((t) => (
          <button key={t} type="button" className="chip-link" disabled={full} title={ROUND_KINDS[t].hint} onClick={() => onChange([...rounds, blank(t, rounds)])}>
            + {ROUND_KINDS[t].label}
          </button>
        ))}
      </div>
      {full && <p className="field-hint">A drive can have at most {MAX_ROUNDS} rounds.</p>}

      {!rounds.length && (
        <div className="panel cy-templates">
          <p className="cy-h3">No rounds yet. Add them one by one with the buttons above, or start from a common pattern:</p>
          <div className="buttons">
            {ROUND_TEMPLATES.map((t) => (
              <button
                key={t.name}
                type="button"
                className="quiet"
                onClick={() => onChange(t.types.reduce<Round[]>((acc, type) => [...acc, blank(type, acc)], []))}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <ol className="cy-round-cards">
        {rounds.map((r, i) => (
          <RoundCard
            key={r.id ?? `new-${i}-${r.type}`}
            r={r}
            i={i}
            last={i === rounds.length - 1}
            errors={errors}
            driveId={driveId}
            onSet={(p) => set(i, p)}
            onMove={(by) => move(i, by)}
            onRemove={() => onChange(renumber(rounds.filter((_, j) => j !== i)))}
          />
        ))}
      </ol>
    </div>
  );
}

function RoundCard({
  r,
  i,
  last,
  errors,
  driveId,
  onSet,
  onMove,
  onRemove,
}: {
  r: Round;
  i: number;
  last: boolean;
  errors: Record<string, string>;
  driveId?: string;
  onSet: (p: Partial<Round>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const started = r.status != null && r.status !== "SCHEDULED";
  const notesId = useId();
  const err = (f: string) => errors[`rounds.${i}.${f}`];
  const busy = useBusyHint(driveId, r);
  return (
    <li className="panel cy-round-card" aria-label={`Round ${i + 1}: ${r.title || ROUND_KINDS[r.type].label}`}>
      <div className="cy-round-card-head">
        <span className="cy-round-no" aria-hidden="true">
          {i + 1}
        </span>
        <span className="pill">{ROUND_KINDS[r.type].label}</span>
        {started && <span className="stage working fam-azure">Started</span>}
        <div className="cy-round-tools">
          <button type="button" className="quiet" disabled={i === 0} onClick={() => onMove(-1)} aria-label={`Move ${r.title} up`}>
            ↑
          </button>
          <button type="button" className="quiet" disabled={last} onClick={() => onMove(1)} aria-label={`Move ${r.title} down`}>
            ↓
          </button>
          <button type="button" className="quiet" disabled={started} onClick={onRemove} aria-label={`Remove ${r.title}`}>
            Remove
          </button>
        </div>
      </div>
      <div className="form-row">
        <Field label="Round name" size="md" value={r.title} maxLength={80} onChange={(e) => onSet({ title: e.target.value })} error={err("title")} placeholder={ROUND_KINDS[r.type].label} />
        <SelectField label="Where" size="sm" value={r.mode} onChange={(e) => onSet({ mode: e.target.value as Round["mode"] })}>
          <option value="OFFLINE">On campus</option>
          <option value="ONLINE">Online</option>
        </SelectField>
      </div>
      <div className="form-row">
        <Field
          label="Starts"
          size="md"
          optional
          type="datetime-local"
          value={toLocalInput(r.startsAt)}
          onChange={(e) => onSet({ startsAt: fromLocalInput(e.target.value) })}
          error={err("startsAt")}
          hint="Leave empty until it is fixed."
        />
        {r.mode === "OFFLINE" ? (
          <Field label="Venue" size="md" optional value={r.venue ?? ""} maxLength={200} onChange={(e) => onSet({ venue: e.target.value || null })} error={err("venue")} placeholder="e.g. CSE block, Lab 2" />
        ) : (
          <Field
            label="Test or meeting link"
            size="lg"
            optional
            type="url"
            placeholder="https://"
            value={r.onlineLink ?? ""}
            onChange={(e) => onSet({ onlineLink: e.target.value || null })}
            error={err("onlineLink")}
            hint="Only students who joined see it."
          />
        )}
      </div>
      {busy.length > 0 && (
        <div className="rb-busy" role="status">
          <p className="rb-busy-title">Campus is busy at this time</p>
          <ul>
            {busy.map((n, k) => (
              <li key={k} className={`is-${n.severity}`}>
                {n.message}
              </li>
            ))}
          </ul>
          <p className="rb-busy-foot">You can keep it; the placement office sees the same and may ask you to move it.</p>
        </div>
      )}
      <TextField
        id={notesId}
        label="Instructions for students"
        optional
        rows={2}
        maxLength={2000}
        placeholder="e.g. Bring your college ID and a pen."
        value={r.instructions ?? ""}
        onChange={(e) => onSet({ instructions: e.target.value || null })}
      />
    </li>
  );
}

/**
 * While HR picks a round's time and venue: is campus busy then? Asks the API a moment after the time,
 * venue or mode stops changing. Shows nothing until the drive exists and the round has a time.
 */
function useBusyHint(driveId: string | undefined, r: Round): SlotNote[] {
  const [notes, setNotes] = useState<SlotNote[]>([]);
  const key = driveId && r.startsAt ? `${driveId}|${r.startsAt}|${r.mode}|${r.venue ?? ""}|${r.title}` : "";
  useEffect(() => {
    if (!key || !driveId || !r.startsAt) {
      setNotes([]);
      return;
    }
    let gone = false;
    const t = setTimeout(() => {
      scheduleApi.slotCheck(driveId, { title: r.title || "This round", mode: r.mode, startsAt: r.startsAt!, venue: r.mode === "OFFLINE" ? r.venue : null }).then(
        (res) => !gone && setNotes(res.notes),
        () => !gone && setNotes([]),
      );
    }, 500);
    return () => {
      gone = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return notes;
}
