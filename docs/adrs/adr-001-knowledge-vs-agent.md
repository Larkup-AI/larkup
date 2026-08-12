# ADR-001: Knowledge Server vs Agent Boundary

**Status:** Accepted  
**Date:** 2026-08-10  
**Decision makers:** Product owner, maintainers  

## Context

Larkup currently has two code generation paths:
- `generate-server.ts` — a standalone RAG/Knowledge Server (ingest, index, retrieve)
- `generate-agent-server.ts` — a full-agent server (chat, tools, widget, retrieval)

These share significant code (LanceDB store, embedding, Pinecone adapter) but serve fundamentally different purposes. Merging them creates coupling that makes independent deployment and evolution impossible.

## Decision

**The Knowledge Server and Agent are separate products with separate deployment lifecycles.**

### Knowledge Server (data plane)
- Ingestion, indexing, document/media management, semantic retrieval
- Stable, documented REST API with scoped authentication
- Independently deployable (Docker, VPS, Cloud Run, Vercel with durable storage)
- No dependency on chat widgets, channels, agent UI, or agent-specific concepts

### Agent (execution plane)
- Prompt composition, model invocation, typed tools, skills, sessions
- Uses one or more Knowledge Servers as a **read-only retrieval capability**
- An Agent receives a `retrieval`-scoped key to its Knowledge Server — it can query but never ingest, list documents, or administrate
- Deployed independently with its own lifecycle (AgentRelease, rollback, health)

```
Knowledge Server (data plane)              Agent Platform (execution plane)
documents → chunks → vectors → retrieval   prompt + model + skills + tools + sessions
                ↑                                      │
                └──── retrieval-scoped read-only ──────┘
                                                       │
                                         Widget / SDK / API / Channels
```

### What this means in practice

- The Knowledge Server generator (`generate-server.ts`) must not reference agents, widgets, or chat UI
- The Agent generator (`generate-agent-server.ts`) must not embed ingestion or index management
- The Agent Runtime connects to a Knowledge Server via `LarkupClient` with a `retrieval` scoped key
- Dashboard settings for Knowledge Server and Agent are separate sections
- Each has its own Dockerfile, docker-compose, deployment flow, and health endpoints

## Consequences

- **Positive:** Each product can evolve, scale, and deploy independently. A Knowledge Server can serve multiple Agents. An Agent can work without any Knowledge Server.
- **Positive:** Security boundary is clean — an Agent cannot accidentally modify the knowledge base.
- **Trade-off:** Two things to deploy instead of one. Mitigated by clear deployment guides and future Larkup Cloud (manages both).
- **Migration:** Current `generate-agent-server.ts` embeds its own LanceDB store. The refactored version will connect to an external Knowledge Server or embed a read-only local copy from the AgentRelease snapshot.
