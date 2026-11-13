# @larkup/workspace-app

Canonical Larkup client components. Local keeps import-compatible reexports; Cloud imports these package entry points. This package contains no database or filesystem adapters. Hosts supply authenticated API endpoints with the Local API contracts and a project context.

Import `components/chat/chat-workspace.tsx`, `components/data/data-workspace.tsx`, `components/data/project-data-page.tsx` or `components/settings/general/models-section.tsx`. Include `source.css` in the host Tailwind stylesheet.

## UI conventions

These components render a flat surface: separate content with borders, ring, and background tone, **never drop shadows**. Do not add `shadow` / `shadow-xs` / `shadow-sm` (or inline `box-shadow`) to any rendered or generated block — cards, panels, figures, metric blocks, diagrams, and the thinking indicator all stay shadowless. The in-answer renderer (`lib/chat/render-markdown.ts`) emits the same flat markup, and the model is barred from raw HTML/CSS, so generated answers follow this too.
