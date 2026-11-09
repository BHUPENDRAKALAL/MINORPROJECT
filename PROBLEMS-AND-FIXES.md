# Cyrus: Problems and Fixes

Every real problem we hit while building Cyrus, why it happened, and what we did about it.
Newest entries go at the top of each section. Keep it short: symptom → cause → fix → where.

**Add an entry when** a bug is found (by us, a test, or the simulation), a tool or setup step breaks,
or a decision is changed because something didn't work. Also note anything still open at the bottom.

Last updated: 2026-11-09

---

## 1. Product bugs (what a user would have seen)

| Date | Problem (what we saw) | Cause | Fix | Where |
|---|---|---|---|---|
| 2026-11-09 | On college Wi-Fi, students could get "Too many attempts" during a drive | The API's overall limit (300 requests/min) was counted **per IP address**. A whole campus shares one public IP, so hundreds of students would share one limit on drive day | Signed-in requests are now counted **per session** (a hash of the login token); only anonymous requests (sign-in, sign-up) are counted per IP | `apps/api/src/http/app.ts` (`globalLimitKey`) |
| 2026-11-09 | "Round has started: check in with the QR code" was sent even when no check-in was opened | The message always mentioned the QR for on-campus rounds | Reworded: "Go to the venue. If a check-in QR code is shown there, scan it" | `apps/api/src/modules/rounds/service.ts` |
| 2026-11-09 | Ratings in earlier-round notes showed raw names ("confidence", "technical_knowledge") in random order | The summary only knew the current round's criteria | One shared list of all criteria gives proper labels and a fixed order | `apps/web/src/pages/app/drives/KeyPoints.tsx` |
| 2026-11-09 | A selected student still saw "Online test links appear here after you join" | The hint only checked for the "Joined" status, not Selected / Offered / Placed | Hint shows only to students who can still join | `apps/web/src/pages/app/drives/StudentDrive.tsx` |
| 2026-11-08 | Student's own offer showed "Waiting for the student" | Same label used for HR and the student | Student sees "Waiting for your answer" | `Offers.tsx`, `StudentDrive.tsx` |
| 2026-11-08 | Round banner said "All results entered" and marked everyone absent while check-in was still open | Absent was worked out as "no check-in row", even before check-in closed | Publishing is blocked until check-in is closed; nobody counts as absent while it's open; banner says "Check-in is open: X of Y here" | `rounds/service.ts`, `RoundPage.tsx` |
| 2026-11-08 | The QR screen's count went up, but the banner and students table stayed old | Only the QR panel polled the server | The round page reloads whenever the checked-in count goes up | `QrScreen.tsx` (`onArrivals`) |
| 2026-11-08 | TPO's drive list showed HR's unfinished drafts | List didn't filter drafts by owner | TPO sees only their own drafts; HR drafts appear once sent for approval | `drives/service.ts` (`list`) |
| 2026-11-08 | Round name and kind tag repeated ("Online assessment" + tag "Online assessment") | Tag always shown | Tag hidden when the name already says the kind | `drives/shared.tsx` (`namesKind`) |
| 2026-11-08 | Consent text on the blue "You're invited" banner was unreadable | Labels kept the normal dark text colour on a dark banner | Labels and checkboxes on banners take the banner's text colour | `apps/web/src/index.css` |
| 2026-11-08 | "Drives" wasn't highlighted in the side panel on a drive's own page | Nav links matched only the exact path | Items are current on their pages and the pages under them (`isCurrent`, `under`) | `app/nav.ts`, `app/Shell.tsx` |
| 2026-11-08 | After signing in, the app opened the previous person's page ("Not available") | The "go back to where you were" path was followed even for a different account | Only followed if the new account may open that page | `apps/web/src/App.tsx` (`PublicOnly`) |
| 2026-11-08 | Team page flickered between "Something went wrong" and the list, reloading forever | The form helper returned a new object every render; the page's effect depended on it, so it re-ran (and re-fetched) endlessly | Helper's return value is memoised; the page depends only on the stable `run` function | `components/useApiForm.ts`, `pages/app/Team.tsx` |
| 2026-11-08 | Profile page sometimes showed old data after quick saves | Responses arrived out of order and the older one won | Out-of-date responses are dropped (`track`); quiet refresh while a file scan is pending | `pages/app/StudentProfile.tsx` |
| 2026-11-08 | Coming back from sign-in didn't return to the page you were on | Redirect raced with the session start | Redirect to `location.state.from` once signed in | `apps/web/src/App.tsx` |
| 2026-11-07 | Logo looked broken (wrong crescent, two logos interfering) | SVG arc flags were wrong; two logos on one page used the same mask id | Fixed arcs; mask ids made unique per logo (`useId`) | `components/BrandMark.tsx` |

## 2. Backend and data

| Date | Problem | Cause | Fix | Where |
|---|---|---|---|---|
| 2026-11-09 | Database check reported a difference right after adding key-point columns | Migration gave the new list columns a default of `[]`, the schema didn't | Schema says `@default([])` too | `prisma/schema.prisma`, migration `20261109090000_interview_key_points` |
| 2026-11-08 | Re-running the demo seed failed with a foreign-key error | Offers and placement records point at drives; drives were deleted first | Seed and e2e cleanup delete placement records → offers → drives → companies, in that order | `scripts/seed-demo.ts`, `scripts/cleanup-e2e.ts` |
| 2026-11-08 | Drive-day helpers (staff with attendance permission) were refused | A route's roles and permissions were both required (AND) | Routes can say `match: "any"`: one of the roles **or** one of the permissions | `http/auth-context.ts`, `rounds/routes.ts` |
| 2026-11-08 | `prisma migrate dev` refused to run from the tool | It needs an interactive terminal | Migrations written by hand (`--create-only` style), then `prisma migrate deploy`; enum values **renamed** (not dropped) so data survives | `prisma/migrations/20261108120000_drive_round_kinds` |
| 2026-11-08 | Deleting demo files failed (foreign key) | Files deleted before the rows using them | Delete in one transaction in the right order | `scripts/seed-demo.ts` |
| 2026-11-08 | Rate-limit setup crashed with a Redis `NOSCRIPT` error | Rate limiter shared the main Redis connection's mode | Rate limiters get their own Redis connection ("limits" mode: offline queue, 1 retry, 500 ms timeout) | `lib/redis.ts`, `http/app.ts` |
| 2026-11-08 | A big upload was read before checking who sent it | Multipart parsing ran before the access check | Access is checked first, then upload parsing | `http/define-route.ts` |
| 2026-11-07 | Every request failed (500) when Redis was down | Rate limiter threw on store errors | `passOnStoreError`: requests go through, `/ready` reports Redis down | `http/app.ts` |
| 2026-11-07 | Realtime server crashed at start without Redis | `enableOfflineQueue` off for the pub/sub connection | Separate Redis modes per use (request, queue, pubsub, limits) | `lib/redis.ts` |
| 2026-11-07 | Docker Redis wouldn't start | An old Redis already used port 6379 on the laptop | Docker Redis runs on **6380** | `docker-compose.yml`, `.env` |

## 3. Testing (e2e, simulation)

| Date | Problem | Cause | Fix | Where |
|---|---|---|---|---|
| 2026-11-09 | Interview test failed only in the full run ("remark not visible") | Not an app bug: the whole test took ~60 s and hit Playwright's 60-second limit right at its last step | Test time limit raised to 150 s for full user journeys. Found by logging the student's responses: the data was right | `apps/web/playwright.config.ts` |
| 2026-11-09 | Many e2e tests failed with "Too many attempts" | Old dev servers were still running; Playwright reused that API, which had rate limits on. Killing the port's process wasn't enough: `tsx watch` restarted it | Stop the whole process tree (watchers too) before e2e runs | see "Useful commands" below |
| 2026-11-09 | Password-reset test picked the wrong code | Sign-up and reset emails have the same subject | Email helper can also match on body text ("reset your password") | `e2e/helpers.ts` (`latestEmail`) |
| 2026-11-09 | Simulation hung for 15 minutes | A click on a button that never appeared waits forever by default | Simulation clicks time out after 20 s; helper waits for the panel to show its state before acting | `e2e/simulation.spec.ts` |
| 2026-11-08 | e2e picked an older OTP email | No time filter on Mailpit search | `since` filter on `latestEmail` | `e2e/helpers.ts` |
| 2026-11-08 | e2e couldn't start the browser | Bundled Chromium version didn't match | Use installed Chrome (`channel: "chrome"`); `E2E_BROWSER=bundled` switches back | `playwright.config.ts` |
| 2026-11-08 | Upload / scan tests waited forever | The worker wasn't started for e2e, and had no health URL to wait on | Worker gets a health port (`WORKER_HEALTH_PORT=4002`) and is started by Playwright | `main/worker.ts`, `playwright.config.ts` |
| 2026-11-08 | Login tests hit per-route rate limits | Many sign-ins from one machine | `ROUTE_LIMITS=off` (development only, refused in production) for e2e | `config/env.ts`, `http/app.ts` |
| 2026-11-08 | Several "strict mode" failures | A text matched two places (e.g. "Reject" in a summary and inside the details) | Narrower locators (`summary`, `exact: true`, scoped to a form) | `e2e/*.spec.ts` |

## 4. Tooling and environment

| Date | Problem | Cause | Fix |
|---|---|---|---|
| 2026-11-09 | `docker compose` failed: pipe not found | Docker Desktop wasn't running | Start Docker Desktop, wait for `docker info`, then `docker compose start` |
| 2026-11-08 | Shell edits failed with "unexpected EOF" | Long scripts inside shell heredocs broke on quotes | Write the edit script to a file, then run it |
| 2026-11-08 | Editing a file failed with `Errno 22` | OneDrive briefly locked the file while syncing | Retry; the project lives in OneDrive, so expect this now and then |
| 2026-11-08 | Text replacements silently didn't apply | Some files have Windows line endings (CRLF) | Edit scripts normalise line endings, edit, then restore them |
| 2026-11-08 | A stray NUL character appeared in a file | A Python escape (`\u0000`) was written literally | Removed; avoid escapes in generated code |
| 2026-11-08 | `curl` upload failed | Windows absolute paths in `-F file=@...` | Use relative paths |
| 2026-11-07 | Prisma setup added `.claude` / `.windsurf` folders and a newer Prisma | `prisma init` defaults | Folders removed, Prisma pinned to 7.10.1 |

## 5. Decisions changed because something didn't work

| Date | What changed | Why |
|---|---|---|
| 2026-11-08 | File storage: SeaweedFS instead of MinIO | MinIO's community edition is no longer published or maintained |
| 2026-11-08 | Email: Mailpit in development, Brevo free plan (300/day) later, over SMTP | Needed a free service; SMTP keeps us able to switch |
| 2026-11-07 | Backend stays on **Express** (a switch to Fastify was reverted) | Express was the team's settled choice; the switch was made without asking. Rule: never swap a settled stack choice |
| 2026-11-07 | Every commit credits Claude (`Co-Authored-By`), history not rewritten | The first commit left the credit out; the team doesn't hide AI use |

## 6. Still open / watch

| Since | What | Notes |
|---|---|---|
| 2026-11-09 | Student "change request" e2e test failed once in a full run | Didn't happen again alone or in the next full run (27/27). If it comes back, keep `e2e-results/` before the next run overwrites it |
| 2026-11-08 | Live updates use polling (QR every 3 s, panel 5 s, student 10 s, badge 30 s) | Fine for one campus; move to Socket.io later. Keep an eye on request volume |
| 2026-11-08 | Phone check-in on the dev setup | The QR link uses `WEB_APP_URL` (localhost). Testing from a real phone needs the laptop's IP in `WEB_APP_URL` and the same Wi-Fi |
| 2026-11-08 | Virus scan is a basic PDF check only | ClamAV not added yet |
| 2026-11-08 | No-show count is kept, but no automatic block | The block length is a TPO policy decision |

---

## Useful commands when things go wrong

Stop every leftover Cyrus dev process (API, worker, watchers, Vite) on Windows:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'minor project' -and ($_.CommandLine -match 'src/main/(api|worker)\.ts' -or $_.CommandLine -match 'tsx(\\|/).*cli' -or $_.CommandLine -match 'vite') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

Start the services and reset demo data:

```bash
docker compose start
pnpm --filter @cyrus/api seed:demo
```

Run the live-drive simulation (9 people at once):

```bash
SIM=1 pnpm --filter @cyrus/web exec playwright test e2e/simulation.spec.ts
```
