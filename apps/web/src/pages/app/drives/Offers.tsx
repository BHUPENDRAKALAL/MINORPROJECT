import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { useApiForm } from "../../../components/useApiForm";
import { Alert, Saved } from "../../../components/ui";
import { filesApi, offersApi, type OfferView, type OffersList } from "../../../lib/api";
import { fromLocalInput, openLink, when } from "./format";

const STATUS: Record<OfferView["status"], [string, string]> = {
  SENT: ["Waiting for the student", "waiting fam-sun"],
  ACCEPTED: ["Accepted", "done fam-lime"],
  DECLINED: ["Declined", "stuck fam-ember"],
  EXPIRED: ["No answer in time", "idle"],
  REVOKED: ["Withdrawn", "idle"],
};

export function OfferChip({ status, forStudent = false }: { status: OfferView["status"]; forStudent?: boolean }) {
  const [label, tone] = forStudent && status === "SENT" ? ["Waiting for your answer", STATUS.SENT[1]] : STATUS[status];
  return <span className={`stage ${tone}`}>{label}</span>;
}

/** HR and the TPO: selected students, sending each one's offer letter, and what they answered. */
export function OffersTab({ driveId }: { driveId: string }) {
  const [data, setData] = useState<OffersList | null>(null);
  const [joining, setJoining] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const form = useApiForm();
  const run = form.run;
  const load = useCallback(() => void run(async () => setData(await offersApi.list(driveId))), [driveId, run]);
  useEffect(load, [load]);

  if (!data) return form.error ? <Alert>{form.error}</Alert> : null;

  async function upload(participationId: string, name: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await form.run(async () => {
      setMsg(null);
      const up = await filesApi.upload("OFFER_LETTER", file);
      setData(await offersApi.send(driveId, { participationId, fileId: up.id, joiningDate: joining[participationId] ? fromLocalInput(joining[participationId]!) : null }));
      setMsg(`Offer letter sent to ${name}. They have ${data!.responseDays} days to answer.`);
    });
  }

  return (
    <div className="stack">
      {form.error && <Alert>{form.error}</Alert>}
      {msg && <Saved>{msg}</Saved>}
      {!data.selected.length ? (
        <p className="faint">No one is selected yet. Offers are sent after the last round's results are published.</p>
      ) : (
        <>
          <p className="faint small">
            Upload each selected student's offer letter as a PDF. Only that student, the placement office and your company's HR can open it. Students answer within {data.responseDays} days;
            accepting marks them placed.
          </p>
          <div className="scroll">
            <table className="cy-table">
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Offer</th>
                  <th scope="col">Answer by</th>
                  <th scope="col">
                    <span className="hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.selected.map((s) => {
                  const o = s.offer && s.offer.status !== "REVOKED" ? s.offer : null;
                  const canSend = data.canSend && (!o || o.status === "SENT");
                  return (
                    <tr key={s.participationId}>
                      <td>
                        {s.student.name}
                        <br />
                        <span className="faint small">
                          {s.student.rollNo} · {s.student.branch} {s.student.batch}
                        </span>
                      </td>
                      <td>
                        {o ? (
                          <>
                            <OfferChip status={o.status} />
                            <br />
                            <span className="faint small">{o.fileName}</span>
                          </>
                        ) : (
                          <span className="stage idle">{s.offer?.status === "REVOKED" ? "Withdrawn, not sent again" : "Not sent"}</span>
                        )}
                      </td>
                      <td className="small">{o ? (o.respondedAt ? `Answered ${when(o.respondedAt)}` : when(o.respondBy)) : "—"}</td>
                      <td>
                        <span className="cy-att">
                          {canSend && (
                            <>
                              {!o && (
                                <label className="faint small cy-date-label">
                                  Joining date (optional)
                                  <input
                                  type="date"
                                  aria-label={`Joining date for ${s.student.name}`}
                                  className="cy-date"
                                  value={(joining[s.participationId] ?? "").slice(0, 10)}
                                  onChange={(e) => setJoining((j) => ({ ...j, [s.participationId]: e.target.value ? `${e.target.value}T10:00` : "" }))}
                                  />
                                </label>
                              )}
                              <label className="button quiet cy-file-button">
                                {o ? "Replace letter" : "Upload offer letter"}
                                <input type="file" accept="application/pdf" hidden aria-label={`Offer letter for ${s.student.name}`} onChange={(e) => void upload(s.participationId, s.student.name, e)} />
                              </label>
                            </>
                          )}
                          {o && (
                            <button type="button" className="quiet" onClick={() => void form.run(() => openLink(() => offersApi.letter(o.id)))}>
                              View letter
                            </button>
                          )}
                          {o?.status === "SENT" && (
                            <button
                              type="button"
                              className="quiet"
                              onClick={() => {
                                const reason = window.prompt(`Why withdraw ${s.student.name}'s offer? They will see this.`);
                                if (reason && reason.trim().length >= 5) void form.run(async () => setData(await offersApi.revoke(o.id, reason.trim())));
                              }}
                            >
                              Withdraw
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
