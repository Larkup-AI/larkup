---
'@larkup/channels-core': minor
'@larkup/agent-contracts': minor
'@larkup/core': minor
'larkup': minor
---

feat(agent): channels, execution environments, and the deployable Agent Runtime bundle (TASK 06–08)

**Channels (TASK 06).** New `@larkup/channels-core` with the shared dispatch
pipeline — verify → parse → de-duplicate → run → deliver with retries — plus
Webhook (HMAC-SHA256, replay window) and Telegram (secret token, message
splitting, `setWebhook`) adapters. Inbound route, channel management API,
provider health checks, and a dashboard panel. Channel conversations get a
bounded server-side session store so a Telegram thread remembers its context.

**Execution environments (TASK 07).** Every target now carries explicit resource
limits, a `worker` profile sized for media work, and `admitTool()` returning a
visible decision instead of silently skipping a tool. Refusals surface in
`/api/agents/:id/health` with the reason.

**Agent Runtime bundle (TASK 08).** `GET /api/agents/:id/bundle` generates a
portable container carrying one immutable release: one Dockerfile for every
target, Cloud Run and Compose configuration, the widget, and a runbook. Every
credential is stripped from the image and injected at run time. Structured JSON
events with correlation ids and credential scrubbing.

**Fixes**

- Publishing a release now activates it. Previously a first publish left the
  agent answering "no active release — publish one first".
- `POST /api/agents` no longer drops `joinCode` and `channels`.
- The operator agent API no longer returns retrieval keys, join codes, or
  channel tokens in the clear; a redaction sentinel keeps edit round-trips safe.

See [ADR-010](docs/adrs/adr-010-channels-execution-and-deployment.md).
