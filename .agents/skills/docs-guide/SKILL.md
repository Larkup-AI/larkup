---
name: docs-guide
description: Guidelines for writing, formatting, and updating documentation in the project. Covers the Mintlify docs setup and inline comments.
tags: docs, mintlify, mdx
---

# Documentation Guide

## External Documentation (Mintlify)

The official documentation for Larkup is housed in `apps/docs` using **Mintlify**.

1. **Format**: All docs are written in MDX (`.mdx` or `.md`).
2. **Structure**: 
   - `docs.json` controls the navigation sidebar. If you add a new page, you **must** link it in `docs.json`.
   - Pages are organized logically (e.g., `/guide`, `/api-reference`, `/sdk`).
3. **Local Dev**: To preview docs locally, you can use the Mintlify CLI.
4. **Style**: 
   - Keep paragraphs concise.
   - Use code blocks with appropriate language tags (`typescript`, `python`, `bash`).
   - Add screenshots when explaining UI flows.

## Inline Code Documentation

1. **JSDoc/TSDoc**: Provide docstrings for all exported functions, classes, and types in `@larkup/core` and SDK packages. This is crucial as developers will consume these programmatically.
   ```ts
   /**
    * Executes a query against the configured vector store.
    * 
    * @param query - The semantic search string.
    * @param topK - The number of nearest neighbors to retrieve.
    * @returns An array of results including text and score.
    */
   ```
2. **Clarity**: Explain *why* a piece of code exists if the logic is complex, rather than just stating *what* it does.
