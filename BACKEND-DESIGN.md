# Cyrus: Backend Design (Brainstorm Draft)

> **Status: DRAFT for discussion.** Nothing here is final until it is agreed and copied into `PLAN.md`.
> `PLAN.md` stays the source of truth.
> Date: 2026-11-07

---

## 0. Big decisions in this draft (summary)

| Topic | Proposal | Why (short) |
|---|---|---|
| Clients | **One React codebase.** Website for TPO / HR / interviewers / coordinators. **Tauri v2** wraps it for the student Android app (and optionally a desktop app) | One UI codebase. HR should never need to install anything, so they use the website |
| Backend | **Node.js + Express + TypeScript**, with zod schemas per route | One zod schema validates the request and generates the OpenAPI docs |
| API style | **REST + OpenAPI spec**, Socket.io for live updates, **webhooks** for outside teams | See section 6 |
| Architecture | **Modular monolith** with an internal event system, run as **3 processes** (api, worker, realtime). Containerised and k8s-ready, with k8s deployed only at the end | See section 2 |
| Events | **Outbox table + Redis queues (BullMQ)** | No event is lost if a process crashes; a failure in one job doesn't affect the others |
| Compute | **Heavy work runs only in worker processes**, never in the API. The API returns `202 + jobId`; the result arrives over Socket.io or `GET /jobs/:id`. Separate queues by priority (section 2b) | Node's single main thread must stay free for check-ins and the queue |
| DB | PostgreSQL + Prisma | Same as the plan |
| Cache | Redis, only for specific reads (section 7) | Most of our data is small; caching wrong data is worse than no cache |
| Documents | Separate **verification module** with source matching (section 4) | The hardest problem in the project |
| Review team | TPO staff + student volunteers, onboarded by the TPO; one work queue with "get next task", 15-min locks, risk-based routing and two-level checks (section 4b) | Verification is human work; it must be split fairly, safely and checkably |

---

## 1. Clients: Tauri check

**What Tauri v2 gives us:** one React app → website + desktop app + Android/iOS app.

**What we need on the student phone, and the Tauri status:**

| Need | Tauri v2 status | Risk |
|---|---|---|
| QR scan | Official `barcode-scanner` plugin (Android/iOS) | Low |
| Location (for attendance) | Official `geolocation` plugin; mobile setup needs checking | Medium |
| **Push notifications (FCM)** | **No official plugin.** Community plugins only (`tauri-plugin-remote-push`, `tauri-plugin-mobile-push`, `tauri-plugin-notifications`) | **High** |
| Background/killed-app notifications | Depends on the community plugin | High |
| Toolchain | Rust + Android Studio/NDK on both laptops | Setup time |

**Proposal:** do a **2-day test build in Week 1** on one Android phone: QR scan + location + FCM push with the app closed.
- Works → keep Tauri.
- Push fails → fallback options: (a) send notifications through the website as a PWA plus email, or (b) Expo only for the student app.

Decide after the test, not before.

**Who uses what:**
- TPO, Coordinator, HR, Interviewer → **website** (same React app; optional Tauri desktop build for the TPO office)
- Student → **Tauri Android app** (+ the website as a backup)

---

## 2. Architecture: k8s and microservices, an honest take

**Goal stated:** easy scaling, and one failure shouldn't affect the rest.

**Reality check for MBM scale:**
- About 1–3k students, a few drives a week. Peak load = drive day: a few hundred students checking in and watching the queue. **One small server handles this easily.**
- Full microservices on k8s for 2 people in 6 weeks means separate DBs, service-to-service auth, distributed tracing, k8s manifests, debugging across services. That would eat the weeks we need for the actual features (rounds, queue, verification).

**Proposal: modular monolith + event-driven background work.** It gets the failure isolation we want without the cost.

```
                  ┌──────────────┐
 Web / Tauri ───► │  api         │  REST requests, writes DB + outbox row in ONE transaction
                  └──────┬───────┘
                         │ outbox table (Postgres)
                  ┌──────▼───────┐
                  │  relay       │  reads new outbox rows → pushes to Redis queues
                  └──────┬───────┘
          ┌──────────────┼───────────────┬───────────────┐
   ┌──────▼─────┐ ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
   │ notify     │ │ webhooks    │ │ documents   │ │ reports/    │   workers (separate processes)
   │ push/email │ │ deliveries  │ │ import/match│ │ stats/export│
   └────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
                  ┌──────────────┐
                  │  realtime    │  Socket.io (queue, live status); Redis adapter for >1 copy
                  └──────────────┘
```

- **One codebase, several entry points:** `api`, `worker` (one process type per queue), `realtime`.
- If the WhatsApp/webhook worker crashes, the API and the queue keep working. Jobs wait in Redis and retry.
- Every process is a **stateless Docker container** → it can move to k8s later without code changes.
- **k8s plan:** Weeks 1–5 use Docker Compose. In Week 6, *if time permits*, deploy the same containers on a small cluster (k3s/minikube) with replicas for `api` and `realtime` to show scaling for the demo/report. Mark it P2.
- Module boundaries are kept strict (each module owns its tables and talks to others only through its service functions or events), so a module can be split into a real service later if ever needed.

### 2b. Compute is separate from the API

**Why:** Node runs our code on one main thread. If the API process parses a 3,000-row CSV, reads a PDF or runs OCR, **every other request waits**: check-ins, queue updates, logins. So heavy work never runs inside the API process.

**Rule: what runs where**

| Runs in the API (instant, < ~300 ms, simple DB work) | Goes to a compute job |
|---|---|
| Login, opt-in/out, QR check-in, call next / skip, set one result, read lists | Official CSV import + matching |
| Eligibility preview (one SQL query over ~3k students is fast) | Results CSV import (external test platforms) |
| Upload a file (just store it + hash) | Reading marksheet PDFs / OCR |
| | Sending notifications to many students (fan-out) |
| | Webhook deliveries (outside servers can be slow or down) |
| | Reports / exports, stats recalculation, drive-close archiving |
| | Queue re-split across panels when a panel is added mid-round |

Also a job: anything that may take > 1–2 s, calls an outside service, or uses heavy CPU.

**Flow (the API never waits for compute):**
```
Client ──POST /admin/imports──► API: save file, create job row (QUEUED), put on Redis queue
       ◄── 202 Accepted { jobId } ── (returns immediately)

Worker: picks job → RUNNING → reports progress (e.g. 40%) → writes result → DONE / FAILED

Client gets updates two ways:
  • live: Socket.io event `job.progress` / `job.done` in room user:{id}   (no refresh needed)
  • fallback: GET /jobs/:id  (if the socket was disconnected)
```

**Job states:** `QUEUED → RUNNING → DONE | FAILED | CANCELLED` (`FAILED` → automatic retry with growing delay, up to N times)

**Separate queues with their own priority and worker count**, so slow work never delays urgent work:

| Queue | Priority | Examples |
|---|---|---|
| `notify` | Highest | Push/email for shortlist, round change, "your turn soon" |
| `webhooks` | High | Outside deliveries (retries don't block `notify`) |
| `imports` | Normal | CSV matching, results import |
| `documents` | Low | PDF reading / OCR (CPU-heavy: runs in worker threads, max 1–2 at a time) |
| `reports` | Lowest | Exports, stats, drive archive |

**Job rules:**
- **Idempotent:** running the same job twice gives the same result (e.g. an import row is applied once).
- **Timeout per job type**, so a stuck job is marked failed instead of hanging forever.
- **Cancel:** `DELETE /jobs/:id` for long jobs (imports, exports).
- **Results:** small results go in the job row, big ones (export files) in file storage with an expiring link. Old job rows are cleaned up after 30 days.
- **Ownership:** a user can only see their own jobs; the TPO can see all.
- **Scaling:** add more worker copies of a busy queue (e.g. 3 × `notify` on drive day) without touching the API. This part maps directly onto k8s later.

**Generic job routes** (also listed in section 9.16):
| GET | `/jobs/:id` | owner, T | Status, progress, result / error |
| GET | `/jobs` | owner, T | My recent jobs |
| DELETE | `/jobs/:id` | owner, T | Cancel |

### Modules
`identity` (auth, users, invites, OTP) · `companies` · `students` · `verification` (documents, imports, matching) · `policies` · `drives` (drives, rounds, invitations, participation) · `attendance` · `results` · `interviews` (panels, queue, sessions, notes, feedback) · `offers` · `notifications` · `webhooks` · `files` · `data-platform` (company history, FAQs, seniors, stats) · `audit` · `exports`

---

## 3. State machines

Every status change goes through **one transition function per entity**: it checks that the move is allowed and that the user's role is allowed, then saves, writes an audit row and emits an event, all in one DB transaction. Moves not in the table are rejected.

**Company request**
`PENDING_EMAIL` →(OTP ok)→ `PENDING` →(TPO)→ `APPROVED` | `REJECTED` | `NEEDS_INFO` →(company updates)→ `PENDING`

**Invite (HR / interviewer / coordinator)**
`SENT` → `ACCEPTED` | `EXPIRED` | `REVOKED`

**Student account**
`EMAIL_UNVERIFIED` → `PROFILE_INCOMPLETE` → `PENDING_VERIFICATION` → `VERIFIED` | `REJECTED` (→ fix → `PENDING_VERIFICATION`)
Anytime by TPO: `DEACTIVATED` / `BLOCKED` (no-show rule)

**Academic update request**
`PENDING` → `APPROVED` (profile updated, old values kept in history) | `REJECTED`

**Document** (marksheet, resume, offer letter)
`UPLOADED` → `CHECKING` → `MATCHED` | `MISMATCH` | `UNREADABLE` → (TPO) `ACCEPTED` | `REJECTED` · newer upload → old one `SUPERSEDED`

**Import job** (official CSV)
`UPLOADED` → `MAPPING` → `PREVIEW` → `APPLYING` → `DONE` | `FAILED`

**Drive**
`DRAFT` → `PENDING_APPROVAL` → `PUBLISHED` (opt-in open) → `ONGOING` (opt-in closed / first round started) → `RESULTS_DECLARED` → `CLOSED`
Also: `REJECTED` (back to `DRAFT` to edit), `CANCELLED`

**Round**
`SCHEDULED` → `IN_PROGRESS` → `RESULTS_PENDING` → `RESULTS_PUBLISHED` · `RESCHEDULED` keeps the same row and notifies

**Participation** (one per student per drive)
`INVITED` → `OPTED_IN` | `OPTED_OUT` | `EXPIRED` (deadline passed)
`OPTED_IN` → `ACTIVE` → `ELIMINATED` (at round N) | `SELECTED` → `OFFERED` → `PLACED` | `OFFER_DECLINED`
`ACTIVE` → `NO_SHOW` (missed round) → penalty per policy

**Round result per student**
`PENDING` → `SELECTED` | `REJECTED` | `ON_HOLD` → (published) visible to the student

**Queue entry**
`WAITING` → `CALLED` → `IN_INTERVIEW` → `DONE`
`CALLED` → `SKIPPED` (moved to end, back to `WAITING`) · after N skips → `ABSENT`

**Feedback (student-facing remark)**
`DRAFT` → `PENDING_REVIEW` → `RELEASED` | `EDITED_AND_RELEASED` | `WITHHELD`

**Offer**
`UPLOADED` → `SENT` → `ACCEPTED` | `DECLINED` | `EXPIRED` · `REVOKED` (company, with TPO approval)

**Webhook delivery**
`PENDING` → `DELIVERED` | `RETRYING` → `FAILED` (after N tries) · endpoint auto-disabled after many failures

---

## 4. Document reconciliation & verification (the hardest part)

### The problem
A student's academic data can come from **three places**, and they may disagree:
1. **What the student typed** (CGPA, backlogs, 10th/12th %)
2. **What the uploaded document says** (marksheet PDF/photo)
3. **What the university sheet says** (official CSV, if we get it)

Plus: one document might be used by two students; a student might upload an edited PDF; CGPA changes every semester.

### Approach
**A. Source of truth order:** official CSV > TPO-checked document > student-typed value. The *verified* value is what eligibility uses, never the raw typed value.

**B. Matching (when an official CSV is imported):**
1. Upload CSV → **map columns** (their column names are unknown, so the TPO maps them once and the mapping is saved for next time).
2. Rows go into a **staging table** first. Nothing changes in student profiles yet.
3. Match each row to a profile by **roll number** (normalised: upper-case, no spaces).
4. Compare fields:
   - Name: normalised (case, extra spaces, dots, initials) → `MATCH` / `CLOSE` / `DIFFERENT`
   - CGPA: equal within ±0.01
   - Backlogs, branch, batch: exact
5. Each row gets a result: `MATCHED`, `MISMATCH (fields…)`, `NOT_REGISTERED` (in CSV, no account), `NOT_IN_SHEET` (account, not in CSV).
6. TPO sees a **preview with counts** and a side-by-side view for mismatches → **apply**: all `MATCHED` are verified in one click; mismatches are resolved one by one.
7. Re-importing the same file is safe (file hash stored; same row = no double change).

**C. Without the official CSV:** the TPO/coordinator sees the typed values **next to the uploaded document** and clicks verify/reject with a reason. A queue screen sorted by oldest first, with branch filters, so coordinators can split the work.

**D. Reading documents automatically (optional, P2):**
- If the marksheet is a **digital PDF**, extract its text and pre-fill/compare the values.
- Scanned photos → OCR (e.g. Tesseract). It is unreliable for varied formats, so **use it only as a hint** that highlights differences. **Never auto-verify from OCR alone.**

**E. Anti-cheating checks:**
- Store a **file hash** for every upload. The same file uploaded by two different students → flag both.
- Keep every version of a document. A verification is tied to the exact document version and field values it checked.
- Academic fields are locked after verification; changes go through an update request.
- Every verify/reject is in the audit log, with who did it and why.

**F. Other documents:**
- **Company JD / registration:** TPO checks; the email OTP proves the HR owns the email.
- **Offer letters:** uploaded only by that company's verified HR account and tied to that drive + student. The student can see who uploaded it and when.

---

## 4b. Review team: splitting human verification work

Verification is **human in the loop**: the system matches, flags and sorts, while people decide. With 1–3k students, the TPO alone can't check everything, so the work is spread across **TPO staff** and **student volunteers**.

### Who is on the review team
| Role | Who | What they can decide |
|---|---|---|
| **TPO (officer)** | Head of the placement cell | Everything; manages the team; final say on disputes |
| **TPO staff** | Placement office employees | First and second-level checks, import mismatches, high-risk cases |
| **Volunteer** | Student coordinators | **First-level check only** on low/medium-risk items; drive-day help (attendance, queue) if given |

Permissions are **capabilities** attached to a person, not fixed by role, so the TPO can give exactly what's needed:
`verify.first` · `verify.final` · `import.resolve` · `update_request.decide` · `drive.attendance` · `drive.queue` · `feedback.review` (TPO only) · `team.manage` (TPO only)

### Onboarding the team
1. The TPO invites a person by email → role template (staff / volunteer) + capabilities + **scope** (which branches/batches they may handle) + **end date** (volunteers: end of semester by default).
2. The person accepts the invite and sets a password (same invite flow as HR).
3. On first login: a short **guide** (what to check, common rejection reasons, examples) + **accept a confidentiality pledge** (stored with date). Tasks unlock only after both.
4. *(P2)* 3–5 **practice tasks** with known answers before real work.
5. The TPO can pause or remove anyone at any time. Access ends automatically at the end date.

### Work items (tasks)
Every piece of human work becomes a **task** in one shared work queue:

| Task type | Created when | Risk | Who can take it |
|---|---|---|---|
| New profile verification | Student submits profile + documents | Low/Medium | Volunteer or staff (first check) |
| CSV mismatch | Import row doesn't match the profile | High | Staff only |
| Not in sheet / not registered | Import finds no pair | Medium | Staff |
| Academic update request | Student asks to change CGPA/backlogs | High | Staff only |
| Duplicate document | Same file hash used by 2+ students | High | Staff only |
| Second check | A first-level decision needs confirming (see below) | n/a | Staff, never the same person |
| Escalation | A reviewer isn't sure | n/a | Staff or TPO |
| Feedback review | Interviewer remark for a student | n/a | TPO only |

**Risk is decided by the system:** a CSV row that matches exactly is auto-verified with **no human task** (only spot checks). A CGPA jump > 0.5, a name mismatch, a duplicate file or an edited-looking PDF flag is high risk.

### How work is handed out: "Get next task" (pull, not push)
- A reviewer presses **Get next task**. The system gives them the **highest-priority task they are allowed to do** (by capability + scope) and **locks it to them for 15 minutes**.
- Not finished in 15 min → the lock expires and the task goes back to the queue. They can also **release** or **escalate** it.
- Two people can never get the same task. The DB picks it with a row lock that skips locked rows (`FOR UPDATE SKIP LOCKED`).
- No one can pick their own profile, and **volunteers can't pick students from their own batch + branch** (conflict of interest; configurable).
- The TPO can also **assign** tasks to a specific person or **re-assign** them.

**Priority order:**
1. Students invited to a drive whose opt-in deadline is near (they'll miss the drive otherwise)
2. Escalations and second checks
3. High-risk items
4. Everything else, oldest first

Each task shows its age; tasks older than 48 h are highlighted on the TPO dashboard.

### Two-level checking (maker–checker)
- **High-risk items** always need two different people: first check + final check by staff.
- **Volunteer approvals** are spot-checked: **every** approval for a new volunteer's first 20 tasks, then a random **10%**.
- **Rejections** by volunteers always go to staff (a wrong rejection can make a student miss drives).
- If the second checker disagrees, the item goes to the TPO; the first reviewer sees the outcome (learning loop).

### What a reviewer sees (data minimisation)
- **Shown:** name, roll number, branch, batch, the academic values typed, the documents, the official sheet values (if any), the system's flags.
- **Hidden from volunteers:** phone, email, address, resume, other drives, offers.
- The document viewer shows a **light watermark with the reviewer's name**, to discourage screenshots.
- Every open and every decision is in the audit log.

### Making a decision
- Buttons: **Verify** · **Reject** (pick a standard reason + optional note, e.g. "Marksheet unclear", "CGPA doesn't match marksheet", "Wrong semester uploaded") · **Escalate** (with a question).
- The student sees the reason and what to fix, never the reviewer's name.

### Task states
`OPEN` → `CLAIMED` (lock, 15 min) → `DECIDED` → (if a second check is needed) `AWAITING_SECOND_CHECK` → `CLOSED`
`CLAIMED` → `OPEN` (lock expired / released) · any → `ESCALATED` → `CLAIMED` (by staff/TPO) · `CLOSED` → `REOPENED` (TPO only)

### TPO dashboard for the team
- Queue size per task type, oldest waiting task, tasks due because of upcoming drives
- Per reviewer: tasks done today/week, average time, **overturn rate** (how often second checks disagree)
- A reviewer with a high overturn rate is auto-moved back to "all approvals checked"
- Bulk tools: assign a branch to a person, pause the queue, re-open a batch

### Routes for this (added to section 9)
| Method | Route | Who | Purpose |
|---|---|---|---|
| GET/POST | `/admin/team` | T | List / invite staff and volunteers (role, capabilities, scope, end date) |
| PATCH | `/admin/team/:userId` | T | Change capabilities / scope / end date, pause |
| DELETE | `/admin/team/:userId` | T | Remove access |
| GET | `/work/onboarding` | staff, volunteer | Guide + pledge status |
| POST | `/work/onboarding/pledge` | staff, volunteer | Accept pledge |
| GET | `/work/summary` | staff, volunteer | My counts + what's waiting for me |
| POST | `/work/next` | staff, volunteer | Claim the next allowed task (lock 15 min) |
| GET | `/work/tasks/:id` | claimer, T | Task details (minimised data + documents) |
| POST | `/work/tasks/:id/decision` | claimer | Verify / reject (reason) |
| POST | `/work/tasks/:id/escalate` | claimer | Send up with a question |
| POST | `/work/tasks/:id/release` | claimer | Give back |
| POST | `/work/tasks/:id/extend` | claimer | Extend the lock once |
| GET | `/admin/work/tasks` | T | All tasks with filters |
| POST | `/admin/work/tasks/:id/assign` | T | Assign / re-assign |
| POST | `/admin/work/tasks/:id/reopen` | T | Re-open a closed task |
| GET | `/admin/work/stats` | T | Team dashboard numbers |

### Events
`task.created` · `task.claimed` · `task.decided` · `task.escalated` · `task.second_check_disagreed` · `team.member_invited` · `team.member_removed`

---

## 4c. Is the HR really from that company? (company identity checks)

**Goal:** catch fake companies and fake HRs (fake job/fee scams are common), while keeping real companies' onboarding quick. **The machine collects evidence; a person decides.** Nothing is auto-approved on the first visit.

### Layer 1: at registration (instant, in the API)
- Official email confirmed with an OTP.
- Ask for a **CIN** (company registration number, from MCA) and/or **GSTIN**, plus the company's **official phone number** and website.
- Free/disposable email domains (gmail, yahoo, temp-mail lists) are flagged right away.

### Layer 2: automatic background check (heavy job, `company-check` queue)
Runs right after the OTP and produces a **trust report** (flags + a score), never a decision.

| Check | How | Flag if |
|---|---|---|
| Email domain = website domain | Compare after removing `www.` (allow a listed parent/subsidiary domain) | Different domains |
| Domain exists and gets mail | DNS lookup + MX records | No MX / doesn't resolve |
| Domain age | Public RDAP lookup (free WHOIS replacement) | Registered < 6 months ago |
| HTTPS | Certificate valid for the domain | Invalid / missing |
| **Website crawl** | Fetch at most ~5 pages (home, about, careers, contact), obeying `robots.txt`, with a timeout and size limit | Company name on the site doesn't match the form; no contact/careers page; site is a parked/empty page |
| Phone match | Is the phone number given in the form also listed on the official site? | Not found (TPO verifies by calling) |
| Lookalike domain | Compare with domains of companies we already know (e.g. `infosys-careers.co` vs `infosys.com`) | Close but not equal |
| Scam words in the JD | Look for "registration fee", "security deposit", "pay", "WhatsApp only", etc. | Any match → **high risk** |
| Known company | Same domain as an already-verified company | Then it's a **new HR of a known company** → different flow (below) |

**Crawler safety (important):** the crawler visits URLs that outsiders typed in, so it could be tricked into hitting our own servers. Rules: only `http/https`; resolve DNS first and **block private/internal IPs** (10.x, 192.168.x, 127.x, 169.254.x cloud metadata, etc.); max 3 redirects, re-checking each; 5 s timeout; 2 MB per page; text only, no running scripts; generic user agent `Cyrus-Verifier`; runs in the worker, never in the API.

**What we don't automate:** LinkedIn scraping (against their terms) and the GST/MCA portals behind CAPTCHAs (we never bypass CAPTCHAs). For those, the trust report shows **one-click links** to the official MCA/GST search pages with the CIN/GSTIN pre-copied, and staff checks by hand.

### Layer 3: human review (a task in the review queue, section 4b)
- Staff see the trust report next to the form: green checks, red flags, crawl snippets, links.
- **Low risk** (domain matches, old domain, site OK, known company type): one staff approval.
- **Medium/high risk:** a **call-back check**: staff calls the number **listed on the company's official website** (never the number from the form) and confirms the HR person works there. Result + notes are recorded.
- **Any scam-word flag or lookalike domain:** TPO decides.

### Layer 4: after approval (continuous)
- HR can only create drives; **every drive still needs TPO approval** before students see it.
- **New HR from an already-verified company:** must use the same company email domain **and** be invited by an existing HR of that company, or go through staff review again.
- Students can **report a company** ("asked me for money", etc.) → creates a high-priority task; the TPO can freeze the company instantly (its drives are hidden).
- HR accounts expire after the drive closes (re-activated for the next drive).
- Every check, decision and call is in the audit log.

### States
`PENDING_EMAIL` → `PENDING_CHECKS` (job running) → `IN_REVIEW` → `APPROVED` | `REJECTED` | `NEEDS_INFO` · after approval → `FROZEN` (reported) → `APPROVED` | `BANNED`

### Routes
| Method | Route | Who | Weight |
|---|---|---|---|
| POST | `/admin/company-requests/:id/checks/run` | T, staff | Heavy (re-run checks) |
| GET | `/admin/company-requests/:id/checks` | T, staff | Light (read the trust report) |
| POST | `/admin/company-requests/:id/callback` | T, staff | Light (record call result) |
| POST | `/companies/:id/report` | S | Light + background (creates a task, notifies the TPO) |
| POST | `/admin/companies/:id/freeze` / `unfreeze` / `ban` | T | Light + background (hides drives, notifies) |

---

## 5. Webhooks (for future teams, e.g. WhatsApp/Telegram notifications)

### Idea
Cyrus doesn't send WhatsApp messages itself. It **announces events**. Another team's service subscribes and sends WhatsApp/Telegram/SMS. Our own push/email notifications are just the first subscriber of the same events.

### Design
- **Event catalogue (versioned):** `drive.published`, `drive.invited`, `participation.opted_in`, `round.scheduled`, `round.updated`, `round.results_published`, `queue.your_turn_soon`, `queue.called`, `drive.final_results_published`, `offer.uploaded`, `announcement.created`, …
- **Subscriptions** (managed by the TPO in admin): target URL (HTTPS only), chosen events, a secret, active on/off.
- **Delivery:**
  - JSON body: `{ id, type, version, created_at, data }`
  - Signed with HMAC-SHA256 using the subscription secret (header `X-Cyrus-Signature`) + timestamp header, so the receiver can verify the message is really from us and isn't replayed
  - `id` is unique → receivers can ignore duplicates
  - Retries with growing delays (1m, 5m, 30m, 2h, 12h), then `FAILED`; endpoint auto-disabled after many failures; TPO can re-send
  - Delivery log visible in admin (status, response code, time)
- **Privacy:**
  - Payloads carry the minimum data (IDs + what the message needs).
  - **Phone numbers are included only for students who turned on "notify me on WhatsApp"** in their settings (consent stored with date).
  - Each subscription gets only the event types the TPO approved for it.
- **Test button:** sends a sample `ping` event.
- Later: an incoming-webhook endpoint for delivery receipts from the WhatsApp team (optional).

---

## 5b. Push notifications to phones (Tauri)

**The gap:** Tauri's official `notification` plugin only shows **local** notifications (made by the app while it is running). Push from our server to a phone where the app is in the background or closed needs **FCM** on Android (and APNs on iOS). Tauri has no official plugin for that.

**Plain fact about Android:** reliable background push on Android goes through FCM (Google Play services). Running our own always-on connection instead needs a permanent foreground service with a visible notification, drains battery, and Android may still kill it. So "our own push" means **our own Tauri plugin on top of FCM**, plus our own server sending through FCM. It doesn't mean replacing FCM.

### Option A: third-party plugins (fast start)
| Plugin | What it gives | Concern |
|---|---|---|
| `tauri-plugin-remote-push` (crates.io, 1.0.x) | FCM (Android) + APNs (iOS), get token, permission, foreground messages, token refresh | A review lists **background message handling** as a limitation |
| `tauri-plugin-mobile-push` (GitHub, git dependency) | FCM + APNs, token, forwards messages and token refresh to Tauri events | Installed from git; check activity and license |
| `tauri-plugin-notifications` (0.4.x) | System notifications + push via FCM/APNs | Docs thin; check before relying on it |

Use one of these for the **Week 1 test** to prove FCM tokens and delivery work on our phones.

### Option B: our own plugin `tauri-plugin-cyrus-push` (recommended for the real app)
Small, and we control what matters on drive day: channels, tapping a notification to open the right screen, behaviour when the app is closed.

**Where:** `packages/tauri-plugin-cyrus-push/` (Rust crate + `android/` Kotlin library + `guest-js/` TypeScript API; `ios/` Swift later).

**Android part (Kotlin):**
- `PushPlugin` (`@TauriPlugin`, extends `Plugin`). Commands:
  - `requestPermission()`: asks for the Android 13+ `POST_NOTIFICATIONS` permission
  - `getToken()`: returns the FCM token
  - `deleteToken()`: used on logout
  - `getLaunchNotification()`: which notification opened the app, if any
- Events to JavaScript (via `trigger`): `token-refreshed`, `message-received` (app in foreground), `notification-opened` (user tapped a notification → open `data.link`, e.g. `/me/queue`).
- `CyrusMessagingService` (extends `FirebaseMessagingService`, registered in the plugin's manifest):
  - `onNewToken`: saves the token locally and fires `token-refreshed` when the app is open, so the app re-registers it with `POST /me/devices`.
  - `onMessageReceived`: app in foreground → send to JS (the app shows an in-app banner). App in background → **build the notification ourselves** with `NotificationCompat`, on the right channel, with a tap action that carries the link.
- **Notification channels** (users can tune each in Android settings):
  - `queue`: high importance, sound. "Your turn in 2", "You are called".
  - `drives`: default. Shortlists, round changes, results.
  - `offers`: high. Offer uploaded.
  - `general`: low. Announcements.
- The server sends **data-only** messages, so our service always decides how they look. "Called now" messages use FCM high priority; everything else uses normal priority.
- Limits to accept: if the user **force-stops** the app, Android delivers nothing until it's opened again. Some phone brands kill background apps aggressively, so the in-app list and email remain the fallback.

**JS API (`guest-js`):** `requestPermission()`, `getToken()`, `onTokenRefreshed(cb)`, `onMessage(cb)`, `onNotificationOpened(cb)`.

**Desktop (Windows) build:** there is no FCM. While the app is open, the realtime socket delivers events and the official `notification` plugin shows them locally. When the app is closed: email.

**iOS:** needs an Apple developer account (paid) for APNs. Out of scope for now; the plugin keeps an `ios/` folder for later.

### Server side (notify worker)
- `Device` table: user, platform (`android`/`desktop`/`web`), FCM token, app version, last seen. Registered by `POST /me/devices`, removed on logout.
- The `notify` worker sends through the **FCM HTTP v1 API** with a Firebase service account. The service-account JSON is a secret: its path goes in `.env`, and the file itself is never committed.
- Tokens that FCM reports as `UNREGISTERED` or invalid are deleted automatically.
- Each push also creates an **in-app notification row**, so nothing is lost if the push doesn't arrive. Quiet hours and per-channel settings are checked before sending.
- Email fallback for important events (offers, results) if the user has no active device.

### Steps
1. **Setup (one time):** set `ANDROID_HOME` / `NDK_HOME` (the SDK and NDK are already installed under `%LOCALAPPDATA%\Android\Sdk`), add the Rust Android targets, run `tauri android init`, and create a Firebase project to get `google-services.json`. **The user creates the Firebase project.**
2. **Week 1 test with Option A:** get a token on a real phone, send a test push from the server, and check foreground, background and closed-app behaviour.
3. **Build Option B** (about 3–4 days) in Week 3, alongside notifications. Read an existing plugin's source for reference, but write ours ourselves. Check its license before borrowing any idea that is more than general knowledge.

---

## 6. REST vs GraphQL

**Proposal: REST** (`/api/v1/...`) with an **OpenAPI spec** generated from the route schemas.

| | REST | GraphQL |
|---|---|---|
| Role/ownership checks | Per route, simple and easy to test | Per field/resolver, easy to miss one and leak data (e.g. student phone to HR before opt-in) |
| File uploads (marksheets, offers) | Normal multipart | Needs extra spec/libraries |
| Caching | HTTP caching + simple Redis keys | Harder (one endpoint, many query shapes) |
| Outside teams/webhooks | Everyone knows REST; OpenAPI gives them docs | Extra learning |
| Our screens | Known and fixed, so the "fetch exactly what you need" benefit is small | Shines with many different clients |
| Abuse protection | Rate limit per route | Needs query depth/cost limits |

Live updates: **Socket.io** (rooms per panel queue, per drive, per user).
API docs: Swagger UI at `/api/docs` (dev only).

---

## 7. Caching

**Rule:** cache only data that is read often, changes rarely, and is the same for many users. Remove the cache entry on the related event (e.g. `drive.updated` → delete `drive:{id}`).

| Data | Cache? | How |
|---|---|---|
| Public company pages, past-year data, FAQs, placement stats | Yes | Redis, 10–60 min + delete on change; HTTP `ETag` |
| Drive details (published) | Yes | Redis per drive, delete on `drive.updated` / `round.updated` |
| TPO policies | Yes | Small, read on every eligibility check; delete on update |
| Dashboard counts | Yes | Redis 1–5 min |
| Eligibility preview for HR | Short | Key = drive + filter hash, 1–2 min |
| **Live queue** | Not a cache: **Redis holds the live state**, Postgres keeps the permanent record | Socket.io pushes changes; position/ETA computed in Redis |
| Rotating QR codes | Redis with a 10–30 s expiry | Never in the DB |
| OTP codes, rate-limit counters | Redis with expiry | |
| Per-student data (profile, results, offers) | **No** | Personal and permission-dependent; Postgres is fast enough |
| Unpublished results, private notes | **Never** | |

If Redis is down, cached reads fall back to the DB (slower but working). Queue and QR need Redis, so the realtime and attendance health checks report it.

---

## 8. How endpoints are served

- **Express + TypeScript.** Every route is written with `defineRoute()`: it declares its weight class and its zod request/response schemas → the same schemas drive validation, the OpenAPI doc and the TS types.
- **Request pipeline:** rate limit → auth (JWT access token, 15 min; refresh token in an httpOnly cookie for web / secure storage for Tauri) → role check → **ownership check** (company/drive/panel scope) → handler → service function (business rules + state transition) → response.
- **Reverse proxy** (Caddy or Nginx): HTTPS, gzip, request size limits, serves the React build.
- **Files:** uploaded through the API (type + size checked, hash stored) to private storage; downloads only through `GET /files/:id/link`, which checks permission and returns a link valid for ~2 minutes.
- **Consistent errors:** `{ error: { code, message, details } }` with proper status codes.
- **Pagination** on every list (`?cursor=&limit=`), filters as query params.
- **Idempotency key** header on risky POSTs (check-in, results publish, offer upload) so double taps don't double-apply.
- **Health:** `/health` (process alive), `/ready` (DB + Redis reachable), used by Docker/k8s.
- **Logs:** structured JSON logs with a request ID, passed into events/jobs so one action can be traced end to end.

---

## 9. Route list (first brainstorm)

Prefix: `/api/v1`. Role legend: **P** public · **S** student · **H** company HR · **I** interviewer · **C** coordinator · **T** TPO. "Own" = only within their company/drive/panel.

### 9.1 Auth & account
| Method | Route | Who | Purpose |
|---|---|---|---|
| POST | `/auth/student/signup` | P | Roll no + email + password → sends OTP |
| POST | `/auth/student/verify-email` | P | Verify signup code and sign in *(built)* |
| POST | `/auth/student/resend-code` | P | Resend signup code (rate limited, same answer for unknown emails) *(built)* |
| POST | `/auth/login` | P | Email + password → tokens |
| POST | `/auth/refresh` | P | New access token |
| POST | `/auth/logout` | any | Revoke refresh token |
| POST | `/auth/password/forgot` | P | Send reset link |
| POST | `/auth/password/reset` | P | Set new password with token |
| GET | `/auth/invites/:token` | P | Check an invite link (who/which company) |
| POST | `/auth/invites/:token/accept` | P | HR/interviewer/coordinator sets password |
| GET | `/me` | any | Current user, role, scopes |
| PATCH | `/me/password` | any | Change password |

### 9.2 Company portal (public) & company admin
| Method | Route | Who | Purpose |
|---|---|---|---|
| POST | `/public/company-requests` | P | Register company + HR + first JD (with JD file) |
| POST | `/public/company-requests/:id/verify-email` | P | OTP for the official email |
| PATCH | `/public/company-requests/:id` | P (token) | Update after "needs info" |
| GET | `/public/stats` | P | Landing page numbers |
| GET | `/admin/company-requests` | T | List by status |
| GET | `/admin/company-requests/:id` | T | Details + files |
| POST | `/admin/company-requests/:id/approve` | T | Approve → create company + send HR invite |
| POST | `/admin/company-requests/:id/reject` | T | Reject with reason |
| POST | `/admin/company-requests/:id/request-info` | T | Ask for more details |
| GET/POST | `/admin/companies` | T | List / create directly (TPO fallback) |
| GET/PATCH | `/admin/companies/:id` | T | View / edit |
| POST | `/admin/companies/:id/deactivate` | T | Disable company + its HR logins |
| GET/PATCH | `/company/profile` | H | Own company profile |
| GET | `/company/team` | H | HR + interviewers |
| POST | `/company/team/invites` | H | Invite interviewer |
| DELETE | `/company/team/:userId` | H | Remove member |

### 9.3 Students & verification
| Method | Route | Who | Purpose |
|---|---|---|---|
| GET/PATCH | `/students/me` | S | Profile (academic fields locked after verification) |
| POST | `/students/me/documents` | S | Upload marksheet/resume |
| GET | `/students/me/documents` | S | Own documents + status |
| DELETE | `/students/me/documents/:id` | S | Only before verification |
| POST | `/students/me/submit` | S | Send profile for verification |
| POST/GET | `/students/me/update-requests` | S | Ask to change CGPA/backlogs |
| GET | `/admin/students` | T, C | Filter by status/branch/batch |
| GET | `/admin/students/:id` | T, C | Profile + documents + history |
| POST | `/admin/students/:id/verify` | T, C | Verify |
| POST | `/admin/students/:id/reject` | T, C | Reject with reason |
| POST | `/admin/students/:id/reset-account` | T | Roll number conflict fix |
| POST | `/admin/students/:id/block` / `unblock` | T | No-show / misuse |
| GET | `/admin/update-requests` | T, C | Pending changes |
| POST | `/admin/update-requests/:id/approve` / `reject` | T, C | Decide |

### 9.4 Official sheet import & matching
| Method | Route | Who | Purpose |
|---|---|---|---|
| POST | `/admin/imports` | T | Upload CSV → job |
| GET | `/admin/imports/:id` | T | Status + counts |
| PUT | `/admin/imports/:id/mapping` | T | Map columns |
| GET | `/admin/imports/:id/rows` | T | Rows by result (matched / mismatch / …) |
| POST | `/admin/imports/:id/rows/:rowId/resolve` | T | Accept sheet value / keep profile / reject |
| POST | `/admin/imports/:id/apply` | T | Verify all matched |

### 9.5 Policies
| GET/PUT | `/admin/policies` | T | One-offer rule, no-show penalties, defaults |

### 9.6 Drives, rounds, approval
| Method | Route | Who | Purpose |
|---|---|---|---|
| POST | `/drives` | H (own), T | Create draft |
| GET | `/drives` | H (own), T, C (assigned) | List with filters |
| GET | `/drives/:id` | H (own), T, C | Details |
| PATCH | `/drives/:id` | H (own), T | Edit (limited fields after publish; changes notify students) |
| DELETE | `/drives/:id` | H (own) | Only drafts |
| POST | `/drives/:id/submit` | H (own) | Send for TPO approval |
| POST | `/admin/drives/:id/approve` / `reject` | T | Decide |
| POST | `/admin/drives/:id/cancel` | T | Cancel |
| POST | `/admin/drives/:id/close` | T | Close → HR read-only, history saved |
| POST | `/admin/drives/:id/coordinators` | T | Assign coordinators |
| POST | `/drives/:id/rounds` | H (own), T | Add round |
| PATCH/DELETE | `/rounds/:id` | H (own), T | Edit / remove (before start) |
| POST | `/drives/:id/rounds/reorder` | H (own), T | Change order |
| POST | `/drives/:id/announcements` | H (own), T, C | Message to participants |

### 9.7 Eligibility, invitations, opt-in
| Method | Route | Who | Purpose |
|---|---|---|---|
| POST | `/drives/:id/eligibility/preview` | H (own), T | Filters → count + limited-field list (within TPO policy) |
| POST | `/drives/:id/invitations` | H (own), T | Mark students eligible (list or filter) → notify |
| GET | `/drives/:id/invitations` | H (own), T | Who was invited + their response |
| DELETE | `/drives/:id/invitations/:studentId` | H (own), T | Remove before the deadline |
| GET | `/me/drives` | S | Invited / active / past |
| GET | `/me/drives/:id` | S | Drive + rounds + my status |
| POST | `/me/drives/:id/opt-in` | S | Opt in (consent recorded) |
| POST | `/me/drives/:id/opt-out` | S | Opt out |
| GET | `/drives/:id/participants` | H (own), T, C | Opted-in list (full profile + resume link now allowed) |

### 9.8 Attendance
| Method | Route | Who | Purpose |
|---|---|---|---|
| POST | `/rounds/:id/attendance/sessions` | H, C, T | Open check-in (venue location + radius) |
| POST | `/attendance/sessions/:sid/close` | H, C, T | Close check-in |
| (socket) | `attendance:qr` | H, C, T | Rotating QR value pushed every ~15 s |
| POST | `/attendance/check-in` | S | QR value + location → marked |
| POST | `/rounds/:id/attendance/manual` | C, T | Mark by hand with reason |
| GET | `/rounds/:id/attendance` | H (own), C, T | Present/absent list |

### 9.9 Results
| Method | Route | Who | Purpose |
|---|---|---|---|
| PUT | `/rounds/:id/results` | H (own), T | Set results (bulk) |
| POST | `/rounds/:id/results/import` | H (own), T | CSV from external test platform |
| POST | `/rounds/:id/results/publish` | H (own), T | Publish → notify; eliminated students marked |
| GET | `/rounds/:id/results` | H (own), T | All results |
| GET | `/me/rounds/:id/result` | S | Own result (after publish) |
| GET | `/drives/:id/selected-list` | S (participant) | Only if the TPO enabled the public list |

### 9.10 Panels, queue, interviews
| Method | Route | Who | Purpose |
|---|---|---|---|
| POST | `/rounds/:id/panels` | H (own), T | Create panel, assign interviewers |
| PATCH/DELETE | `/panels/:id` | H (own), T | Edit / remove |
| POST | `/rounds/:id/queue/build` | H (own), T | Fill queues from the shortlist (auto-split or manual) |
| GET | `/panels/:id/queue` | I (own panel), H, C, T | Live queue |
| POST | `/panels/:id/queue/call-next` | I, C | Call next student |
| POST | `/queue-entries/:id/skip` | I, C | Move to the end |
| POST | `/queue-entries/:id/start` | I | Start interview (creates session) |
| POST | `/interviews/:id/end` | I | End interview |
| PUT | `/interviews/:id/notes` | I, H | Private notes |
| PUT | `/interviews/:id/recommendation` | I | Select / reject / hold suggestion |
| PUT | `/interviews/:id/feedback` | I, H | Student-facing remark → goes to TPO review |
| GET | `/me/queue` | S | My panel, position, estimated wait (+ socket updates) |
| GET | `/admin/feedback` | T | Remarks waiting for review |
| POST | `/admin/feedback/:id/release` / `withhold` | T | Release (optionally edited) or hold back |

### 9.11 Final results & offers
| Method | Route | Who | Purpose |
|---|---|---|---|
| POST | `/drives/:id/final-results` | H (own), T | Publish final selections |
| POST | `/drives/:id/offers` | H (own), T | Upload offer letter for a student |
| GET | `/drives/:id/offers` | H (own), T | Offer status list |
| GET | `/me/offers` | S | My offers |
| POST | `/me/offers/:id/accept` / `decline` | S | Respond before the deadline |
| POST | `/offers/:id/revoke` | H (own) + T approval | Rare case |

### 9.12 Files
| POST | `/files` | auth | Upload (type/size check, hash) |
| GET | `/files/:id/link` | permission-checked | Short-lived download link |

### 9.13 Notifications & devices
| Method | Route | Who | Purpose |
|---|---|---|---|
| GET | `/me/notifications` | any | In-app list |
| POST | `/me/notifications/:id/read`, `/me/notifications/read-all` | any | Mark read |
| POST/DELETE | `/me/devices` | any | Register / remove FCM token |
| GET/PATCH | `/me/notification-settings` | any | Channels, incl. WhatsApp consent |
| POST/GET | `/admin/announcements` | T | College-wide announcements |

### 9.14 Webhooks (integration)
| Method | Route | Who | Purpose |
|---|---|---|---|
| GET | `/admin/webhooks/event-types` | T | Catalogue + sample payloads |
| GET/POST | `/admin/webhooks` | T | List / create subscription |
| PATCH/DELETE | `/admin/webhooks/:id` | T | Edit / remove |
| POST | `/admin/webhooks/:id/rotate-secret` | T | New secret |
| POST | `/admin/webhooks/:id/test` | T | Send ping |
| GET | `/admin/webhooks/:id/deliveries` | T | Delivery log |
| POST | `/admin/webhooks/deliveries/:id/retry` | T | Re-send |

### 9.15 Data platform
| Method | Route | Who | Purpose |
|---|---|---|---|
| GET | `/companies` / `/companies/:id` | S, T | Company pages |
| GET | `/companies/:id/history` | S, T | Past drives, rounds, selections, CTC |
| GET/POST | `/companies/:id/faqs` | S read · T, senior write | FAQs |
| GET | `/stats/placements` | S, T | By department / year |
| GET | `/seniors` | S | Placed seniors (contact only with consent) |
| GET/PATCH | `/me/senior-profile` | senior | Profile + consent |
| POST | `/admin/history-imports` | T | Old records from sheets |

### 9.16 Admin, audit, exports, health
| Method | Route | Who | Purpose |
|---|---|---|---|
| POST | `/admin/coordinators/invites` | T | Invite coordinator |
| GET | `/admin/users` | T | All users, filter by role |
| GET | `/admin/audit-logs` | T | Filter by entity / user / date |
| GET | `/admin/dashboard` | T | Counts |
| POST | `/exports` | T, H (own), S (own) | Request a report → job |
| GET | `/exports/:id` | owner | Status + download link |
| GET | `/jobs/:id` | owner, T | Any background job: status, progress, result / error (section 2b) |
| GET | `/jobs` | owner, T | My recent jobs |
| DELETE | `/jobs/:id` | owner, T | Cancel a long job |
| GET | `/health`, `/ready` | P / internal | Health checks |

### 9.17 Route weight classes
Every route belongs to exactly one class. The full sorted list lives in the **review page** (artifact), which is filtered by class.

| Class | Meaning | Runs in | Target time |
|---|---|---|---|
| **Light** | Normal reads/writes, one transaction | API | < 300 ms |
| **Hot** | Drive-day critical (check-in, queue, live position). Highest capacity, extra rate limits, tested under load | API + realtime | < 100 ms |
| **Light + background** | The change is saved at once; the slow follow-ups (notifying hundreds of students, webhooks) run as jobs | API, then workers | < 300 ms for the request |
| **Heavy** | The work itself is slow (files, crawling, OCR, exports). Returns `202 + jobId` | Workers | seconds–minutes |

### Socket.io rooms
`user:{id}` (personal updates) · `drive:{id}` (announcements, round changes) · `panel:{id}` (queue for interviewers + waiting students) · `attendance:{sessionId}` (rotating QR for the venue screen)

---

## 10. Events (internal, also the webhook catalogue)
`company.request_submitted` · `company.approved` · `company.rejected` · `invite.sent` · `student.submitted` · `student.verified` · `student.rejected` · `import.completed` · `drive.submitted` · `drive.published` · `drive.updated` · `drive.invited` · `participation.opted_in` · `participation.opted_out` · `round.scheduled` · `round.updated` · `attendance.marked` · `round.results_published` · `queue.updated` · `queue.your_turn_soon` · `queue.called` · `interview.started` · `interview.ended` · `feedback.released` · `drive.final_results_published` · `offer.uploaded` · `offer.accepted` · `offer.declined` · `drive.closed` · `announcement.created`

---

## 11. "Subagents": two possible meanings

**A. Background workers in our system** → covered in section 2 (notify, webhooks, documents, reports workers).

**B. Using Claude Code subagents while building:**
- Good for: researching a library/plugin (e.g. the Tauri push test), reviewing a finished module, writing tests for a module, scanning the codebase for missing permission checks.
- Not good for: two agents editing the same files at once. Shared code (Prisma schema, auth, state-machine helpers) is written in one place, one at a time.
- Workflow idea: build a module → subagent writes/extends its tests → a review pass (`/code-review`) → fix → next module.
- Bigger independent pieces (e.g. the mobile app vs the backend) can run as separate sessions on separate branches.

---

## 11b. Other things to settle before building

**Law & privacy**
- India's **DPDP Act 2023** (personal data law): a clear purpose for each data field, consent records (opt-in already is one), the right to see/correct/delete data, and a breach plan.
- **Retention:** how long we keep marksheets, resumes, rejected company requests and audit logs (e.g. documents deleted 1 year after the student graduates; anonymised stats kept).
- A privacy notice + terms for students, companies and volunteers.

**Accounts & roles**
- **One person, several roles:** a student volunteer is also a student; a TPO staff member may be an interviewer. Allow multiple roles per account with a role switcher, and block self-conflicts (never verify yourself).
- **2-step login (authenticator app) for TPO and staff**, since they can change everything.
- Account recovery for the TPO (what if the only TPO account is locked?).
- HR leaving the company mid-drive → the TPO moves the drive to another HR of the same company.

**Drive-day reality**
- **Weak network at the venue:** the QR check-in should work with a short offline grace (the scan is stored and sent when the network returns, within a limit). The coordinator's manual list is the fallback.
- **Fake GPS apps** on Android: location alone can't be trusted. The rotating QR + being physically in the room are the real check; location is an extra signal.
- Phone clocks can be wrong → all times are decided by the server.
- Several drives on the same day, a student in two of them (clash detection when scheduling rounds).

**Files & security**
- **Virus scan** of every uploaded file (e.g. ClamAV) as a heavy job before anyone opens it.
- PDF/image only, size limits, file type checked by content, not by name.
- Secrets in environment variables, never in git; separate secrets per environment.
- Daily **database backups** + a tested restore.

**Notifications**
- Quiet hours (no non-urgent pushes at night), and limits so HR can't spam students with announcements.
- A fallback when push fails (email, then in-app).

**Operations**
- Monitoring: errors, slow routes, queue lengths, failed jobs, with alerts to the team.
- Cost: free tiers (FCM is free; email providers limit daily sends, which matters when notifying 2k students).
- Environments: local, staging (mock drive), production.

**Product**
- Language: English only, or English + Hindi?
- Accessibility (readable sizes, contrast, screen readers).
- How results/disputes are handled: a student who thinks their result is wrong (a "raise a concern" button → TPO task).
- Pooled/off-campus or virtual drives (links instead of venues).

## 12. Open questions for this draft
1. Tauri push test fails → PWA + email, or Expo for students? *(Now: test with a third-party plugin first, then build our own FCM plugin, section 5b.)*
2. ~~Fastify or Express?~~ → **Express** (decided)
3. TypeScript everywhere? (proposal: yes)
4. Is k8s required by the guide/university, or a nice-to-have? (changes whether it's P0 or P2)
5. Is OCR on marksheets wanted, or only manual + CSV matching?
6. Which events may go to outside webhooks (privacy)?
7. Hosting: one VPS with Docker Compose, or a cloud with managed Postgres/Redis?
8. **Will the TPO allow student volunteers to see other students' marks at all?** If not, volunteers only do drive-day work and verification stays with TPO staff
9. Volunteers: block only same batch + branch, or the whole batch?
10. Spot-check rates (first 20 tasks, then 10%): OK, or stricter?
11. Company checks: is asking for CIN/GSTIN OK for small startups that may not have them?
12. Is the call-back check required for every new company, or only medium/high risk?
13. Data retention periods (documents, rejected requests, audit logs)?
14. 2-step login for TPO/staff from day one?
