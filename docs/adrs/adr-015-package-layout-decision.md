# ADR-015: Consolidated Agent Package Layout (Not Split)

**Status:** Accepted
**Date:** 2026-08-12
**Decision makers:** Product owner, maintainers
**Closes:** plan §3.

## Context

Plan §3 sketched a package layout for the Agent Platform side of the
monorepo: `packages/agent-contracts`, `packages/agent-runtime`,
`packages/agent-sdk`, `packages/agent-widget`, `packages/agent-react`, and
one `packages/channel-*` per transport. TASK 04–06 shipped the
functionality that layout described — an Agent Runtime, a widget, three
channel adapters — but not the package boundaries. The runtime, release
store, and session store landed inside `packages/core` (alongside the
Knowledge Server, which §3's own diagram called "Knowledge Server only").
Every channel adapter is a file inside one package,
`packages/channels-core/src/adapters/`, not a package of its own.
`agent-sdk` and `agent-react` were never started at all.

Plan §3 itself carries the product owner's own hesitation about the
original diagram, inline: *"not sure if it is great to have this, also we
need not huge break of current code and stable updates, but also clean and
expandable and easy to collaborate code base."* That tension needed an
actual answer instead of an unmarked gap between the plan and the repo.

## Decision

**Keep the consolidated layout. Do not extract `agent-runtime`, `agent-sdk`,
`agent-react`, or per-channel packages.** Amend plan §3 to describe reality
rather than the original sketch — done alongside this ADR.

### Why consolidation wins today

- **Nothing external needs independent installation.** A split into
  separate packages earns its cost when something outside the monorepo
  needs to `npm install @larkup/agent-runtime` without also pulling in the
  Knowledge Server, or a third party builds against `@larkup/agent-sdk`
  directly. Neither is true: `packages/core`'s only consumer is `apps/web`,
  in the same repo, which already imports both halves.
- **The adapters are not large enough to be lost.** `packages/channels-core/src/adapters/`
  holds three files, roughly 250–310 lines each including their doc
  comments. A contributor finding "the Slack adapter" opens one file in one
  package; a `packages/channel-slack` package would add a `package.json`,
  a `tsconfig.json`, and a workspace entry for the same 300 lines.
- **The product owner's own stated cost is real.** Extracting four packages
  out of working, tested code — with no functional change to justify the
  churn — is precisely the "huge break of current code" the plan's own note
  warned against, for a benefit (independent publishability, per-package
  ownership boundaries) that has no consumer yet.

### What actually enforces the plan §1.1 boundary, if not package lines

Plan §1.1's real requirement is behavioral, not structural: a channel never
reaches a Knowledge Server directly, and an Agent's retrieval access is
read-only. Both hold today without a package boundary enforcing them:

- Every channel goes through `dispatchInbound` (`packages/channels-core/src/dispatch.ts`),
  which calls `runAgent` — never a Knowledge Server URL. An adapter has no
  Knowledge Server client to misuse even if it wanted to.
- `AgentKnowledgeSource.retrievalKey` (`packages/agent-contracts/src/agent.ts`)
  is a scoped credential, checked against the Knowledge Server's own
  `retrieval`/`ingest`/`admin` key scopes (ADR-004) — an Agent holding a
  `retrieval`-scoped key cannot index or administer regardless of which
  package the code calling it lives in.

A package boundary is one way to make an architectural rule self-enforcing;
it is not the only way, and this codebase's actual enforcement point is the
scoped-key check, not the directory structure.

### When to revisit

Extract when a real trigger appears, not preemptively:

- A consumer outside this monorepo needs `@larkup/agent-runtime` (or any of
  the others) as an independently versioned npm dependency.
- `packages/channels-core/src/adapters/` grows past the point where finding
  one adapter among many is real friction — WhatsApp and Discord (next in
  plan §9's delivery order) are unlikely to trigger this alone; a dozen
  marketplace-contributed channels might.
- `packages/core` needs to be deployed or scaled independently of the Agent
  Runtime it now also contains, which would make "Knowledge Server only"
  matter operationally, not just organizationally.

## Consequences

**Positive**

- Plan §3 describes the repository that exists. A contributor reading it
  before making a change is no longer misled about where code lives.
- No churn to working, tested code for a reorganization with no current
  beneficiary.

**Negative**

- `packages/core`'s name and its own module-level doc comments still say
  things like "Knowledge Server only" in places this ADR's decision
  contradicts at the package level (even though the *behavioral* boundary
  holds — see above). Left as-is rather than renamed, since a rename now
  would be exactly the same low-value churn this ADR argues against;
  worth revisiting together with an actual extraction, not separately from it.
