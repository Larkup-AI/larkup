---
'@larkup/tool-video-intelligence': minor
'@larkup/marketplace': minor
'@larkup/core': minor
'larkup': minor
---

Make indexed video evidence findable and answerable.

Retrieval now ranks the evidence at its own timestamps using the workspace
embedding model, so a question asked in one language locates a moment recorded
in another; the corpus only ever matched chapter-sized documents, and lexical
scoring matched nothing at all across languages. Every timestamped signal is
fused into a short ranked list of windows, which both aims bounded source
inspection and gives the model a compact map to navigate by, replacing offsets
computed from the recording's length.

A conclusion, a count, and a comparison are settled by reading across records
rather than by finding one that states the answer. Requiring a single record
made those questions report the source as silent even when its closing state was
plainly indexed; they are now answered from a chronological trail, with the
answering rule stating how far that trail goes.

Also fixes: the chapter/scene hierarchy was scoped to one revision, so a single
refinement replaced the whole map of a source; the loader served a workspace
tool's stale build until the host restarted; and a live analysis showed a
completed progress bar for the minutes of work that follow the worker's own pass.
