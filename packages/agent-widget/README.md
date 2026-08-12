# @larkup/agent-widget

The embeddable browser chat widget for a Larkup Agent. One self-contained
`widget.js` (~69 kB gzipped) that a customer drops onto any website.

```html
<script async src="https://your-larkup-host/api/widget.js" data-agent="support-bot-m1a2b3"></script>
```

## What this package is (and is not)

- It is the **Website Widget channel** from the Agent Platform — plan §9,
  delivery order item 1.
- It talks **only** to the Agent Runtime (`/api/agents/:id/chat`). It never
  talks to a Knowledge Server; a Knowledge Server has no widget, by design
  (plan §1.1).
- It carries **no secret**. The browser gets a public Agent ID and nothing more
  (ADR-004). Model keys, retrieval keys, and tool secrets stay server-side.

## Install options

### Script tag (recommended)

```html
<script
  async
  src="https://your-larkup-host/api/widget.js"
  data-agent="support-bot-m1a2b3"
></script>
```

The host is inferred from the script's own `src`, so a single-server install
needs nothing else.

| Attribute            | Purpose                                                    |
| -------------------- | ---------------------------------------------------------- |
| `data-agent`         | **Required.** Public Agent ID.                             |
| `data-host`          | Larkup origin, when the script is served from a CDN.       |
| `data-title`         | Override the panel title.                                  |
| `data-primary-color` | Override the accent colour (`#rrggbb`).                    |
| `data-position`      | `bottom-right` (default) or `bottom-left`.                 |
| `data-theme`         | `light` or `dark`.                                         |
| `data-welcome-message`, `data-placeholder`, `data-avatar-url`, `data-border-radius` | Style overrides. |
| `data-open`          | `true` to open the panel on load.                          |
| `data-join-code`     | Join code for agents using `authMode: "join-code"`.        |

Anything not set falls back to the agent's dashboard-configured `widgetStyle`,
so one operator change restyles every embed.

### Programmatic

```js
const widget = LarkupAgent.init({
  agentId: 'support-bot-m1a2b3',
  host: 'https://your-larkup-host',
  style: { primaryColor: '#0ea5e9', darkMode: true },
  defaultOpen: false,
  headers: { Authorization: `Bearer ${endUserJwt}` },
  onReady: () => {},
  onError: (error) => {},
});

widget.destroy();
```

`headers` exists for a **short-lived end-user JWT minted by your own backend**.
Never put a secret Agent API key there — every visitor can read it.

## Allowed origins

Every widget request is checked against the agent's `allowedOrigins` list
before the runtime does any work. An un-allow-listed site gets `403` and the
widget renders an actionable message instead of a chat box. Configure the list
in **Larkup → Settings → Agents → Connect**.

`*` is the local-development default and is accepted, but it lets any website
spend your model budget. Narrow it before launch.

## Design decisions

**Shadow DOM, not an iframe.** The React root mounts inside an open shadow root,
so the host page's CSS cannot reach the widget and the widget's CSS cannot leak
out. The mount element carries positioning as inline `!important` declarations
because it lives in the host page's light DOM. An iframe would add a second
isolation layer at the cost of viewport-fit, focus, and mobile-keyboard
handling; revisit it when the widget starts rendering embedder-supplied content.

**Hand-authored CSS, not Tailwind.** Tailwind v4 registers its `--tw-*`
variables with `@property`, and `@property` registration is document-scoped —
browsers ignore it inside a shadow root, so shadows, gradients, transforms, and
rings silently render wrong. Isolation won; the widget owns its stylesheet.

**No `@ai-sdk/react`.** The widget parses the UI Message Stream directly
(`src/lib/ui-message-stream.ts`). This keeps the bundle roughly a third of the
size and, more importantly, decouples a widget deployed on customer sites from
the server's AI SDK version. That file is the contract seam and is unit-tested
against the frame shapes the runtime emits.

**Data-driven output only.** Tools contribute `status`, `citation`, `file`,
`data`, and `table` blocks (plan §4.4 / ADR-005). Arbitrary JavaScript or React
from a marketplace package never runs on a customer's page; unrecognized blocks
render as nothing.

## Development

```bash
pnpm --filter @larkup/agent-widget build       # dist/widget.js
pnpm --filter @larkup/agent-widget dev         # rebuild on change
pnpm --filter @larkup/agent-widget test        # stream + config unit tests
pnpm --filter @larkup/agent-widget type-check
```

Manual verification against a real cross-origin host page:

```bash
pnpm --filter @larkup/agent-widget build
cd packages/agent-widget && python3 -m http.server 5599
# add http://localhost:5599 to the agent's allowed origins, then open:
# http://localhost:5599/demo/?agent=<agentId>&host=http://localhost:4567
```

`demo/index.html` is a deliberately hostile host page — it forces fonts,
colours, `position: static !important`, rotated SVGs, and more. If the widget
still looks correct there, isolation is intact.
