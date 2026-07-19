# Fix Lint for PR

Fix linting issues for the current branch, then push the changes.

## Step 1: Check for Clean Working Directory

Before running fixes, ensure there are no uncommitted changes:

RUN git status --porcelain

If there are uncommitted changes, warn the user and ask how to proceed (stash, commit, or abort).

## Step 2: Run Lint and Format Fixes

Run the lint command to auto-fix issues:

RUN pnpm lint --fix

## Step 3: Check for Changes

Check if any files were modified by the linting:

RUN git status

If there are no changes, inform the user that the branch is already properly formatted and linted.

## Step 4: Commit and Push

If there are changes, commit them. Only stage the modified files (not untracked files that may be local):

RUN git add -u
RUN git commit -m "chore: fix lint and formatting issues"

Push to the current branch:

RUN git push
