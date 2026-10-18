# @larkup/workspace-server

Canonical Larkup chat API and tools. Local routes reexport these implementations. Cloud runs the same handler within `runWithWorkspaceHost` from core, providing request-scoped, authenticated storage, model credentials, and retrieval. The host must select the project before invoking a handler.
