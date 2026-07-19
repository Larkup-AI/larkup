# PR Command

Create a clean, standardized PR description for Larkup using the Github CLI (`gh pr create`).

Use the gh cli to open a PR for the current branch in the user's browser. Do not open it directly; use the web option (`--web`) so the user can edit the title/description before submission.

1. Use conventional commits in the PR title (e.g. `feat(core): add lancedb connector`, `fix(ui): adjust dialog padding`).
2. Include a short description of the problem solved.
3. Keep it casual but direct. Show simple code examples before/after for fixes, or just after examples for new features if relevant.
4. If it's a UI change, remind the user to attach a screenshot to the PR manually.
5. Do not add long lists or complex headings. Keep it simple and to the point.
