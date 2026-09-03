---
'@larkup/tool-video-intelligence': minor
'@larkup/marketplace': patch
'@larkup/core': minor
---

Make video indexing and retrieval work the same for any kind of video, and
make an indexing job's progress reflect the work it is doing.

Indexing and retrieval both carried rules written for one kind of footage: a
question planner that branched on sport vocabulary in English and Arabic, an
OCR pass that only kept paired numbers under 30, and prompts that told the
reader how to interpret a two-sided display. Those rules answered a narrow set
of questions on a narrow set of videos and quietly distorted everything else.
They are replaced by signals that mean the same thing in any recording: which
short on-screen text persists and when it changes, whether a question wants one
fact or the whole source, and whether a state sequence is consistent with
itself over time.

The retrieval agent now runs one gap-driven loop rather than a set of
per-question-type rules: it retrieves, decides what the evidence still lacks,
watches the moments the index pointed at, and re-checks. Independent moments are
watched together instead of one after another, which cuts a multi-range turn to
roughly the cost of its slowest look, and a runtime that admits one job at a
time is handled by falling back to one at a time rather than failing the turn.
An answer a question was watched for is now recognised by what produced it,
rather than by the reader repeating the question back.

Progress is budgeted by how long each phase actually takes and advances between
milestones, so the bar moves the whole way through rather than sitting still and
then jumping. The runtime reports how far through its current stage it is, so a
host rendering one bar per step no longer keeps its own copy of that budget.

The three coverage modes now have non-overlapping budgets, so Fast can no longer
plan more work than Balanced.

The index's own reconciled account is now published as retrievable evidence.
The runtime already cross-checks every reading of a moment against the rest of
the timeline, but only the raw readings reached retrieval, so chat could answer
from a reading the index had already set aside. Evidence that reconciles other
evidence now leads the answer.

The managed cloud worker's bulk reader moves to a stronger model. Measured on
the same GPU and source, the previous one misread a two-sided on-screen display
and produced a wrong index while also finishing slower, because a weaker reader
costs more retries than it saves.
