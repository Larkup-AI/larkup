---
'@larkup/tool-video-intelligence': minor
'@larkup/marketplace': minor
'larkup': minor
---

Video indexing now takes notes instead of describing frames, and a chat question
that the index cannot settle is answered by re-reading the source directly
instead of dispatching a re-index.

**Indexing.** The per-clip reader was instructed to describe only what a clip's
own pixels showed and never to use on-screen text or speech to identify anyone,
which produced entries like "a man in a jersey sits on a couch" alongside
detector class lists ("person, chair, couch"). It now writes notes the way a
person would if they had to answer questions from them later: what happened and
what changed, who was involved and what established each identity, and every
informative piece of on-screen text read exactly and attached to what it labels.
How much a note carries scales with the requested coverage (fast / balanced /
thorough), and the indexing hint steers what gets the most detail. Detector class
lists and low-confidence text no longer enter the searchable notes at all; both
remain queryable as their own evidence.

**Answering.** A question the index could not settle previously dispatched a
bounded re-index: a cold GPU worker, minutes of wall time, and frequently a turn
that expired before it returned, which reached the user as the video not showing
something it plainly did. The host now exposes a `reWatch` capability that
samples the candidate windows off the source and reads them in one multimodal
request per window, with the windows read together. The dispatched path remains
as the fallback behind it.

**Transcription.** Local Whisper ran with voice detection always on. Over
continuous background noise it discards speech rather than finding silence: on a
noisy source it kept 2 segments where a second pass without it recovered 66, and
a whole recording indexed with 5% of its speech. It now measures how much of the
source the first pass found and re-decodes without voice detection when that is
implausibly low, keeping whichever pass heard more.

Also fixes three answering bugs found while testing against a real index:

- A question settled by a trail of evidence rather than one record returned an
  empty evidence list, so the reply had nothing to cite and reported the source
  as silent.
- A question about a conclusion spent one of its bounded looks on the opening of
  the source, where the answer cannot be.
- A question about a whole progression spread its looks evenly across the
  source, landing between the moments it changed instead of on them.

Also raises the reader's output budget. Current readers spend most of a small
budget before emitting any content, so the previous interactive ceiling produced
truncated, unparseable results rather than shorter ones.

Measured on a 14.6-minute source: indexing 131s (balanced), and a bounded
re-watch 660ms to sample plus ~14s to read, against minutes for the dispatched
path.
