---
name: tool-building-guide
description: Generic guidelines and standards for AI agents when tasked with creating new tools or major features (like document editors, form fillers, video processors). Covers architectural decisions, lightweight principles, and the sandbox.
tags: tools, architecture, marketplace, sandbox, dependencies, lightweight
---

# Agent Guide: Building New Tools & Major Features

When the user asks you (the agent) to build a **new tool** or **complex feature** (e.g., Form Filling, Video Editing, Advanced Parsing), you must follow these standard rules to ensure the codebase remains efficient, lightweight, and scalable.

## 1. Architectural Decision: Where should this live?

Before writing any code, analyze the complexity and dependencies of the requested tool to decide its location:

- **Core Feature (`apps/web` or `@larkup/core`)**:
  - *Criteria*: Lightweight, zero or minimal new dependencies, universally needed by all users.
  - *Example*: A simple text formatting utility or a lightweight API wrapper.
  
- **Marketplace Tool (`packages/tools/<tool-name>`)**:
  - *Criteria*: Huge feature, niche use-case, or requires heavy third-party dependencies (e.g., Python libraries, `ffmpeg`, massive SDKs).
  - *Rule*: Never bloat the core application with heavy dependencies. Isolate them into an optional marketplace tool that users can install on-demand.
  - *Action*: Follow the `marketplace-tools` skill to create a new plugin package.

- **Sandbox Execution (`@larkup/sandbox`)**:
  - *Criteria*: Requires complex data manipulation (e.g., editing PPTX/Word docs natively, running untrusted code, specialized python scripts).
  - *Rule*: Do not try to natively implement extremely complex parsing in Node.js if a Python script can do it easily. Instead, have the tool generate a script and execute it securely within the Docker Sandbox (`@larkup/sandbox`).

## 2. Think Lightweight & Efficient

- **Strict Dependency Control**: Always think twice before adding an `npm` or `pip` package. Ask: "Is this strictly necessary? Can I do this natively?"
- **Clean the Footprint**: If you create a new package, immediately update its `.npmignore` and the root `.dockerignore` to ensure build sizes remain minimal.
- **Lazy Loading**: UI components related to heavy tools (like a Canvas split-view for document editing) should be lazily loaded (`next/dynamic` or React `lazy`) so they don't impact the initial load time of the chat interface.

## 3. Standard Development Flow

When building the tool, automatically execute the following standard procedures:

1. **E2E Tests**: Always write or update Playwright tests in `e2e/` to verify the tool's core logic and UI components. Never leave broken tests.
2. **Analytics Tracking**: If the tool interacts with LLMs or performs heavy operations, implement usage tracking. (Reference the `analytics-tracking` skill).
3. **Cross-Platform Parity**: A tool built for the Web UI must be synced across the ecosystem. Update the **CLI**, **SDK**, **Desktop** app, and **Documentation** to support or mention the new tool.
4. **Docker Updates**: If the tool introduces a new system requirement (like a Linux package) needed for the server to run the tool, update `docker/Dockerfile`.

## 4. UI/UX Principles for Tools

- **Non-Intrusive**: Tools should blend smoothly into the user's workflow. (e.g., an attachment button in the chat, rather than a completely separate dashboard).
- **Split-View (Canvas) Paradigm**: For tools that edit files (documents, code), implement a split-screen view where the chat remains on the left, and a live, minimal preview of the file updates dynamically on the right.
- **Premium Aesthetics**: Keep the UI clean, modern, and aligned with Larkup's premium design standards (use Shadcn, Framer Motion for smooth transitions, and minimalistic previews).

---
**Summary for Agents:**
Do not rush to code. Plan the architecture, isolate heavy dependencies into Marketplace tools or Sandbox executions, keep the core light, and write tests.
