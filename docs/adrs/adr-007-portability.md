# ADR-007: Portability Requirement

**Status:** Accepted  
**Date:** 2026-08-10  
**Decision makers:** Product owner, maintainers  

## Context

Agents should not be locked to a specific deployment target. A user who tests an Agent locally should be able to deploy it to Docker, Cloud Run, or future Larkup Cloud without changing its behavior, prompt, tools, or knowledge configuration.

## Decision

**An Agent must be movable from laptop → Docker → Cloud Run → Larkup Cloud without behavior change. `AgentDefinition` and `AgentRelease` are provider-neutral.**

### What is provider-neutral

| In the AgentRelease (portable) | In the Deployment binding (provider-specific) |
|-------------------------------|-----------------------------------------------|
| Agent name, model, prompt | Target provider (Docker, Cloud Run, etc.) |
| Knowledge Server references | Provider endpoint URL |
| Enabled tools + lockfile | Provider credentials/secrets references |
| Widget style configuration | Environment variable injection method |
| Access policy, allowed origins | Health check URL, deployment status |
| Runtime version | Container registry, image tag |

### Rules

1. No release may depend on a local file path, dashboard-only state, or a cloud-vendor-specific generator.
2. The same release snapshot must work locally and remotely.
3. The Agent Runtime container image is the same OCI image across all targets. Only environment variables and mounted volumes differ.
4. Deployment providers are replaceable adapters with common lifecycle: deploy, health check, redeploy, rollback, destroy.
5. The generated Dockerfile and docker-compose.yml are the reference deployment artifacts. Cloud-specific templates (Terraform, GitHub Actions) wrap them.

### Dashboard behavior

- **Before Larkup Cloud exists:** Local/self-hosted and BYOC targets are shown clearly.
- **After Larkup Cloud exists:** Larkup Cloud is the default. BYOC options are under "Advanced — Bring your own infrastructure."
- Both paths use the same AgentRelease and runtime contract.

## Consequences

- **Positive:** Users are never locked to a provider. They can switch from Cloud Run to Docker to Larkup Cloud freely.
- **Positive:** Testing locally guarantees production behavior.
- **Positive:** Larkup Cloud competes on convenience and operations, not lock-in.
- **Trade-off:** Cannot use provider-specific features (Cloud Run autoscaling, serverless cold-start optimizations) inside the release definition. Provider-specific optimizations are deployment-binding-level concerns.
