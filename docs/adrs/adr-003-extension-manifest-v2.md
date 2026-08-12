# ADR-003: Extension Manifest v2 and Four Extension Kinds

**Status:** Accepted  
**Date:** 2026-08-10  
**Decision makers:** Product owner, maintainers  

## Context

The current marketplace system uses `tool.manifest.json` with a tool-specific schema. It does not distinguish between tools, skills, channels, and knowledge integrations — treating everything as a "tool." This makes it impossible to apply different security, execution, and discovery policies to different extension kinds.

## Decision

**Replace the tool-only manifest with a versioned universal manifest (`ExtensionManifestV2`) that distinguishes four extension kinds. Maintain a migration reader for existing `tool.manifest.json` files.**

### Four extension kinds

| Kind | Purpose | May execute code? | Example |
|------|---------|:-----------------:|---------|
| `tool` | Performs a typed action for an Agent | Yes, permissioned | Search CRM, create ticket |
| `skill` | Adds instructions, workflow, references | Only if it bundles a tool | Customer support policy |
| `channel` | Maps an external transport to Agent protocol | Yes, verified adapter | Widget, Telegram, Slack |
| `knowledge-integration` | Reads a source into the Knowledge Server | Yes, under ingestion controls | Notion, Google Drive |

### Manifest v2 schema

```ts
interface ExtensionManifestV2 {
  manifestVersion: '2';
  id: string;
  kind: 'tool' | 'skill' | 'channel' | 'knowledge-integration';
  version: string;
  display: { name: string; description: string; icon?: string };
  publisher: { id: string; name: string; verification?: 'unverified' | 'verified' };
  runtime: {
    agentApiVersion: string;
    entrypoint?: string;
    supportedTargets: string[];
  };
  permissions: ExtensionPermission[];
  configuration?: JsonSchema;      // drives settings forms automatically
  secrets?: SecretRequirement[];
  inputs?: JsonSchema;             // for tools: typed input schema
  outputs?: AgentOutputDeclaration[];  // for tools: typed output schema
  trust: 'first-party' | 'trusted-local' | 'community';
  distribution: ExtensionDistribution;
  docs: { readme: string; repository?: string; support?: string };
}
```

### Migration from v1

A `manifestMigrationReader` function converts existing `tool.manifest.json` files:
- Maps v1 capabilities to v2 `kind: 'tool'`
- Sets `trust: 'first-party'` for `@larkup/*` packages
- Sets `manifestVersion: '2'` on the output
- Preserves all existing fields as compatible v2 equivalents

Existing `tool.manifest.json` files continue to work until all first-party tools are migrated. The migration reader logs a deprecation warning.

## Consequences

- **Positive:** Different security and execution policies per kind (tools need sandboxing, skills don't execute code, channels need webhook verification).
- **Positive:** `configuration` drives settings forms automatically — publishers don't need dashboard pages.
- **Positive:** Trust levels enable the MVP tool boundary (first-party + trusted-local only).
- **Trade-off:** Existing marketplace tools need migration. The reader provides backward compatibility during the transition.
