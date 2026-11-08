# Cyrus

Placement drive management and placement data platform for MBM University (7th semester minor project).
Seya Mali (24UCSE4073) · Bhupendra Kalal (24UCSE4008) · Guide: Dr. Abhishek Gaur · Mentor: Dr. Simran Choudhary

- **[PLAN.md](PLAN.md)**: the final plan. It wins over everything else when there's a conflict.
- **[BACKEND-DESIGN.md](BACKEND-DESIGN.md)**: approved backend design (routes, states, jobs, verification, webhooks).
- **[DESIGN-DIRECTION.md](DESIGN-DIRECTION.md)**: visual direction (draft).

## Layout

```
apps/
  api/          Node + TypeScript + Express. One codebase, four processes:
                  api       REST routes (/api/v1), OpenAPI docs at /api/docs
                  realtime  Socket.io (live queue, QR, job progress)
                  worker    background jobs (BullMQ queues)
                  relay     moves committed events from the outbox to the queues
  web/          React + TypeScript (Vite). Website for every role.
    src-tauri/  Tauri v2 shell: the same web app as a desktop / Android app
packages/
  shared/       Constants and types used by both: roles, queues, events, route classes
docker-compose.yml   PostgreSQL 17, Redis 7, SeaweedFS (S3 file storage) and Mailpit (test inbox)
```

## First-time setup

Needs: Node 22+, pnpm 10, Docker Desktop, Rust (for Tauri only).

```bash
pnpm install
```

```bash
cp .env.example .env
```

Start Docker Desktop, then:

```bash
pnpm infra:up
```

```bash
pnpm db:migrate
```

Create the first TPO account (prints a one-time password):

```bash
pnpm --filter @cyrus/api create-tpo --email tpo@example.com --name "Placement Officer"
```

Demo accounts for trying every role (TPO, staff, volunteer, students in each state). Development only; the emails and the shared password are listed at the top of `apps/api/src/scripts/seed-demo.ts`:

```bash
pnpm --filter @cyrus/api seed:demo
```

> In development every email (signup codes, invites, verification results) lands in **Mailpit**: open http://localhost:8025. Uploaded files are stored in SeaweedFS (S3 API on port 8333).

> Redis runs on port **6380** (not the usual 6379) because some machines already have an old Redis on 6379.

## Running in development

Each process in its own terminal:

```bash
pnpm dev:api
```

```bash
pnpm dev:worker
```

```bash
pnpm dev:relay
```

```bash
pnpm dev:realtime
```

```bash
pnpm dev:web
```

Open http://localhost:5173 for the setup-check screen, and http://localhost:4000/api/docs for the API docs.

Desktop app (Tauri), starts the web dev server itself:

```bash
pnpm --filter @cyrus/web tauri dev
```

## Checks

End-to-end pipeline check (needs the worker and relay running):

```bash
pnpm --filter @cyrus/api smoke
```

```bash
pnpm typecheck
```

```bash
pnpm test
```

Database tests use a separate database (`TEST_DATABASE_URL` in `.env`, wiped on every run). Without it they are skipped.

```bash
pnpm build
```

## Rules for new code

- Every API route declares its weight class in `config.routeClass` (`LIGHT`, `HOT`, `BACKGROUND`, `HEAVY`). The API refuses to start if one is missing.
- Heavy work never runs in the API: create a `Job` row, add it to a queue, return `202` with the job id.
- Every state change writes an audit row and, where others need to know, an outbox event in the **same transaction** (`emit(tx, ...)`).
- Secrets live in `.env` only. Never commit `.env`.
