# Changeset

Create a changeset using the CLI. The goal of changesets is to use it for generating changelogs. Individual package changelogs will later be combined into a single changelog that is published with each release.

## CLI Usage

Run the CLI with the following command to create a changeset:

```bash
pnpm changeset -s -m "your changeset message" (--major | --minor | --patch) pkg-name
```

For each package that has changes, run the CLI once and specify the appropriate version bump type (`--major`, `--minor`, or `--patch`) and message for that package. This will create a separate changeset file for each package, which is important for generating accurate changelogs.

**Arguments:**

- `-s` or `--skipPrompt`: Run non-interactively; requires at least one of `--major`, `--minor`, or `--patch` (required for automation)
- `-m "message"` or `--message "message"`: The changeset message (required)
- `--major pkg-name`: Packages that should have a major version bump
- `--minor pkg-name`: Packages that should have a minor version bump
- `--patch pkg-name`: Packages that should have a patch version bump

**Notes:**

- The bump type must be specified explicitly for each package; use `--major` or `--minor` for non-patch bumps
- Multiple packages can be specified by repeating the flag: `--minor @larkup/core --minor larkup`

## Version Bump Types

- `patch`: Bugfixes with backward-compatible changes
- `minor`: New features with backward-compatible changes
- `major`: Breaking changes that are not backward-compatible

## Message Guidelines

- Write short, direct sentences that anyone can understand. Avoid commit messages, technical jargon, and acronyms. Use action-oriented verbs (Added, Fixed, Improved, Deprecated, Removed)
- Highlight outcomes! What does change for the end user? Do not focus on internal implementation details
- Add context like links to issues or PRs when relevant
- Keep the formatting easy-to-read and scannable.

**Important:** Very long changesets in one file (with multiple packages in the frontmatter) are an anti-pattern. This will lead to multiple packages having really large changelog entries. This must be avoided.
