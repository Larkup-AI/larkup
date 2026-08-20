# ADR-010: Channels, Execution Environments, and the Agent Runtime Bundle

**Status:** Accepted
**Date:** 2026-08-12
**Decision makers:** Product owner, maintainers
**Covers:** TASK 06, TASK 07, TASK 08

## Context

TASK 05 put an agent on a customer's website. Three things stood between that
and a launchable product: an agent could only be reached through a browser, tool
execution had no enforced boundary, and there was no way to run an agent
anywhere except the dashboard's own process.

## Decisions

### 1. One dispatch pipeline, adapters supply four functions (TASK 06)

`packages/connections` owns the sequence every transport shares:

```
inbound → verify → parse → idempotency claim → run agent → deliver (retry) → ack
```

An adapter supplies `verify`, `parse`, `send`, `health`. It inherits ordering,
de-duplication, the non-streaming fallback, retry with rate-limit handling, and
consistent events.

**Verification runs before the agent.** A channel webhook URL is public by
necessity — Telegram will not authenticate to us — so the only thing between it
and an unbounded model bill is a signature check that happens before any work.

**Providers retry; we must not answer twice.** Every provider in the delivery
order re-sends a webhook it believes failed. One slow model call would otherwise
become three answers and three charges. Claims are released on failure so a
genuine retry does real work.

**Status codes are an API.** `200` for handled *or deliberately ignored* (an
edit notification, a bot echo) — anything else makes the provider retry
forever. `502` when the answer exists but could not be delivered.

**Channels get server-side sessions.** The widget keeps its transcript in the
browser; Telegram cannot. Without a session store every reply answers in a
vacuum. The store is bounded (20 turns, 24h TTL) and keyed by a hash, so a
phone number never lands on disk.

Shipped: Webhook (HMAC-SHA256 over the raw body, 5-minute replay window) and
Telegram (secret token, message splitting, `setWebhook`). Slack, WhatsApp, and
Discord follow the same interface.

### 2. Execution is admitted, never silently skipped (TASK 07)

`admitTool()` returns an `ExecutionDecision` instead of a boolean, and checks
capability as well as trust: a `privileged` tool that shells out is still
unusable on a target that cannot fork, and the operator needs to be told *which*
it was.

The previous behaviour — `console.warn` and `continue` — produced an agent that
answered worse than it should with no visible cause. Decisions now surface in
`/api/agents/:id/health`.

Every target carries explicit `ExecutionLimits` (CPU, memory, duration, scratch
disk, egress policy, artifact and log ceilings), and a `worker` profile exists
for media work: 4 cores, 8 GiB, 30 minutes, 32 GiB scratch. `selectEnvironment()`
routes an incompatible tool to a worker when the deployment has one rather than
refusing it outright.

No third-party sandbox is a dependency. The contract is provider-neutral so E2B,
Modal, or Vercel Sandbox are replaceable adapters.

### 3. One image, every target (TASK 08)

`generateAgentRuntime(release)` produces a portable container carrying one
immutable `AgentRelease`. Per §11.1 there is no generator per cloud: one
`Dockerfile`, plus target-specific *configuration* (`docker-compose.yml`,
`service.cloudrun.yaml`).

**Secrets are stripped at generation time.** A container image gets pushed to a
registry and pulled by anyone with access, so retrieval keys, join codes, and
channel tokens are replaced with empty strings and injected as environment
variables at run time. The snapshot keeps behaviour — prompt, model, tools,
origins — which is what makes a deployment reproduce what was tested locally.

**The bundle runs on a bare Node image.** No `@larkup/*` dependency: the origin
matcher, wire protocol, and observability emitter are emitted as plain
JavaScript. This duplicated logic formerly lived in `@larkup/agent-contracts`,
which is a real cost — the E2E suite asserts the generated server exposes the
same behaviour, and the packages remain the source of truth.

**Rollback is deployment, not mutation.** Releases are immutable, so rolling
back means building the bundle for an earlier release and deploying that image.
A running container keeps serving the release it was built from until replaced —
a deployment cannot be changed underneath the operator.

**Observability is stdout JSON.** One object per event with correlation ids and
scrubbed credentials. Every target in §11.1 collects stdout, so basic operation
needs no extra configuration; an OTLP collector plugs in through `setEventSink`.

## Bugs this work surfaced

Three defects that made the product unlaunchable, all found by tests written
against the plan's own acceptance criteria rather than against the code:

1. **Publishing a release never activated it.** A user's first publish produced
   an agent that still answered "no active release — publish one first".
   Publishing now activates; rollback moves the pointer back.
2. **`POST /api/agents` silently dropped `joinCode` and `channels`.** An agent
   created with `authMode: "join-code"` had no code to check against.
3. **The operator API returned `retrievalKey` in the clear** — and would have
   returned bot tokens once channels landed. Added a redaction contract with a
   sentinel so the dashboard can round-trip an agent whose secrets it cannot
   read.

## Consequences

**Positive**

- A channel is a package with fixtures, not a dashboard toggle.
- A refused tool is visible, with the reason, before it produces a bad answer.
- The same release runs on a laptop and in production, byte for byte.
- No credential reaches a registry, a browser, or a log.

**Negative**

- The generated `server.mjs` duplicates contract logic. Mitigated by tests;
  properly fixed if the archived `@larkup/agent-contracts` package returns as a built artifact that a
  standalone bundle can depend on.
- Channel sessions are in memory in the deployed bundle, so a restart or a
  scale-to-zero loses conversation history.
- The in-memory idempotency store is correct for one process and wrong for a
  horizontally scaled deployment. `IdempotencyStore` is the seam.

**Follow-ups**

- Per-agent rate limiting and abuse controls (§8.2). The origin allow-list is
  currently the only budget protection.
- Scoped, hashed, rotatable Agent API keys — `authMode: "api-key"` still fails
  closed with `501`.
- Slack, WhatsApp, Discord adapters.
- Cloud Run, Container Apps, and App Runner acceptance-matrix runs in disposable
  projects. Docker/VPS is verified; the others are documented, not proven.
