---
'larkup': patch
'@larkup/core': patch
---

fix: define the missing `persistApiKey` helper and clear the two standing `tsc` errors (TASK 01 tail)

`apps/web/components/server/deploy-sheet.tsx` called `persistApiKey(sid, apiKey)`
on the SSH deploy path, but the function was never defined — a `ReferenceError`
waiting to happen and a standing `tsc` error. It's now a small helper that
`POST`s to `/api/config/credentials`, awaited before the deploy payload is
built so the deploy request can no longer race the credential write.

`StoredCredentials.serverApiKey` is a single flat value for the workspace, not
keyed per server, matching what the Vercel deploy path already does — the
helper takes just the key, not a server id, rather than implying per-server
support the store doesn't have.

Also fixes:
- `server-section.tsx`: an interval ref typed via
  `ReturnType<typeof window.setInterval>` resolved to `NodeJS.Timeout` (from
  `@types/node`'s merged overload) instead of the `number` the DOM call
  actually returns. Typed directly as `number`.
- `generate-agent-runtime.ts`: the bundle's file list was typed as
  `GeneratedFile[]` before the `language` field was attached by the trailing
  `.map()`, so every literal failed the type check. Typed the pre-`map` array
  as `Pick<GeneratedFile, 'path' | 'contents'>[]` instead.
- `e2e/tests/web-ui/04-server.spec.ts`: the "cloud deployments link directly
  to their API reference" test seeded the legacy `rag_server_api_key`
  localStorage key, which `server-section.tsx` no longer reads — it loads the
  key from `/api/config/credentials`. The test now seeds through that same
  endpoint.
- `e2e/tests/sdk/js-sdk.spec.ts`: reverted an in-flight edit that imported
  `LarkupClient` from the `apps/sdk/js-sdk` package directory (unsupported for
  a relative import under Node ESM) back to the working `src/index` import.
  This was blocking Playwright's test collection for the entire suite, not
  just the SDK tests.

`pnpm exec tsc --noEmit -p apps/web/tsconfig.json` is clean, `pnpm turbo
type-check build` is green, and the full E2E suite passes.
