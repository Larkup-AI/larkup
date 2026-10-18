# @larkup/workspace-app

Canonical Larkup client components. Local keeps import-compatible reexports; Cloud imports these package entry points. This package contains no database or filesystem adapters. Hosts supply authenticated API endpoints with the Local API contracts and a project context.

Import `components/chat/chat-workspace.tsx`, `components/data/data-workspace.tsx`, `components/data/project-data-page.tsx` or `components/settings/general/models-section.tsx`. Include `source.css` in the host Tailwind stylesheet.
