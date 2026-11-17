---
'@larkup/tool-video-intelligence': patch
---

Stop the evidence agent from reporting an indexed source as silent. When
targeted ranked and scoped retrieval do not establish the answer — returning
nothing, or nothing that bears on the question, which is common across
languages and for broad thematic questions — the agent now pulls a source-wide
read of the index and merges it behind the targeted hits before narrowing to
located ranges, so an answer-bearing record indexed in different words can
reach the reader. This read is bounded, not a guaranteed complete scan; the
deterministic scan route still owns exhaustive coverage. This fallback preserves evidence without treating retrieval coverage as proof that a question is answered.

When that broad read is the only evidence, the answering verdict asks the
reader to judge whether it actually answers the question and give the
best-supported answer, or else say what is established and what remains
unshown, rather than abstaining outright or treating an indexed record as the
answer by itself. It sits after the identity and attribute guards, so those
constraints still govern who a detail may be attached to.

Sequence questions are told to order by meaning: by first mention when the
question asks what was introduced or presented, and by occurrence on the source
clock when it asks what happened — a spoken mention is not the event occurring.
Visual-detail questions are told to read the asked-for attribute off the
observations of the requested moment rather than from narration or a
neighbouring frame.
