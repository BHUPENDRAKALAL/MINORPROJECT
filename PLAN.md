# Cyrus (formerly PlaceSync) — Final Project Plan

> **This file is the single source of truth for the project.**
> If anything conflicts (the synopsis PDF, chats, code, or memory), **this file wins**.
> Any change to scope, roles, flow or tech goes here first, then into the code.

| | |
|---|---|
| Project | Cyrus: A Placement Drive Management and Placement Data Platform |
| University | MBM University, 7th Semester Minor Project |
| Students | Seya Mali (24UCSE4073), Bhupendra Kalal (24UCSE4008) |
| Guide / Mentor | Dr. Abhishek Gaur / Dr. Simran Choudhary |
| Base document | Original synopsis (`kalaaaal.pdf`). This plan extends it with the **Company HR–driven drive flow** |
| Last updated | 2026-11-07 |

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
   - Round types: `PPT`, `OA`, `GD`, `TECHNICAL_INTERVIEW`, `HR_INTERVIEW`, `OTHER`.
2. Drive status: `DRAFT → PENDING_APPROVAL → PUBLISHED → ONGOING → RESULTS_DECLARED → CLOSED`.
3. **TPO approves** the drive before any student can see it.

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
For each round:
1. Opted-in (and still active) students see the round details and get **notifications** (time, venue, instructions, changes).
2. **Attendance:**
   - **QR + location check**: the QR is generated on the HR/Coordinator device, rotates every few seconds, and works only within the venue radius.
   - **Manual fallback** by a Coordinator/TPO, always recorded in the audit log with a reason.
3. **Results:**
   - HR marks each student `SELECTED / REJECTED / ON_HOLD` in the app, **or uploads a CSV** (for OAs run on external platforms like HackerRank).
   - Only `SELECTED` students move to the next round. Everyone gets notified.
   - **Result visibility:** each student sees **their own** result. The TPO decides per drive whether a public list of selected roll numbers is also shown.

### 3.6 Interview round & live queue
1. The order of the shortlist list = the **queue order**.
2. Several **panels** can run in parallel → each panel has **its own queue** (HR splits the shortlist across panels, or the system auto-splits it).
3. Interviewer actions: **Call next → Start Interview → (write notes) → End Interview**.
4. Queue handling:
   - Absent/late student → **Skip** → moved to the end of the queue (notified).
   - Students see a **live position** and an **estimated wait time** (based on average start→end duration). Live updates via Socket.io.
5. **Notes vs feedback (two separate fields):**
   - **Private notes**: visible to the company + TPO only.
   - **Student-facing feedback/remark**: optional. **The TPO reviews it first** and only then is it released to the student.
6. After all interviews, HR looks at all the notes and gives the final select/reject.

### 3.7 Final results, offers & closing
1. HR declares the final results → students notified → drive status `RESULTS_DECLARED`.
2. HR uploads an **offer letter per selected student** (PDF).
   - **Who can see it:** that student, the TPO, and that company's HR. Nobody else.
   - Stored in private storage, served only through **short-lived signed URLs**.
3. Student **accepts / declines** the offer (with a deadline).
4. On acceptance → student placement status updates automatically → feeds the **Placement Statistics** and the TPO policy (e.g., the one-offer rule).
5. The TPO **closes the drive** → status `CLOSED` → HR becomes read-only → the drive data becomes part of the **historical placement data** (rounds, participation, selections, CTC).

---

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
