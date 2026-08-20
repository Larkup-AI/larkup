# ADR-008: Hub/Neon Database Ownership

**Status:** Accepted  
**Date:** 2026-08-10  
**Decision makers:** Product owner, maintainers

## Context

The monorepo has two `DATABASE_URL` variables in different locations:

- `apps/marketplace/.env` → intended for the Marketplace catalog
- Root `.env` → intended for the future Larkup Cloud control plane

These are **separate databases** serving separate concerns. Mixing them would create coupling between the open-source Marketplace and the commercial Cloud service.

## Decision

**The Hub/Marketplace database and the Cloud control-plane database are separate Neon/Postgres instances. They must never share a connection or fall back between each other.**

### Database ownership

| Database               | Owner                             | Location                              | Purpose                                                                                          |
| ---------------------- | --------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Marketplace DB         | `apps/marketplace`                | `apps/marketplace/.env: DATABASE_URL` | Publisher identity, extension catalog, versions, installations, audit events, webhook deliveries |
| Cloud control-plane DB | Future `apps/cloud-control-plane` | Root `.env: DATABASE_URL`             | Hosted deployments, teams, usage, billing metadata                                               |

### Rules

1. `apps/marketplace` validates its `DATABASE_URL` at startup. If missing, it fails with a clear error — it does not fall back to the root `.env`.
2. Root `DATABASE_URL` is reserved for the future Cloud service (TASK 08/09). No other app or package reads it.
3. Each database has its own migration directory, schema, and deployment lifecycle.
4. No cross-database joins or references. If the Cloud service needs Marketplace data, it calls the Hub API.
5. Neither database stores secrets in plaintext. Only references and metadata are stored in Postgres; actual secrets go through a dedicated secrets layer.

### Marketplace DB initial entities (TASK 03)

```
publishers, publisher_memberships, workspaces
extensions, extension_versions, extension_releases
extension_visibility, workspace_installations
entitlements, audit_events, webhook_deliveries, publisher_keys
```

### Cloud DB initial entities (TASK 08/09)

```
deployments, deployment_releases, deployment_health
workspaces, workspace_members, workspace_roles
usage_events, plans, subscriptions
```

## Consequences

- **Positive:** The Marketplace can be deployed independently of the Cloud service.
- **Positive:** Database migrations for Marketplace and Cloud don't interfere.
- **Positive:** Self-hosted users can run the Marketplace without the Cloud database.
- **Trade-off:** Two databases to manage. Acceptable for separation of concerns and independent scaling.
