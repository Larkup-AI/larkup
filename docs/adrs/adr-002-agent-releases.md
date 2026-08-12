# ADR-002: Immutable Agent Releases

**Status:** Accepted  
**Date:** 2026-08-10  
**Decision makers:** Product owner, maintainers  

## Context

The current agent generation creates a one-shot server bundle from the dashboard's live configuration. There is no versioning, no rollback, no way to compare what changed between deployments, and no guarantee that the configuration used for local testing is the same as what was deployed.

## Decision

**Agent Releases are immutable, versioned snapshots. Publishing is explicit. Rollback restores a prior release.**

### AgentRelease structure

```ts
interface AgentRelease {
  id: string;                              // unique release identifier
  agentId: string;                         // parent agent
  version: number;                         // monotonically increasing
  createdAt: string;                       // ISO timestamp
  runtimeVersion: string;                  // @larkup/agent-runtime version
  definitionSnapshot: AgentDefinition;     // frozen copy of agent config
  extensionLockfile: ExtensionLockfile;    // exact tool/skill versions
  status: 'draft' | 'testing' | 'published' | 'rolled_back';
}
```

### Lifecycle

1. **Draft** — User configures agent settings (model, prompt, tools, knowledge sources). Changes are drafts until explicitly published.
2. **Testing** — User clicks "Test" → a local Agent Runtime starts using the current draft as a temporary release. Same runtime as production.
3. **Published** — User clicks "Publish" → creates an immutable `AgentRelease` with an incremented version number. The draft becomes a snapshot.
4. **Deployed** — The published release is deployed to a target (Docker, Cloud Run, etc.). The deployment records the release ID, target, endpoint, and status.
5. **Rolled back** — User clicks "Rollback to v3" → the prior release is re-deployed. The rolled-back release is marked `rolled_back`.

### Key rules

- A published release **cannot be modified**. To change behavior, publish a new release.
- The deployment binding (provider, endpoint, secrets references) is **not part of the release**. The same release can run on any target.
- Every running agent identifies its exact release version, runtime version, and tool versions via the `/release` health endpoint.
- Release history is stored in the workspace data directory (`.larkup/releases/`).

## Consequences

- **Positive:** Reproducible deployments — what you tested is exactly what runs in production.
- **Positive:** Rollback is instant — just re-deploy a prior release snapshot.
- **Positive:** Audit trail — every change is a versioned, timestamped snapshot.
- **Trade-off:** Users must explicitly publish. Quick iteration during development uses the "Test" flow (temporary draft release) to avoid unnecessary version bumps.
