# @larkup/workspace-server

Canonical Larkup chat API and tools. Local routes reexport these implementations. Cloud runs the same handler within `runWithWorkspaceHost` from core, providing request-scoped, authenticated storage, model credentials, and retrieval. The host must select the project before invoking a handler.

Research retrieval uses a bounded candidate pool and semantic passage selection for
substantive questions, preserving complementary definitions and source conflicts.
Data dictionaries are matched by resource filename and field name. Explicit source
links supersede stale sidecars without deleting them. The selected model handles research selection and analytical planning; provider
failover never silently substitutes a different model. The live Gateway catalog
is cached, and retired selections are rejected before research begins. Reranker usage is accounted for and timeout fallback is
reported as tool diagnostics.

Historical user requests are compact context, never verified factual evidence.
Every substantive research question still requires current accessible sources.
Validated structured tables remain the visible result; execution diagnostics and
rejected calculations are excluded from answer evidence.
