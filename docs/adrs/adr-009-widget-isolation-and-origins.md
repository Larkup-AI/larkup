# ADR-009: Widget Isolation and Origin Policy

**Status:** Accepted  
**Date:** 2026-08-11  
**Decision makers:** Product owner, maintainers  
**Supersedes in part:** plan §8.2 ("isolated iframe UI")

## Context

TASK 05 ships the Website Widget — the first channel in the delivery order
(plan §9). It is the first Larkup artifact that executes on infrastructure we do
not control: a customer's marketing site, e-commerce theme, or CMS template,
alongside their CSS, their analytics, and whatever else they load.

Two questions had to be settled before any of it could be written.

1. **How is the widget isolated from the host page, and the host page from it?**
2. **What stops an arbitrary website from embedding someone else's agent and
   spending their model budget?**

Neither has a free answer. The browser holds no secret (ADR-004: the widget
carries a public Agent ID and nothing more), so isolation and authorization are
the whole security story for this surface.

## Decision

### 1. Shadow DOM, not an iframe

The React root mounts inside an **open shadow root** on an element appended to
`document.body`. Plan §8.2 anticipated an iframe; Shadow DOM is what shipped.

Why:

- An iframe cannot lay out against the host viewport without a second
  coordination channel (`postMessage` resize protocol), and it handles mobile
  keyboards, focus, and IME poorly — all of which matter more for a chat input
  than for a static badge.
- Shadow DOM gives complete CSS isolation in both directions, which is the
  actual failure mode we are protecting against. E2E coverage asserts it against
  a deliberately hostile host stylesheet.
- The widget renders no embedder-supplied content and no publisher code
  (ADR-005), so the extra script-isolation an iframe buys has nothing to
  protect today.

The mount element itself lives in the host page's light DOM, so its positioning
is set as inline `!important` declarations — a stray `div { position: static }`
in the host theme would otherwise move the widget off-screen.

**Revisit if** the widget ever renders embedder-supplied HTML, third-party
extension UI, or payment input. At that point an iframe (or a nested one for the
untrusted region) becomes worth its cost.

### 2. Hand-authored CSS, not Tailwind

The rest of the monorepo uses Tailwind v4 + shadcn. The widget does not, for a
correctness reason rather than a preference:

> Tailwind v4 registers its internal `--tw-*` variables with `@property`.
> `@property` registration is **document-scoped**; browsers ignore it inside a
> shadow root. Utilities that depend on those registrations — shadows,
> gradients, transforms, ring — silently render wrong.

Isolation is the non-negotiable half of that trade, so the widget owns a single
hand-written stylesheet, injected into the shadow root as a `<style>` element
and themed through custom properties.

### 3. Origin allow-list as the browser authorization boundary

`AgentDefinition.allowedOrigins` is enforced on every browser-reachable agent
endpoint before any work happens. The matcher lives in
`@larkup/agent-contracts/origin` so the dashboard, generated agent servers, and
future channel adapters cannot drift apart.

| Case                          | Result  | Why                                                                        |
| ----------------------------- | ------- | -------------------------------------------------------------------------- |
| No `Origin` header            | allowed | Server-to-server SDK/CLI calls; authorized by API key, not by this check.   |
| Same origin as the server     | allowed | The dashboard's own playground must not require allow-listing itself.       |
| `*` in the list               | allowed | Local-development default. The dashboard warns; narrow it before launch.    |
| Empty list                    | denied  | Fail closed.                                                               |
| Matching entry                | allowed | Exact, `https://*.sub.domain` wildcard, or scheme-less host.                |
| Anything else                 | denied  | 403 before the model, the retrieval fan-out, or any tool runs.              |

Supporting decisions:

- **The allow-list is read from the draft definition, not the active release.**
  Origins, auth mode, and join code are operational access settings; an operator
  must be able to add a domain — or revoke one during an incident — without
  publishing a release. Everything that affects the agent's *answers* still
  comes from the immutable release (ADR-002).
- **Denial responses carry `Access-Control-Allow-Origin`.** This looks wrong and
  is deliberate: a denial body contains no agent data, and without the header
  the browser hides the 403 behind an opaque `TypeError: Failed to fetch`,
  leaving an embedder with no idea why their widget is dead. Enforcement rests
  on refusing to run the agent and on the preflight returning a non-2xx status,
  which fails the request regardless of accompanying headers.
- **A separate redacted endpoint.** `GET /api/agents/:id/public` returns only
  name, status, auth mode, and widget style. `GET /api/agents/:id` returns the
  full definition — including `knowledgeSources[].retrievalKey` and the system
  prompt — and must never be called from a browser on a customer's site.

### 4. The widget parses the stream protocol itself

The widget does not depend on `@ai-sdk/react`. It reads the UI Message Stream
frames directly in `packages/agent-widget/src/lib/ui-message-stream.ts`.

- **Size:** roughly a third of the bundle, on someone else's page.
- **Version independence:** the widget is deployed on customer sites and updated
  on our schedule, not theirs. Coupling it to the server's exact AI SDK version
  would make every SDK bump a breaking change for embedders.

That file is the contract seam and carries unit tests encoding the frame shapes
the runtime emits today.

## Consequences

**Positive**

- One ~69 kB gzipped file, no CSS asset, no runtime dependency on the host page.
- CSS isolation proven by E2E against a hostile stylesheet, in both directions.
- Origin decisions are one tested pure function shared by every consumer.
- Revoking a domain is instant and needs no redeploy or release.

**Negative**

- The widget's stylesheet is maintained separately from the dashboard's design
  system; a brand change must be applied in two places.
- The stream reader must track AI SDK frame changes deliberately rather than
  inheriting them.
- Shadow DOM does not sandbox scripts. Acceptable only while the widget renders
  nothing but its own components and ADR-005 output blocks.

**Follow-ups (not in TASK 05)**

- Rate limiting and abuse controls per agent/origin (plan §8.2) — currently the
  allow-list is the only budget protection.
- `authMode: "api-key"` fails closed with 501 until the scoped, hashed,
  rotatable key store exists (TASK 08).
- `GET /api/agents/:id` still returns `retrievalKey` to any local caller. Safe
  while the dashboard API is same-origin and local, but it needs the same
  redaction treatment once the control plane is remote.
