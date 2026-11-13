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

`executeAnalysis.analysisPlan` accepts a single source dataset, equality/inclusion
filters, sum measure, population grouping, comparison category, source units,
and optional numeric-year decade bucketing and expected group count. It produces
a complete table, tied winners, or a stacked bar from that same table. Unknown
columns/values, empty populations, missing/nonfinite measures, missing years,
coverage mismatches, and inconsistent totals fail closed. The plan does not
infer geographical scope or certify model-selected units; these still require
source evidence. Python remains available for calculations outside this contract.
Syntax is parsed before execution; escaped line separators are repaired only
outside Python strings/comments after parsing fails. Automatic code retries
run only when a supported repair changes the source.
