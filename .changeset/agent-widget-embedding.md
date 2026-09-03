---
'@larkup/core': patch
'larkup': patch
---

feat(agent-widget): embeddable website widget with origin allow-listing (TASK 05)

Adds the Website Widget channel — the first entry in the channel delivery order.

**New package `@larkup/agent-widget`**: a single self-contained IIFE bundle
(~69 kB gzipped) that mounts a floating chat bubble into a Shadow DOM on any
website. Installed with one script tag:

```html
<script async src="https://your-host/api/widget.js" data-agent="support-bot"></script>
```

It renders only the allow-listed output-block protocol (ADR-005), carries no
secret beyond the public Agent ID (ADR-004), and parses the UI Message Stream
directly so it is not coupled to the server's AI SDK version.

**`@larkup/agent-contracts`**: new `origin` module (shared allow-list matcher and
CORS header policy) and `protocol` module (normalizes flat `{ role, content }`
messages and AI SDK `UIMessage` parts into one runtime shape).

**Agent API**: `POST /api/agents/:id/chat` now enforces the agent's
`allowedOrigins` list and answers CORS preflights; new
`GET /api/agents/:id/public` serves a redacted agent view for browsers; new
`GET /api/widget.js` serves the widget bundle. `authMode: "join-code"` is
enforced; `"api-key"` fails closed with 501 until the scoped key store exists.

**Dashboard**: Settings → Agents → **Connect** gives copy-pasteable install
snippets, an allowed-origins editor with a wildcard warning, and widget styling.

See [ADR-009](docs/adrs/adr-009-widget-isolation-and-origins.md) for the
isolation and origin-policy decisions.
