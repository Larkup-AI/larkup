# Video benchmark dashboard (local, mock-first)

Local web dashboard for the **Video Intelligence benchmark controller API v1**
(see [`../data/dashboard-api-v1.md`](../data/dashboard-api-v1.md)). It is a
**UI/client only**: it never schedules work, evaluates answers, routes models or
computes billing — it surfaces the controller's fields and exposes run controls.

> **Note for the benchmark agent (how to run this without disturbing the monorepo).**
> This app is intentionally **outside** the `larkup` pnpm workspace (no workspace
> glob matches `packages/marketplace-tools/video-intelligence/benchmarks/*`).
> **Install and run it with `npm`, from inside this folder.** Do **not** run
> `pnpm install`/`pnpm dev` here or from the repo root for this app — that would
> pull it into the monorepo graph and can corrupt the root lockfile/build.
> Everything heavy or secret (`node_modules/`, `.next/`, `.env*`, the npm
> lockfile) is git-ignored and never pushed.

## Run

```bash
cd packages/marketplace-tools/video-intelligence/benchmarks/dashboard
npm install            # isolated: creates ./node_modules + ./package-lock.json only

# Dev (hot reload), loopback-bound, configurable port:
PORT=3100 npm run dev            # -> http://127.0.0.1:3100

# Or production:
npm run build && PORT=3100 npm start
```

The server binds to `127.0.0.1` (loopback) via the `-H 127.0.0.1` flag in the
scripts. Change the port with `PORT=…`; it is not one of the monorepo's guarded
dev ports (3000/4000), so it will not trip the repo port guard — but still pick a
free port and verify the listener (`lsof -nP -iTCP:<port> -sTCP:LISTEN`).

## Modes (`.env.local`, copy from `.env.example`)

| `DASHBOARD_MODE` | Behavior |
| --- | --- |
| `mock` (default when no controller URL) | Serves in-memory contract fixtures covering running / pausing / paused / quota-blocked / mixed-route / partial / negative-pilot / completed / draft. All figures are illustrative, **not** measured results. |
| `proxy` | BFF forwards approved `/api/v1` ops to `BENCHMARK_CONTROLLER_URL` (your SSH-forwarded controller loopback) with `BENCHMARK_CONTROLLER_TOKEN` attached **server-side**. |
| `offline` | Read-only last-synced snapshot; all writes return `503 OFFLINE_READONLY` and the UI is labelled stale. |

Env vars: `BENCHMARK_CONTROLLER_URL`, `BENCHMARK_CONTROLLER_TOKEN`,
`DASHBOARD_ALLOWED_ORIGINS` (exact origins allowed to mutate; defaults to the
app's own loopback origin), `PORT`.

## Security / boundary guarantees

- The **browser never receives** the controller URL or token. It talks only to
  this app's same-origin `/api/v1` BFF; the BFF attaches the bearer token
  server-side in `proxy` mode.
- Mutations require an **exact Origin** match (no wildcard CORS),
  `Content-Type: application/json`, an `Idempotency-Key`, and an
  `expectedRevision`. Stale revisions get `409`; replays with the same key+body
  return the original result (no duplicate/billable retry).
- This app **never reads `benchmark.env`** and **never calls providers
  directly**. It is **not deployed to Vercel**.

## Tests

```bash
npm test          # node --test with the built-in TS loader (zero extra deps)
npm run type-check
```

Tests cover: contract state machine, accuracy/denominator rules (null never
coerced to 0), sanitized CSV export, idempotency body-hash canonicalization, and
the mock controller's revision/idempotency/pagination/transition semantics.

## Contract coordination

`lib/contract.ts` mirrors the versioned API contract and is the single source of
truth the UI and mock share. If the backend contract changes, update it there
**with the benchmark agent** via a versioned diff + fixture update — neither side
should independently redefine status, units, or cost semantics.


## Real operator launch

From the parent benchmark directory use `./launch.sh dashboard` to open this UI
and its authenticated PC bridge without starting GPU work. Use `./launch.sh` to
start the saved benchmark workflow as well. `./launch.sh --view-only` displays
actual saved database data with all writes disabled. Running `npm run dev` alone
without a controller URL uses explicitly labelled mock fixtures.

The console now has Overview, Processes, Results, Logs, Database, Services &
providers, and Events tabs; JSON/CSV exports; per-run controls; global pause/
resume; and safe/emergency GPU stop. GPU start/stop is handled by the PC operator,
never browser provider credentials. Emergency stop requires `STOP GPU`.
