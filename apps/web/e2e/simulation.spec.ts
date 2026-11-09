/**
 * A full live drive with many people signed in at the same time (run on demand):
 *
 *   SIM=1 pnpm --filter @cyrus/web exec playwright test e2e/simulation.spec.ts
 *
 * HR, two interviewers (the second one invited by HR during the run), the TPO and four students,
 * each in their own browser session. Uses the demo drive "Northwind Systems · Software Engineer"
 * (OA → Technical 1 → Technical 2 → Interview round 1 → HR round). Screenshots of every step go to
 * .review/sim-*.png (git-ignored).
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { demo, freshEmail, latestEmail, signIn } from "./helpers";

test.skip(!process.env.SIM, "Run with SIM=1");
test.setTimeout(15 * 60_000);
// A click that can't happen fails within 20 s instead of waiting for the whole test timeout.
test.use({ actionTimeout: 20_000 });

let shotNo = 0;
async function shot(p: Page, name: string) {
  await p.waitForTimeout(700);
  shotNo += 1;
  await p.screenshot({ path: `.review/sim-${String(shotNo).padStart(2, "0")}-${name}.png`, fullPage: true });
}

/** A signed-in browser session for one person. */
async function person(browser: Browser, email: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => void d.accept());
  await signIn(page, email);
  return page;
}

/** Open the drive page as a student and return it (fresh data). */
async function openDrive(p: Page) {
  await p.goto("/student/drives");
  await p.getByRole("link", { name: /Software Engineer/ }).first().click();
  await expect(p.getByRole("heading", { name: "Rounds" })).toBeVisible();
}

/** The student's lines under one round in the timeline. */
const roundItem = (p: Page, title: string) => p.locator(".cy-round-item", { has: p.getByText(title, { exact: true }) });

/** The office drive page, then one of its rounds. */
async function openRound(p: Page, title: string) {
  await p.goto("/company");
  await p.getByRole("link", { name: /Software Engineer/ }).click();
  await p.getByRole("link", { name: title, exact: true }).click();
  await expect(p.getByRole("heading", { name: title })).toBeVisible();
}

test("live drive simulation: every role at once", async ({ browser, request }) => {
  // ───────────────────── people ─────────────────────
  const [hr, tpo, aman, isha, pooja, karan] = await Promise.all([
    person(browser, demo("hr")),
    person(browser, demo("tpo")),
    person(browser, demo("verified.student")),
    person(browser, demo("isha.quiet")),
    person(browser, demo("pooja.quiet")),
    person(browser, demo("karan.quiet")),
  ]);
  const students = { aman, isha, pooja, karan };

  // HR invites a second interviewer, who accepts from the email
  const iv2Email = freshEmail("iv2");
  await hr.goto("/company/team");
  await hr.getByLabel("Email").fill(iv2Email);
  await hr.getByRole("button", { name: "Send invite" }).click();
  await expect(hr.getByText(`Invite sent to ${iv2Email}`)).toBeVisible();
  const mail = await latestEmail(request, iv2Email, "invited");
  const ivCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const iv2 = await ivCtx.newPage();
  await iv2.goto(mail.text.match(/http:\/\/localhost:5173(\/invite\/\S+)/)![1]!);
  await iv2.getByLabel("Full name").fill("Second Interviewer");
  await iv2.getByLabel("Choose a password").fill("second-iv-pass-1");
  await iv2.getByLabel("Type it again").fill("second-iv-pass-1");
  await iv2.getByRole("button", { name: "Accept invite" }).click();
  await expect(iv2.getByRole("heading", { name: "My panels" })).toBeVisible();
  const iv1 = await person(browser, demo("interviewer"));

  // ───────────────────── invites and joining, all students at once ─────────────────────
  await hr.goto("/company");
  await hr.getByRole("link", { name: /Software Engineer/ }).click();
  await hr.getByRole("link", { name: "Students", exact: false }).first().click();
  const inviteAll = hr.getByRole("button", { name: /Invite all \d+ eligible/ });
  await expect(inviteAll.or(hr.getByText("Everyone who matches is already invited."))).toBeVisible();
  if (await inviteAll.isVisible()) {
    await inviteAll.click();
    await expect(hr.getByText(/Invited \d+ students?\./)).toBeVisible();
  }
  await Promise.all(
    Object.values(students).map(async (s) => {
      await openDrive(s);
      const join = s.getByRole("button", { name: "Join the drive" });
      if (await join.isVisible()) {
        await s.getByLabel(/I agree to share my profile/).check();
        await join.click();
      }
      await expect(s.getByText("You've joined this drive")).toBeVisible();
    }),
  );
  await shot(aman, "student-joined");

  // ───────────────────── Round 1: OA, CSV results (Karan doesn't qualify) ─────────────────────
  await openRound(hr, "Online assessment");
  await hr.getByRole("button", { name: "Start the round" }).click();
  await expect(hr.getByText("Round started. Students have been told.")).toBeVisible();
  await hr.locator('input[type="file"]').setInputFiles({
    name: "oa.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Roll Number,Result\n24UIT9104,Pass\n24UCSE9201,Pass\n24UIT9203,Pass\n24UCSE9202,Fail\n"),
  });
  await expect(hr.getByText(/Imported 4 results/)).toBeVisible();
  await hr.getByRole("button", { name: "Publish results" }).click();
  await expect(hr.getByText("Results published. Everyone has been told.")).toBeVisible();

  await Promise.all([
    (async () => {
      await openDrive(karan);
      await expect(karan.getByText("You're out of this drive")).toBeVisible();
      await expect(roundItem(karan, "Online assessment").getByText("Not selected")).toBeVisible();
      await shot(karan, "karan-out-after-oa");
    })(),
    ...[aman, isha, pooja].map(async (s) => {
      await openDrive(s);
      await expect(roundItem(s, "Online assessment").getByText("You cleared this round")).toBeVisible();
    }),
  ]);

  // ───────────────────── Round 2: Technical 1, QR check-in by three phones at once ─────────────────────
  await openRound(hr, "Technical round 1");
  await hr.getByRole("button", { name: "Start the round" }).click();
  await hr.getByLabel(/Only allow check-in near where I am/).uncheck();
  await hr.getByRole("button", { name: "Open check-in" }).click();
  const qr = hr.getByRole("img", { name: "Check-in QR code" });
  await expect(qr.locator("svg")).toBeVisible();
  const url = new URL((await qr.getAttribute("data-url"))!);
  // Students see the check-in prompt on their drive page
  await openDrive(pooja);
  await expect(pooja.getByText("Check-in is open: scan the QR code at the venue").first()).toBeVisible();
  await Promise.all(
    [aman, isha, pooja].map(async (s) => {
      await s.goto(url.pathname + url.search);
      await expect(s.getByRole("heading", { name: "You're checked in" })).toBeVisible();
    }),
  );
  // Karan (out of the drive) can't check in with the same code
  await karan.goto(url.pathname + url.search);
  await expect(karan.getByText("You aren't in this round, so you can't check in.")).toBeVisible();
  await expect(hr.locator(".cy-qr-count")).toContainText("3 of 3 checked in", { timeout: 15_000 });
  await shot(hr, "tech1-checkin-3-of-3");
  await hr.getByRole("button", { name: "Close check-in" }).click();
  await hr.reload();
  await hr.getByRole("button", { name: "Mark the rest selected" }).click();
  await hr.getByRole("button", { name: /Save 3 changes/ }).click();
  await hr.getByRole("button", { name: "Publish results" }).click();
  await expect(hr.getByText("Results published. Everyone has been told.")).toBeVisible();

  // ───────────────────── Round 3: Technical 2 (no check-in, results by hand) ─────────────────────
  await openRound(hr, "Technical round 2");
  await hr.getByRole("button", { name: "Start the round" }).click();
  // Technical rounds can have panels too
  await expect(hr.getByRole("heading", { name: "Interview panels" })).toBeVisible();
  await hr.getByRole("button", { name: "Mark the rest selected" }).click();
  await hr.getByRole("button", { name: /Save 3 changes/ }).click();
  await hr.getByRole("button", { name: "Publish results" }).click();
  await expect(hr.getByText("Results published. Everyone has been told.")).toBeVisible();

  // ───────────────────── Round 4: Interview, two panels running at the same time ─────────────────────
  await openRound(hr, "Interview round 1");
  await hr.getByRole("button", { name: "Start the round" }).click();
  await hr.getByLabel("Panel name").fill("Panel A");
  await hr.getByLabel("Room").fill("Room 101");
  await hr.locator(".cy-add-panel").getByLabel(/Demo Interviewer/).check();
  await hr.getByRole("button", { name: "Add panel" }).click();
  await expect(hr.locator(".cy-card", { hasText: "Panel A" })).toBeVisible();
  await hr.getByLabel("Panel name").fill("Panel B");
  await hr.getByLabel("Room").fill("Room 102");
  await hr.locator(".cy-add-panel").getByLabel(/Second Interviewer/).check();
  await hr.getByRole("button", { name: "Add panel" }).click();
  await expect(hr.locator(".cy-card", { hasText: "Panel B" })).toBeVisible();
  await hr.getByRole("button", { name: "Make the interview lines" }).click();
  await expect(hr.getByText("Added 3 students to the lines.")).toBeVisible();
  await shot(hr, "interview-panels-ready");

  // Each interviewer sees only their own panel
  for (const [iv, mine, other] of [
    [iv1, "Panel A", "Panel B"],
    [iv2, "Panel B", "Panel A"],
  ] as const) {
    await iv.goto("/interviewer");
    await expect(iv.getByRole("link", { name: new RegExp(mine) })).toBeVisible();
    await expect(iv.getByRole("link", { name: new RegExp(other) })).toHaveCount(0);
    await iv.getByRole("link", { name: new RegExp(mine) }).click();
    await expect(iv.getByRole("heading", { name: new RegExp(mine) })).toBeVisible();
  }

  // Lines (roll-number order, shortest line first): Panel A = Isha, Pooja; Panel B = Aman
  await Promise.all([aman, isha, pooja].map(openDrive));
  await expect(roundItem(isha, "Interview round 1").getByText(/number 1 in line for Panel A \(Room 101\)/)).toBeVisible();
  await expect(roundItem(pooja, "Interview round 1").getByText(/number 2 in line for Panel A \(Room 101\), about 15 min/)).toBeVisible();
  await expect(roundItem(aman, "Interview round 1").getByText(/number 1 in line for Panel B \(Room 102\)/)).toBeVisible();
  await shot(pooja, "pooja-number-2-in-line");

  // A double click on "Call next" (two requests at the same moment) calls only one student
  const statuses = await iv1.evaluate(async () => {
    const { accessToken } = await (await fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" })).json();
    const panelId = location.pathname.split("/").pop();
    const call = () => fetch(`/api/v1/panels/${panelId}/call-next`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` } }).then((r) => r.status);
    return (await Promise.all([call(), call()])).sort();
  });
  expect(statuses).toEqual([200, 409]);
  await iv1.reload();
  const curA = iv1.getByRole("region", { name: "Current student" });
  await expect(curA.getByText("Isha Verma")).toBeVisible();

  // What the interviewer has to work with when a student is called and in the room
  await expect(curA.getByRole("button", { name: "They're here: start" })).toBeVisible();
  await expect(curA.getByRole("button", { name: /Not here: skip/ })).toBeVisible();

  // Isha is told it's her turn; Pooja moves to number 1 of the waiting line... after Isha
  await isha.reload();
  await expect(roundItem(isha, "Interview round 1").getByText("Your turn: go to Room 101 now")).toBeVisible();
  await shot(isha, "isha-your-turn");

  // Isha isn't there: skip → end of the line; Pooja is next
  await curA.getByRole("button", { name: /Not here: skip/ }).click();
  await isha.reload();
  await expect(roundItem(isha, "Interview round 1").getByText(/number 2 in line for Panel A/)).toBeVisible();

  // Both panels interview at the same time
  type KP = { ratings?: Record<string, number>; strengths?: string[]; concerns?: string[] };
  async function interview(iv: Page, name: string, notes: string, rec: "Select" | "Hold" | "Reject", remark: string, screenshotName?: string, kp: KP = {}) {
    const cur = iv.getByRole("region", { name: "Current student" });
    const callNext = iv.getByRole("button", { name: "Call next" });
    // Either someone is already called, or the panel is free: wait until the page shows which.
    await expect(cur.or(callNext)).toBeVisible();
    if (await callNext.isVisible()) await callNext.click();
    await expect(cur.getByText(name)).toBeVisible();
    // Start, unless the interview is already running
    const start = cur.getByRole("button", { name: "They're here: start" });
    await expect(start.or(cur.getByText(/In interview ·/))).toBeVisible();
    if (await start.isVisible()) await start.click();
    await expect(cur.getByText(/In interview ·/)).toBeVisible();
    // The interviewer's fields: ratings per criterion, strengths, concerns, private notes, a recommendation, a remark for the student
    await expect(cur.getByText("Ratings (1 = poor, 5 = excellent)")).toBeVisible();
    await expect(cur.getByLabel("Strengths (one per line)")).toBeVisible();
    await expect(cur.getByLabel("Concerns (one per line)")).toBeVisible();
    await expect(cur.getByLabel(/Private notes \(the company and the TPO only\)/)).toBeVisible();
    for (const [label, n] of Object.entries(kp.ratings ?? {})) await cur.getByRole("radio", { name: new RegExp(`^${label}: ${n} `) }).click();
    if (kp.strengths) await cur.getByLabel("Strengths (one per line)").fill(kp.strengths.join("\n"));
    if (kp.concerns) await cur.getByLabel("Concerns (one per line)").fill(kp.concerns.join("\n"));
    await expect(cur.getByRole("group", { name: "Your recommendation" })).toBeVisible();
    await expect(cur.getByLabel(/Remark for the student/)).toBeVisible();
    await cur.getByLabel(/Private notes/).fill(notes);
    await cur.getByLabel(rec, { exact: true }).check();
    await cur.getByLabel(/Remark for the student/).fill(remark);
    if (screenshotName) await shot(iv, screenshotName);
    await cur.getByRole("button", { name: "End interview" }).click();
    await expect(cur).toHaveCount(0);
  }

  await Promise.all([
    (async () => {
      // Panel A: Pooja, then Isha (back from the end of the line)
      await interview(iv1, "Pooja Nair", "Struggled with recursion. Communication fine.", "Reject", "Revise recursion and tree problems.", undefined, {
        ratings: { "Technical knowledge": 2, "Problem solving": 2, Communication: 4, Confidence: 3 },
        strengths: ["Explains clearly"],
        concerns: ["Recursion", "Tree problems"],
      });
      // Isha's earlier rounds are on the interviewer's screen when she's called
      const curA2 = iv1.getByRole("region", { name: "Current student" });
      await iv1.getByRole("button", { name: "Call next" }).click();
      await expect(curA2.getByText("Isha Verma")).toBeVisible();
      await expect(curA2.getByText("Earlier rounds (3)")).toBeVisible();
      await expect(curA2.locator(".cy-earlier").getByText("Technical round 1")).toBeVisible();
      await interview(iv1, "Isha Verma", "Excellent on system design. KEY POINT: strong ownership.", "Select", "Great clarity of thought. Keep it up.", "panel-a-in-interview", {
        ratings: { "Technical knowledge": 5, "Problem solving": 5, Communication: 4, Confidence: 5 },
        strengths: ["System design", "Ownership"],
        concerns: ["Slightly fast talker"],
      });
    })(),
    (async () => {
      // Panel B at the same time: Aman, with the student watching his page
      const cur = iv2.getByRole("region", { name: "Current student" });
      await iv2.getByRole("button", { name: "Call next" }).click();
      await expect(cur.getByText("Aman Gupta")).toBeVisible();
      await aman.reload();
      await expect(roundItem(aman, "Interview round 1").getByText("Your turn: go to Room 102 now")).toBeVisible();
      await cur.getByRole("button", { name: "They're here: start" }).click();
      await aman.reload();
      await expect(roundItem(aman, "Interview round 1").getByText("In your interview (Panel B)")).toBeVisible();
      await interview(iv2, "Aman Gupta", "Good SQL. Needs work on Java collections.", "Select", "Solid basics. Read up on Java collections.", undefined, {
        ratings: { "Technical knowledge": 4, "Problem solving": 3, Communication: 4, Confidence: 4 },
        strengths: ["SQL"],
        concerns: ["Java collections"],
      });
    })(),
  ]);
  await shot(iv1, "panel-a-done");
  await expect(iv1.locator(".cy-line li", { hasText: "Pooja Nair" }).locator("summary")).toHaveText("Reject");
  await expect(iv1.locator(".cy-line li", { hasText: "Isha Verma" }).locator("summary")).toHaveText("Select");

  // Students see "Interview done", but no remark yet and never the private notes
  await Promise.all([aman, isha, pooja].map((s) => s.reload()));
  for (const s of [aman, isha, pooja]) {
    await expect(roundItem(s, "Interview round 1").getByText("Interview done")).toBeVisible();
    await expect(s.getByText(/Struggled with recursion|KEY POINT|Java collections\./)).toHaveCount(0);
    await expect(s.locator(".cy-remark")).toHaveCount(0);
  }

  // HR: panel recommendations and notes next to each result → publish
  await openRound(hr, "Interview round 1");
  await expect(hr.getByRole("row", { name: /Pooja Nair/ }).getByText(/Panel A: Reject/)).toBeVisible();
  // Open Isha's panel details: average, ratings, strengths, concerns and notes
  await hr.getByRole("row", { name: /Isha Verma/ }).locator("summary").click();
  await expect(hr.getByRole("row", { name: /Isha Verma/ }).getByText(/Panel A: Select · Avg 4\.8/)).toBeVisible();
  await expect(hr.getByRole("row", { name: /Isha Verma/ }).getByText("System design", { exact: true })).toBeVisible();
  await expect(hr.getByRole("row", { name: /Isha Verma/ }).getByText(/KEY POINT: strong ownership/)).toBeVisible();
  await expect(hr.getByRole("row", { name: /Aman Gupta/ }).getByText(/Panel B: Select/)).toBeVisible();
  await hr.getByRole("button", { name: "Use panel recommendations" }).click();
  await expect(hr.getByLabel("Result for Pooja Nair")).toHaveValue("REJECTED");
  await shot(hr, "interview-results-from-panels");
  await hr.getByRole("button", { name: /Save 3 changes/ }).click();
  await hr.getByRole("button", { name: "Publish results" }).click();
  await expect(hr.getByText("Results published. Everyone has been told.")).toBeVisible();

  // ───────────────────── Round 5: HR round, run by HR on their own panel ─────────────────────
  await openRound(hr, "HR round");
  await hr.getByRole("button", { name: "Start the round" }).click();
  await hr.getByLabel("Panel name").fill("HR panel");
  await hr.getByLabel("Room").fill("Placement cell");
  await hr.locator(".cy-add-panel").getByLabel(/Demo HR/).check();
  await hr.getByRole("button", { name: "Add panel" }).click();
  await hr.getByRole("button", { name: "Make the interview lines" }).click();
  await expect(hr.getByText("Added 2 students to the lines.")).toBeVisible();
  await hr.getByRole("link", { name: "Open panel" }).click();
  // HR round interviewer sees all four earlier rounds, including Panel A's key points from the interview round
  await hr.getByRole("button", { name: "Call next" }).click();
  const curHr = hr.getByRole("region", { name: "Current student" });
  await expect(curHr.getByText("Earlier rounds (4)")).toBeVisible();
  await expect(curHr.locator(".cy-earlier").getByText(/KEY POINT: strong ownership/)).toBeVisible();
  await expect(curHr.locator(".cy-earlier").getByText("Avg 4.8 / 5")).toBeVisible();
  await interview(hr, "Isha Verma", "Happy with the CTC. Can join in July.", "Select", "Welcome aboard if the offer works for you.", "hr-round-in-interview", {
    ratings: { Communication: 5, Attitude: 5, "Career goals fit": 4, "Team and culture fit": 4 },
    strengths: ["Clear about the role"],
  });
  await interview(hr, "Aman Gupta", "Wants Jaipur location. Fine with the bond.", "Select", "", undefined, { ratings: { Attitude: 4 } });
  await openRound(hr, "HR round");
  await hr.getByRole("button", { name: "Use panel recommendations" }).click();
  await hr.getByRole("button", { name: /Save 2 changes/ }).click();
  await hr.getByRole("button", { name: "Publish results" }).click();
  await expect(hr.getByText("Results published. Everyone has been told.")).toBeVisible();

  // ───────────────────── TPO checks the remarks ─────────────────────
  await tpo.goto("/office/drives");
  await tpo.getByRole("link", { name: /Software Engineer/ }).click();
  await tpo.getByRole("link", { name: "Feedback to check" }).click();
  // Remarks from Interview round 1 (3) and the HR round (1; Aman's was left empty)
  await expect(tpo.getByRole("button", { name: "Send to the student" })).toHaveCount(4);
  await shot(tpo, "tpo-feedback-to-check");
  await tpo.getByLabel("Remark for Pooja Nair").fill("Revise recursion and tree problems; you were close.");
  const card = (name: string, round: string) => tpo.locator(".cy-feedback", { hasText: name }).filter({ hasText: round });
  await card("Pooja Nair", "Interview round 1").getByRole("button", { name: "Send to the student" }).click();
  await expect(card("Pooja Nair", "Interview round 1").getByText("Reworded and sent")).toBeVisible();
  await card("Isha Verma", "Interview round 1").getByRole("button", { name: "Send to the student" }).click();
  await expect(card("Isha Verma", "Interview round 1").getByText("Sent to the student")).toBeVisible();
  await card("Aman Gupta", "Interview round 1").getByRole("button", { name: "Send to the student" }).click();
  await card("Isha Verma", "HR round").getByRole("button", { name: "Don't send" }).click();
  await expect(card("Isha Verma", "HR round").getByText("Not sent")).toBeVisible();

  // ───────────────────── What each student sees now ─────────────────────
  await Promise.all([aman, isha, pooja].map(openDrive));
  await expect(pooja.getByText("You're out of this drive")).toBeVisible();
  await expect(roundItem(pooja, "Interview round 1").getByText("Revise recursion and tree problems; you were close.")).toBeVisible();
  await expect(isha.getByText("You're selected!")).toBeVisible();
  await expect(roundItem(isha, "Interview round 1").getByText("Great clarity of thought. Keep it up.")).toBeVisible();
  await expect(isha.getByText("Welcome aboard")).toHaveCount(0); // withheld by the TPO
  await expect(aman.getByText("You're selected!")).toBeVisible();
  await expect(roundItem(aman, "Interview round 1").getByText("Solid basics. Read up on Java collections.")).toBeVisible();
  for (const s of [aman, isha, pooja]) await expect(s.getByText(/Struggled|KEY POINT|Happy with the CTC|Wants Jaipur/)).toHaveCount(0);
  await shot(isha, "isha-selected-with-remark");
  await shot(pooja, "pooja-out-with-remark");

  // ───────────────────── Notifications ─────────────────────
  await isha.goto("/student");
  await expect(isha.locator(".cy-unread").first()).toBeVisible();
  await isha.getByRole("link", { name: /Notifications/ }).first().click();
  await expect(isha.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(isha.getByText("Your turn: Panel A").first()).toBeVisible();
  await expect(isha.getByText("Moved to the end of the line: Panel A")).toBeVisible();
  await shot(isha, "isha-notifications");
  await isha.getByRole("button", { name: /Your turn: Panel A/ }).first().click();
  await expect(isha).toHaveURL(/\/student\/drives\//);
  await isha.goto("/student/notifications");
  await isha.getByRole("button", { name: "Mark all as read" }).click();
  await expect(isha.locator(".cy-unread")).toHaveCount(0);

  // ───────────────────── Offers: Aman accepts, Isha declines; TPO closes ─────────────────────
  await hr.goto("/company");
  await hr.getByRole("link", { name: /Software Engineer/ }).click();
  await hr.getByRole("link", { name: "Offers", exact: true }).first().click();
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
  for (const name of ["Aman Gupta", "Isha Verma"]) {
    await hr.getByLabel(`Offer letter for ${name}`).setInputFiles({ name: `${name.split(" ")[0]}-offer.pdf`, mimeType: "application/pdf", buffer: pdf });
    await expect(hr.getByText(`Offer letter sent to ${name}`)).toBeVisible();
  }
  await Promise.all([
    (async () => {
      await openDrive(aman);
      await aman.getByRole("region", { name: "Your offer" }).getByRole("button", { name: "Accept offer" }).click();
      await expect(aman.getByText("You're placed!")).toBeVisible();
    })(),
    (async () => {
      await openDrive(isha);
      await isha.getByRole("region", { name: "Your offer" }).getByRole("button", { name: "Decline" }).click();
      await expect(isha.getByText("You declined this offer")).toBeVisible();
    })(),
  ]);
  await hr.reload();
  await expect(hr.getByRole("row", { name: /Aman Gupta/ }).getByText("Accepted")).toBeVisible();
  await expect(hr.getByRole("row", { name: /Isha Verma/ }).getByText("Declined")).toBeVisible();
  await shot(hr, "hr-offers-answered");

  await tpo.goto("/office/drives");
  await tpo.getByRole("link", { name: /Software Engineer/ }).click();
  await tpo.getByRole("button", { name: "Close drive" }).click();
  await expect(tpo.getByText("Drive closed.")).toBeVisible();
  await shot(tpo, "tpo-drive-closed");
});
