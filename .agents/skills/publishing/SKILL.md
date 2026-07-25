---
name: publishing
description: Publish and verify Larkup releases across npm, PyPI, Docker Hub, and git tags using Changesets and the repository release scripts. Use whenever a user says publish, republish, release, deploy packages, push a Docker image, apply changesets, or asks for a complete Larkup release.
---

# Publishing Larkup

Treat publishing as a release transaction. Never publish untested or uncommitted source, bypass
Changesets with manual npm version edits, or report success without registry verification.

## Release workflow

1. Read `running-and-testing-locally` and run the relevant unit, build, and E2E checks.
2. Inspect `git status`, the current branch/upstream, package manifests, `.changeset/*.md`, and
   `scripts/auto-publish.sh`. Preserve unrelated user changes and split source, docs, tooling,
   and generated release metadata into coherent conventional commits.
3. Run `pnpm changeset status`. Repair stale package names or missing changesets before continuing.
   Add a changeset for every publishable package whose shipped contents changed.
4. Confirm authentication with `npm whoami`, `uv`/PyPI credentials when publishing Python, and
   `docker info` plus `docker login` state. Do not print tokens.
5. Commit and push the tested source changes.
6. Run `pnpm changeset version`. Review every version and internal dependency update. Sync the
   Python SDK version when it is part of the release. Commit the generated version/changelog
   changes as `chore(release): version packages`, then push.
7. Run `scripts/auto-publish.sh --with-docker`. Use narrower flags only when the user explicitly
   excludes a registry. The script delegates npm, PyPI, and Docker publishing to their dedicated
   scripts.
8. Push release tags created by Changesets.
9. Verify each npm package with `npm view <name>@<version> version`, PyPI with
   `uvx --from pypi-json pypi-json` or the JSON API, and Docker with
   `docker buildx imagetools inspect aboneda/larkup:<version>`.
10. Finish only when `git status` is clean, local `HEAD` matches the upstream, and all requested
    artifacts are visible in their registries.

## Guardrails

- Use `pnpm changeset publish` for npm. It publishes only versioned, unpublished workspace
  packages and creates package tags; do not use recursive `pnpm publish -r`.
- Build publishable packages and run package pack/dry-run checks before making registry writes.
- Publish Docker with both the exact Web package version and `latest`, with
  `NEXT_PUBLIC_DOCKER_ENV=true`.
- Do not create a GitHub release merely to trigger workflows when local authenticated scripts can
  complete the requested release. If local credentials are unavailable, use the existing release
  workflows and verify their completion.
- Registry publishing is irreversible. Stop on a failed artifact, diagnose it, and resume
  idempotently; never bump versions again just to hide a partial release.
- Never publish internal apps (`@larkup/desktop`, proxy, E2E, deployment helpers, generators) or
  placeholder packages unless their manifests explicitly identify them as public release targets.
