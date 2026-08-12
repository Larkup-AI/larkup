# ADR-005: Generic Output Blocks

**Status:** Accepted  
**Date:** 2026-08-10  
**Decision makers:** Product owner, maintainers  

## Context

The current chat interface uses tool-specific React components under `apps/web/components/chat/tools/`. Each new tool requires custom UI code in the dashboard. This does not scale to third-party tools and creates a security risk if arbitrary publisher JavaScript runs in customer websites.

## Decision

**The Agent Widget and React SDK render only a fixed set of generic `AgentOutputBlock` types. No arbitrary publisher React/JavaScript runs in end-user widgets.**

### Output block types

```ts
type AgentOutputBlock =
  | { type: 'text'; markdown: string }
  | { type: 'citation'; source: SourceCitation }
  | { type: 'data'; data: unknown; schema?: JsonSchema }
  | { type: 'card'; card: CardSpec }
  | { type: 'table'; table: TableSpec }
  | { type: 'chart'; chart: ChartSpec }
  | { type: 'file'; file: FileSpec }
  | { type: 'approval'; approval: ApprovalRequest }
  | { type: 'status'; status: ToolStatus };
```

### Rendering rules

1. The Widget and React SDK include built-in renderers for each block type.
2. Tools produce output blocks as structured data, not React components.
3. The Agent Runtime serializes output blocks over the streaming protocol.
4. A tool that returns an unknown block type gets a fallback `data` rendering.
5. The existing dashboard chat UI may retain custom renderers for first-party tools (e.g., Video/Audio) as a compatibility layer, but the deployed Widget never loads arbitrary code.

### What this prevents

- A marketplace tool cannot inject `<script>` tags into a customer's website.
- A tool cannot render arbitrary React components in the Widget.
- A tool cannot access the browser DOM, cookies, or localStorage.
- Advanced UI extensions (custom dashboards, interactive widgets) are a future, security-reviewed protocol — not the MVP.

## Consequences

- **Positive:** Customer websites are safe from third-party code injection via tools.
- **Positive:** Tool authors focus on data/logic, not UI rendering.
- **Positive:** Widget stays small and fast — no dynamic code loading.
- **Trade-off:** Rich, interactive tool outputs (charts with hover, drag-and-drop) are limited to what the built-in renderers support. This is acceptable for MVP and can be extended with a reviewed protocol later.
- **Migration:** Existing first-party tool renderers in the dashboard are kept as a compatibility layer. The deployed Widget uses only generic blocks.
