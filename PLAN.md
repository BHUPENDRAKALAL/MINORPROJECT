# Cyrus (formerly PlaceSync) — Final Project Plan

> **This file is the single source of truth for the project.**
> If anything conflicts (the synopsis PDF, chats, code, or memory), **this file wins**.
> Any change to scope, roles, flow or tech goes here first, then into the code.
> Problems we hit and how we fixed them are logged in [PROBLEMS-AND-FIXES.md](PROBLEMS-AND-FIXES.md).

| | |
|---|---|
| Project | Cyrus: A Placement Drive Management and Placement Data Platform |
| University | MBM University, 7th Semester Minor Project |
| Students | Seya Mali (24UCSE4073), Bhupendra Kalal (24UCSE4008) |
| Guide / Mentor | Dr. Abhishek Gaur / Dr. Simran Choudhary |
| Base document | Original synopsis (`kalaaaal.pdf`). This plan extends it with the **Company HR–driven drive flow** |
| Last updated | 2026-11-09 |

---

## 1. Problem (short)

Placement at MBM is run through WhatsApp groups, calls, spreadsheets and paper attendance. Shortlists and venue changes get lost, attendance is taken separately for every round, students can't see their interview-queue position, and past placement data (CTC, rounds, FAQs, stats) is scattered.

Cyrus centralises the **whole drive lifecycle** (company onboarding → drive → opt-in → rounds → attendance → results → interview queue → offer letters) and keeps **historical placement data** for future batches.

**What's new compared to the synopsis:** the company's HR is now a first-class user. After the TPO verifies the company, HR runs its own drive inside the app, under TPO rules and oversight.

---

## 2. Roles & Permissions

| Role | Who | Can do |
|---|---|---|
| **TPO (Placement Officer)** | Super-admin of the college | Verify companies/JDs, invite HR, set university policies, approve drives, view everything, act on behalf of HR, moderate remarks, manage student data, view all offer letters, close drives, analytics |
| **Coordinator** | Student/staff coordinators | Help the TPO: attendance (QR/manual), venue updates, announcements, queue handling on drive day. Only for drives they are assigned to |
| **Company HR (Company Admin)** | Recruiter from the company | Create/edit drives **for their own company only**, define rounds, filter eligible students, mark shortlist, upload results, run interviews, upload offer letters, add interviewers |
| **Interviewer** | Panel member added by HR | Only their assigned panel/queue: start/end interview, write private notes, recommend select/reject |
| **Student** | Final/pre-final year students | Manage profile, opt in/out, see rounds & updates, give attendance, see own results/feedback, see queue position, view/accept/decline own offer |
| **Placed Senior** | Alumni / placed seniors | Profile + FAQs; contact details visible **only with consent** |

**Access rules (hard rules):**
- HR and Interviewer see **only their own company's drives**.
- HR access is **read-only after the drive closes**, and expires after a TPO-set period.
- Every HR, Interviewer and TPO action on a drive is written to the **audit log**.
- The TPO can do **any HR action on behalf of the company** (fallback for when a company doesn't use the app; also used for the demo).

---

## 3. Core Flow: Company HR–Driven Drive

### 3.1 Company onboarding (via the Company Portal)
There is a separate **Company Portal**: a public website where companies register. For simplicity it is built inside the same React web app as public pages (e.g. `/company/register`), and can later be moved to its own subdomain (e.g. `company.cyrus…`).

1. **Company registers** on the portal with:
   - company name, website, industry, address, about
   - HR name, designation, phone, **official company email**
   - first role/JD request (role, CTC/stipend, location, eligibility wishes, tentative dates, JD PDF)
2. **Email OTP verification** of the official email. Free mail domains (gmail, yahoo, etc.) are flagged for extra checking by the TPO.
3. Request lands in the **TPO panel → Company Requests** with status `PENDING`.
4. **TPO verifies** the company and JD → `VERIFIED / REJECTED` (with a reason, emailed to the company). The TPO can also ask for more info (`NEEDS_INFO`).
5. On verification, the system emails an **invite link** (time-limited, single-use) to the HR. HR opens it and **sets their own password**. No plain-text ID/password is ever sent.
6. HR can add **Interviewer** sub-accounts for their company.
7. **Repeat companies** don't register again. A verified HR logs in and creates a new drive, which still needs **TPO approval** (section 3.2).
8. **TPO fallback:** the TPO can also create a company and its drive directly (for companies that only send the JD by email).

### 3.1b Student registration & verification
1. Student signs up on the app with **roll number + personal email** (MBM has no college email), verified with an **email OTP**. Roll number and email are both unique, so one account per student. If a roll number is already taken, the TPO resolves it.
2. Student fills in their **profile**: personal details, branch, batch, CGPA, active/past backlogs, 10th/12th %, skills, resume, and uploads **proof documents** (marksheets).
3. Status `PENDING_VERIFICATION` → the **TPO or a Coordinator verifies** the details against the proofs/records → `VERIFIED` or `REJECTED` (with a reason, so the student can fix and resubmit).
4. **Bulk verification:** the TPO can import an official student list (CSV from university records: roll no, name, branch, CGPA, backlogs). The system auto-matches it with self-registered profiles, so only mismatches need manual checking.
5. **Only `VERIFIED` students** can be shortlisted, opt in, or appear to HR.
6. **Academic fields are locked after verification.** To change CGPA/backlogs (e.g. after a new semester), the student raises an **update request**, which needs re-verification. Old values stay in history (audit log).
7. Non-academic fields (phone, skills, resume, photo) can be edited freely.

### 3.2 Drive creation
1. HR creates a drive: role(s), CTC/stipend, location, JD, bond, timeline, **rounds** (type, date, time, venue/online link, mode).
   - Round kinds: `PPT`, `OA`, `GD`, `TECHNICAL`, `INTERVIEW`, `HR`, `OTHER`. A kind can **repeat** in one drive (Technical round 1, 2, 3…; Interview round 1, 2, 3…): the shown name is the round's title, numbered automatically and renumbered when rounds move. A round's date can stay "to be announced".
   - The round builder has one-click templates (e.g. OA → Technical 1 → Technical 2 → HR). After approval, rounds can still change; students in the drive are told.
   - Builder steps: 1. Job details · 2. Who can apply (live count of matching students) · 3. Rounds · 4. Check and send.
2. Drive status: `DRAFT → PENDING_APPROVAL → PUBLISHED → ONGOING → RESULTS_DECLARED → CLOSED`.
3. **TPO approves** the drive before any student can see it. The TPO can send it back with a note, or cancel it later (students and HR are told). A drive the TPO creates for a company without HR is published directly.
4. **Visibility to students:** every student can see that an approved drive exists (company, role, type, status), marked "Invite only". Details, pay and rounds are visible **only to students invited** to that drive. Online test links only after the student joins.
5. After approval, HR can change only the description, location and deadline; pay, role and eligibility are locked (the TPO can still change them).

### 3.3 Eligibility & shortlisting
1. **The TPO sets the base policy** (applies to every drive):
   - one-offer / dream-offer rule, already-placed students blocked or allowed, minimum attendance, blacklist after no-shows, etc.
2. HR filters **inside** that policy: branch, CGPA, backlogs (active/history), 10th/12th %, gender (only if legally required by the role), batch, etc.
3. **Privacy: what HR sees before opt-in:** only limited fields (name, roll no, branch, CGPA, backlogs). No phone, email, address or resume.
4. HR **marks eligible students** → they get a **push notification** + in-app notification.

### 3.4 Opt-in / Opt-out
1. Each drive has an **opt-in deadline**.
2. Students choose **Opt-in** or **Opt-out** before the deadline. If they do nothing, it counts as opt-out.
3. Opting in is **consent**: after that, HR can see the student's resume and contact details.
4. **No-show rule:** if a student opts in and then misses a round without a valid reason, the TPO policy decides the penalty (warning → block from future drives). The TPO can override it.

### 3.5 Rounds
Built 2026-11-08 (Phase B1/B2). Each round has its own page for HR and the TPO.
1. **Order:** rounds run one after another. A round can start only after the results of every earlier round are published. **Starting the first round closes joining**: unanswered invites expire and the drive becomes "Rounds in progress".
2. Who is in a round: every student who joined and hasn't been knocked out in an earlier round. Starting a round tells them (in-app + email).
3. **Attendance (on-campus rounds):**
   - HR (or the TPO, or staff/volunteers with the drive-day attendance permission) opens check-in and puts the page on a screen at the venue ("Full screen" mode for a projector).
   - The QR code **changes every 15 seconds**; the current and the previous code work, so a photo shared on a group stops working within ~30 s.
   - The QR is a link: students scan it with the normal phone camera, it opens Cyrus and checks them in. No app or scanner needed.
   - **Location check (optional):** when opening check-in, the opener can lock it to their current location and a radius (default 150 m). Students then have to share their location and be inside the radius.
   - **Manual fallback:** only the TPO (or attendance helpers) can mark a student present or absent by hand, always with a reason, kept in the audit log. HR can't.
   - Results can be published only after check-in is closed. Students not checked in at that point count as **absent**.
   - Online rounds have no QR check-in; the test platform's results decide.
4. **Results:**
   - HR picks a result per student (Selected / Not selected / On hold), saves (students see nothing yet), or **uploads a CSV** from the test platform: any file whose first row has a roll-number column and a result column (Selected/Rejected, Pass/Fail, Qualified/Not qualified…). Rows that don't match a student in the round are listed back.
   - **Publish** (can't be undone; needs every present student decided and nobody on hold): not selected → out of the drive; absent → out + no-show counted on the student (policy warning); selected → next round. After the **last round**, selected students are **selected for the job** and the drive becomes "Results out".
   - A pre-placement talk has no results: "Finish the talk" only records who came.
   - **Result visibility:** each student sees only their own result per round on the drive page ("You cleared this round", "Not selected", "You were absent", "Checked in"). The public selected list stays a later option.

### 3.6 Interview round & live queue
Built 2026-11-08 (Phase B3). Works for Technical, Interview and HR rounds.
1. **Panels:** on the round page HR (or the TPO) adds panels: a name, a room and the people on it (the company's HR and interviewers). HR invites interviewers by email from the company **Team** page; an interviewer can only open panels they sit on.
2. **Lines:** "Make the interview lines" splits the round's students evenly across the panels, in roll-number order (if check-in was used, only students who checked in). Running it again adds late arrivals to the shortest line. HR can move a waiting student to another panel.
3. **Interviewer screen** ("My panels" → a panel): **Call next** (the student is told at once: "Your turn: go to Room 204") → **They're here: start** (timer runs) → private notes + recommendation (Select / Hold / Reject) + an optional remark for the student → **End interview**. Two clicks can't call two students at once (the panel's line is locked while calling).
4. **Skip:** a called student who isn't there goes to the end of the line and is told. The second skip marks them absent from the line; "Back in line" undoes it if they turn up.
5. **Students** see their place on the drive page, refreshed every 10 seconds: "You're number 3 in line for Panel A (Room 204), about 30 min". The wait is (people ahead + the one in the room) × the panel's average interview length (15 min until two interviews are done). Live push with Socket.io comes later; polling is enough for one campus.
6. **Notes vs remarks:** private notes and recommendations are seen only by the company and the TPO. A remark for the student goes to the TPO first (drive page → "Feedback to check"); the TPO sends it as is, rewords it, or doesn't send it. Only then does the student see it under the round.
7. **Structured key points** (added 2026-11-09): besides private notes, the interviewer rates the student 1–5 on the round's criteria and lists strengths and concerns (one per line). Criteria per kind of round: Technical (problem solving, technical knowledge, coding, communication), Interview (technical knowledge, problem solving, communication, confidence), HR (communication, attitude, career goals fit, team and culture fit), GD (communication, ideas, teamwork). Company + TPO only, never shown to students.
8. **Earlier rounds on the panel screen** (added 2026-11-09): when a student is called, the interviewer sees everything earlier rounds say about them: each round's published result, whether they checked in, and every panel's recommendation, ratings (with the average), strengths, concerns and notes. Results not yet published stay hidden.
9. **Final decision:** the round's results table shows each student's panel recommendation and notes; "Use panel recommendations" fills the results, HR can change any, then publishes as in 3.5. Publishing waits until no interview is still running.

### 3.7 Final results, offers & closing
Built 2026-11-08 (Phase B4).
1. Publishing the **last round** declares the final results: selected students are told, the drive becomes "Results out".
2. **Offer letters:** on the drive's **Offers** tab HR uploads one PDF per selected student (optional joining date). The CTC defaults to the drive's CTC.
   - **Who can open it:** that student, the TPO and that company's HR. Nobody else (not interviewers, not other students).
   - Stored in private storage and opened only through a **2-minute signed link**. A student can't open a letter still being virus-checked.
   - HR can **replace** the letter (the student is told) or **withdraw** an unanswered offer with a reason the student sees.
3. **Student answers** on the drive page: read the letter, **Accept** or **Decline** before the deadline (TPO policy: 7 days by default). An unanswered offer past its deadline counts as expired.
4. **Accepting** marks the student **Placed**, records the placement (company, role, CTC, branch, batch: feeds the statistics and the history), and tells HR. **One-offer rule:** an already-placed student can't accept another offer unless it is a "dream" offer (CTC at or above the TPO's dream threshold).
5. The **TPO closes the drive** once results are out: HR can no longer send or change offers; the drive stays as history. Students with an unanswered offer can still answer until its deadline.
6. Also built with this step: company HR and interviewers can open the **resume** of a student who joined (gave consent to) one of their company's drives; the panel screen has an "Open resume" button.

## 4. Rest of the Scope (same as the synopsis)

### A. Placement Drive Management
- Covered by Section 3 above, plus: calendar & reminders, announcements, **export** of attendance/result reports (CSV/PDF).

### B. Placement Data Platform
- Company profiles (roles, eligibility, CTC, links).
- Past-year round-wise participation & selection data (filled automatically from closed drives, plus **historical import** via CSV).
- Company-wise FAQs and previous-drive info.
- Placed-senior profiles (contact only with consent).
- Department-wise placement statistics.

### C. Community & Support *(lower priority: build if time permits)*
- Moderated student/recruiter reviews after a drive.
- Help & support ticketing.
- Interview experience / discussion area, moderated by the TPO.

---

## 5. Tech Stack & Architecture (approved 2026-11-07)

**Detailed backend design: [BACKEND-DESIGN.md](BACKEND-DESIGN.md) — approved.** Route weight classes approved as shown on the review page (Hot / Heavy / Light + background / Light). Visual direction draft: [DESIGN-DIRECTION.md](DESIGN-DIRECTION.md).

| Layer | Tech | Use |
|---|---|---|
| Web app | **React + TypeScript (Vite)** | One codebase for every role. TPO, staff, volunteers, HR and interviewers use it as a website |
| Student app | **Tauri v2** wrapping the same React app (Android; desktop build optional) | QR scan, location, push. **Week 1: test QR + location + FCM push on Android using a third-party push plugin.** Then build **our own push plugin** (`tauri-plugin-cyrus-push`, FCM-based) in Week 3. See BACKEND-DESIGN.md §5b |
| Backend | **Node.js + Express + TypeScript** (REST, `/api/v1`; zod schemas validate requests and generate the OpenAPI docs) | All business logic, role + ownership checks |
| Architecture | **Modular monolith, 3 process types:** `api`, `realtime`, `worker` (+ `relay`). Heavy work only in workers (`202 + jobId`) | Failure isolation and independent scaling without microservice overhead |
| Events / jobs | **Outbox table + Redis queues (BullMQ)**, queues by priority: notify > webhooks > imports > documents/company-check > reports | No lost events; slow work never blocks drive day |
| Realtime | **Socket.io** (+ Redis adapter) | Live queue, QR rotation, job progress |
| Database | **PostgreSQL + Prisma** | All structured data |
| Cache / live state | **Redis** | Only the reads listed in BACKEND-DESIGN §7; live queue + QR codes |
| Auth | **JWT** (short access + refresh) + role/capability/ownership checks; 2-step login for TPO/staff | |
| Notifications | **FCM** + in-app + email; **webhooks** for outside teams (signed, retried) | |
| File storage | Private storage + short-lived links (provider still open) | Resumes, marksheets, JDs, offer letters |
| Deployment | Docker containers; Docker Compose for dev/demo; **k8s optional in Week 6 (P2)** | |

**Security basics:** hashed passwords, rate limits, schema validation on every route, audit log, short-lived file links, virus scan on uploads, crawler blocked from private IPs, no student personal data to HR before opt-in.

---

## 6. Main Data Entities (first draft, finalise in Week 1)

`User` (role) · `StudentProfile` · `Company` · `CompanyRequest/JD` · `HRInvite` · `Drive` · `Round` · `DriveEligibility` (shortlist) · `DriveParticipation` (opt-in/out, status) · `Attendance` · `RoundResult` · `Panel` · `QueueEntry` · `InterviewSession` (start/end, private notes) · `Feedback` (student-facing, review status) · `Offer` (file, accept/decline) · `Notification` · `Announcement` · `Policy` (TPO rules) · `AuditLog` · `FAQ` · `SeniorProfile` · `PlacementRecord` (historical) · `Review` · `SupportTicket`

---

## 6b. Reference Project: PlaceMint (ideas only, no code copied)

Repo: PlaceMint, a public placement-portal project on GitHub (Flask + Vue + SQLite, no license).
**Rule:** we write all our code ourselves. We only take ideas from it, and credit it in the report as a reference.

**Ideas we take:**
- One `User` table with a role, plus separate profile tables for each role.
- The eligibility check returns **reasons** (e.g. "CGPA below 7"), not only yes/no. Students see why they are not eligible.
- Opt-in checks: the drive is published, the deadline hasn't passed, no duplicate (unique student+drive in the DB), the student is eligible.
- Ownership check on every company action (HR can touch only their own company's drives). Blocked or deactivated accounts are refused at login and on every request.
- File access rules: a resume is visible only to companies the student opted into; an offer letter only to that student, that company and the TPO.
- A separate placement record (apart from the application) that feeds the stats.
- Safe CSV export (cells starting with `=`, `+`, `-`, `@` are neutralised).
- Daily reminders for upcoming rounds and deadlines.
- Login attempt limits; tests for the business rules.

**What we do differently:**
- PostgreSQL instead of SQLite.
- File download links expire after a short time. No login token in the URL.
- No hard delete of users that wipes placement history; accounts are deactivated instead.
- The company uploads the real offer letter. We don't generate one.
- Audit log for every action.

---

## 7. Feature Priority

**P0: Must have (core demo flow)**
1. Auth + roles (TPO, Coordinator, HR, Interviewer, Student)
2. Company Portal registration + TPO verification + HR invite onboarding; student self-registration + TPO verification
3. Drive creation with rounds + TPO approval
4. Eligibility filters within TPO policy + shortlist + notifications
5. Opt-in/opt-out with deadline
6. QR + location attendance + manual fallback with audit log
7. Round results (in-app + CSV upload)
8. Live interview queue (panels, skip, ETA) + start/end + private notes
9. Final results + offer letter upload/visibility + accept/decline
10. Drive close → placement status → stats
11. TPO "act on behalf of HR" fallback

**P1: Should have**
- Feedback moderation, no-show penalty policy, calendar/reminders, announcements, report export, company profiles, past-year data, FAQs, placement statistics, historical CSV import

**P2: If time permits**
- Placed-senior profiles with consent, reviews, support tickets, discussion area, interviewer screens in the mobile app

---

## 8. Work Distribution

**Seya Mali:** Mobile app (React Native), auth/role flows on mobile, student drive flow (notifications, opt-in/out, round view), QR attendance scanning, live queue UI, results/offer screens, API integration, testing.

**Bhupendra Kalal:** Backend APIs, PostgreSQL/Prisma schema, web panel (TPO + **Company HR** + Interviewer), eligibility & policy logic, company onboarding/invites, attendance/result management, queue engine (Socket.io), offer storage, data/statistics modules, deployment, testing.

**Both:** System design, DB review, integration, documentation, testing, debugging, final demo.

---

## 9. Six-Week Plan (updated)

| Week | Work |
|---|---|
| 1 | Finalise requirements (this file), DB schema, wireframes, API design, project setup (repo, backend, web, mobile) |
| 2 | Auth + roles + ownership checks, **student self-registration + verification (incl. bulk CSV match)**, TPO panel base, **Company Portal + company verification + HR invite flow**, TPO policy settings |
| 3 | Drive + rounds creation, TPO approval, eligibility filters + shortlist, notifications, opt-in/out, QR + location attendance + manual fallback |
| 4 | Round results (in-app + CSV), **live interview queue** (panels, skip, ETA), start/end interview, notes + feedback moderation |
| 5 | Final results, offer letters (upload, signed access, accept/decline), drive closing → stats, company profiles, past data, FAQs; P2 items if time permits |
| 6 | Integration, security checks, **full mock drive** (TPO → HR → students), bug fixing, report export, synopsis/report update, final demo |

---

## 10. Open Decisions (decide and record here)

- [ ] Which file storage provider (Cloudinary / S3 / Supabase Storage)?
- [ ] Hosting for backend + DB (Render / Railway / VPS)?
- [ ] Exact TPO policy rules at MBM (one-offer? dream-offer CTC threshold?)
- [ ] No-show penalty levels
- [ ] Is a public selected list shown by default or not?
- [x] ~~Can companies submit a JD through a public form?~~ → **Yes: Company Portal (section 3.1)**
- [x] ~~College email for students?~~ → **No college email exists.** Students sign up with a **personal email + email OTP + roll number** (roll number unique). **TPO verification is the identity gate.** Extra safeguard: one account per roll number, plus one per email; if a roll number is already claimed, the student contacts the TPO, who can reset it
- [ ] Can we get the official student CSV (CGPA/backlogs) from the university? **Likely yes, to be confirmed.** Bulk import stays **optional**; manual verification against uploaded proofs works without it. For development/demo, use a dummy CSV. Once the real format is known, map its columns in the importer
- [ ] Do Interviewer/Coordinator screens go in the mobile app or only the web panel?

---

## 11. Change Log

| Date | Change |
|---|---|
| 2026-11-07 | Created. Base synopsis + Company HR–driven drive flow, TPO approval/policies, privacy-before-opt-in, panel-wise queue, notes vs moderated feedback, offer-letter access rules, TPO fallback, priority tiers, updated weekly plan |
| 2026-11-07 | Added the Company Portal (public registration + email OTP → TPO verifies → HR invite link) and student self-registration (OTP signup → profile + proofs → TPO/Coordinator verification, bulk CSV match, academic fields locked after verification). Updated P0 list, Week 2 and open decisions |
| 2026-11-07 | College email domain and official student CSV are pending with the university. The design now works either way: any-email signup with an optional domain config, and bulk CSV import as an optional feature |
| 2026-11-07 | Confirmed: MBM has no college email, so signup uses personal email + OTP + roll number, with the TPO verification as the gate. Official CSV is likely available (format to be confirmed), and bulk import stays optional |
| 2026-11-07 | Added section 6b: PlaceMint (Flask/Vue) used as an ideas-only reference. All code is written by us; the reference is credited in the report |
| 2026-11-07 | **Approved:** BACKEND-DESIGN.md (REST, modular monolith with api/realtime/worker processes, outbox + BullMQ, compute separated from API, document matching, review team with work queue, company checks with crawler, webhooks, caching rules) and the four route weight classes. Stack changed: Tauri v2 (instead of Expo) + React/TS web, Node + TypeScript + Fastify (instead of Express). k8s moved to optional Week 6. Remaining open questions stay in BACKEND-DESIGN.md §12 |
| 2026-11-07 | **Correction:** backend stays on **Node + Express** as originally decided (Fastify was only a suggestion and was approved by mistake). Express + TypeScript + zod (validation and OpenAPI docs) |
| 2026-11-07 | Push notifications: Tauri only has local notifications, so we use a third-party FCM plugin for the Week 1 test and then build our own Tauri plugin on FCM (BACKEND-DESIGN.md §5b). Working rules: every commit credits Claude with a Co-Authored-By line, and git history is not rewritten unless it's truly needed |
| 2026-11-07 | Assets: a friend (the asset contributor, Foundry) offered pixel assets and will also generate new ones with Vertex AI (ASSET-BRIEF.md). **The contributor is never named** in the app, README or report. We build our own Cyrus characters on his base instead of using his avatar or Foundry's mascot. New art is drawn as pixel-grid SVG in code, so the Gemini key is optional (DESIGN-DIRECTION.md) |
| 2026-11-07 | **Renamed: the product is now called Cyrus** (was PlaceSync). All user-facing text, docs and emails use "Cyrus". Internal identifiers followed the same day: packages `@cyrus/*`, database/user `cyrus`, cookie `cy_refresh`, Tauri id `com.cyrus.app` |
| 2026-11-08 | Storage: SeaweedFS (S3-compatible, free) instead of MinIO, whose community edition is no longer published or maintained. Email: Mailpit in development, Brevo free plan (300/day) for real sending, via SMTP. Built student profile + document upload + submit/withdraw, the review queue (get next, 15-min lock, verify/reject, second checks, escalation to TPO) and TPO team invites |
| 2026-11-08 | Drives Phase A built: HR creates a drive in 4 steps, flexible round builder (repeatable kinds, auto-numbered names, templates), TPO approve / send back / cancel, eligibility preview with placement policy, invite all or picked students, student join (with consent) or skip until the deadline, schedule-change and cancel notifications. Students see other drives by name only ("Invite only"). Round kinds changed to PPT/OA/GD/TECHNICAL/INTERVIEW/HR/OTHER; round date may be empty. Demo data: hr@cyrus.test with Northwind Systems drives. Phase B next: attendance (QR), results, interview queue, offers |
| 2026-11-08 | Drives Phase B1/B2 built: round lifecycle (start in order; first round closes joining), QR check-in (rotating every 15 s, scanned with the phone camera, optional location radius, manual marking by the TPO only with a reason), results by hand or CSV from a test platform, publish (out / absent + no-show count / through / selected after the last round), students see their own result per round. Access rule added: a route can allow a role OR a permission (drive-day helpers). Next: B3 interview queue with panels, B4 offers |
| 2026-11-08 | Drives Phase B3 built: interview panels (HR, interviewers), HR invites interviewers from the company Team page, lines split evenly (only checked-in students if check-in was used), interviewer screen with call next / start / end / skip (absent after two skips, can be put back), students see their place and a wait estimate, private notes vs student remarks (TPO checks remarks before release), panel recommendations shown next to results. Demo: interviewer@cyrus.test and the Support Engineer drive for interview day. Next: B4 offers |
| 2026-11-08 | Drives Phase B4 built: offer letters (PDF per selected student, visible only to the student, TPO and company HR via 2-minute links; replace or withdraw), student accept/decline with a deadline (expired after it), accepting places the student and writes the placement record, one-offer rule with the dream-offer exception, TPO closes the drive. Company HR and interviewers can open the resume of students who joined their drives. Demo: Billing Analyst drive with final results out. Phase B of drives is complete |
| 2026-11-09 | Live drive simulation (9 people signed in at once: HR, TPO, 2 interviewers, 4 students) passes end to end; it found one bug (fixed). Added: structured interview key points (1–5 ratings per criterion for the round's kind, strengths, concerns), interviewers see every earlier round's results and panel notes for the student, and a Notifications page for every role with an unread badge in the side panel |
| 2026-11-09 | Added PROBLEMS-AND-FIXES.md: every bug, setup problem and test failure so far with its cause and fix, plus what's still open. Kept up to date from now on |
