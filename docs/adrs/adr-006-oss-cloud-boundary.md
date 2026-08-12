# ADR-006: Open-Source / Cloud Boundary

**Status:** Accepted  
**Date:** 2026-08-10  
**Decision makers:** Product owner, maintainers  

## Context

Larkup must balance being a useful open-source project with building a sustainable business. The wrong boundary either locks users into a proprietary runtime (bad for adoption) or gives away all operational value (bad for business).

## Decision

**Open the runtime, SDK, widget, and extension contracts. Monetize the hosted control plane.**

### Open (self-hostable)

| Component | Purpose |
|-----------|---------|
| Knowledge Server | Ingest, index, retrieve — full data plane |
| Agent Runtime | Prompt composition, model invocation, tools, sessions |
| Agent Widget | Web Component, browser embed |
| Agent React SDK | React/Next.js bindings |
| JS / Python SDK | Server-side and client-side clients |
| Extension contracts | Manifest v2, tool contract, output blocks |
| CLI | Command-line interface for all operations |
| Marketplace protocol | Extension discovery, manifest validation |

### Paid (Larkup Cloud)

| Feature | Value |
|---------|-------|
| Managed launch | One-click deploy without cloud provider setup |
| CDN widget delivery | Fast, global, versioned widget hosting |
| Managed secrets | Encrypted credential storage, rotation, audit |
| Remote releases | Push releases without SSH access |
| Observability | Hosted logs, traces, metrics, alerts |
| Analytics | Usage, cost, error dashboards |
| Teams & RBAC | Multi-user workspaces, roles, SSO |
| Enterprise | Audit logs, private networking, custom domains, SLA |
| Managed channels | Hosted webhook endpoints for Telegram, Slack, etc. |

### Rules

- Do not make the extension protocol proprietary.
- Do not add artificial runtime limitations to the open-source version.
- Do not require Larkup Cloud for basic local development and self-hosted deployment.
- Self-hosted users get the same runtime behavior as cloud users.
- Cloud value comes from **operational convenience**, not runtime lock-in.

## Consequences

- **Positive:** Healthy open-source ecosystem and third-party contributions.
- **Positive:** Self-hosted users can evaluate fully before deciding to pay for convenience.
- **Positive:** Cloud features are genuinely valuable (not artificial gates).
- **Trade-off:** Competitors can self-host the full runtime. Mitigated by the velocity, quality, and operational value of Larkup Cloud.
