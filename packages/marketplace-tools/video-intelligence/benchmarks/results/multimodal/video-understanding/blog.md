# Video understanding: targeted failed-question recovery

17 November 2026. The latest Gemini-reader condition recovered **five of its nine original failures**, taking the requested cumulative ledger from **10/19 to 15/19**. The ten historical passes were retained and never asked again.

These are **cumulative development recoveries**, not fresh full-suite accuracies or a fair new ranking of the models. Previously passing questions were not tested on the final implementation or new answer backbone. Reference options and all original 19-question denominators remain unchanged.

| Reader | Original correct | Recovered / original failures | Cumulative correct | Distinct scorable retries |
| --- | ---: | ---: | ---: | ---: |
| Latest Gemini reader | 10/19 | 5/9 | 15/19 | 7 |
| Qwen 3.8 Max reader | 11/19 | 3/8 | 14/19 | 5 |
| Muse Spark 1.3 reader | 9/19 | 6/10 | 15/19 | 7 |
| MiniMax M3 reader | 10/19 | 4/9 | 14/19 | 7 |

The latest baseline is `run-79f3b55b0359ec26d60c`. The other readers use the completed pilot requested by the user, `run-9d45724237e86021e098`; its first and second reader phases are joined by question ID, giving exactly 19 unique questions per reader. Baseline passes remain immutable. `results.csv` records every retained or retried answer, output origin, official option, attempt count, measured standalone latency, reasoning setting, timeout and available token usage. Empty cash-cost fields mean **unknown**, not zero.

## What failed

The drop from 11/19 to 10/19 did not isolate one code regression: the historical runs changed model/reader and indexing settings, and recorded revisions did not capture every intermediate working-tree adjustment. The saved latest-run answers show concrete defects regardless of that comparison:

- A retrieved performer with a conflicting shirt was substituted for the requested performer. Explicit source ranges now bound every read, including fallbacks.
- Generic scene relevance was treated as verification of a specific comparison detail. A declared comparison now requires question-specific evidence; separately observed states are retained as partial evidence rather than discarded.
- A short final chunk missed the beginning of the relevant last scene. Both boundary reads now cover a complete bounded window.
- A 12-second re-watch deadline abandoned healthy provider responses and fell through to much slower indexing. The canonical fast read now receives 30 seconds within its existing 40-second overall budget.
- The final answer writer received repeated source context and display payloads. Exact duplicate records and presentation-only data are removed while distinct events and conflicting readings remain. The diagnosed ordering prompt shrank from 297,096 to 211,623 serialized characters. Its wrong option contradicted its own cited timestamps; deliberate DeepSeek reasoning and option/explanation consistency checks recovered it.
- Quoted labels could be missed when OCR joined words. Source navigation now normalizes spacing and Unicode width and exposes observed OCR anchors and their source-clock positions.

`data/managed-retries-20261117/failure-analysis.csv` contains all nine latest-run failures, their observable signatures and remaining limits. These are development diagnoses; no benchmark identifiers, values or answers were inserted into product behavior.

## Reference issues stay in the official score

Source review found two strong content/reference conflicts and one ambiguous negative-choice question:

| Question | Source review | Official reference retained |
| --- | --- | --- |
| `longvideobench-Fw1rirubXiU_0` | The article graphic adds sunglasses, rather than a hat. | B |
| `video-mme-010-1` | The source teaches intercultural communication and cultural intelligence, rather than rapid foreign-language mastery. | C |
| `video-mme-010-3` | The final landmark sequence shows the Taj Mahal, Eiffel Tower, Statue of Liberty, Petronas Towers and pyramids; both the White House and Big Ben are absent from the reviewed sequence. | B |

This is assistant source review, not an independent human adjudication. No disputed case is excluded from the denominator and no output is forced to match an unsupported reference. MiniMax also retains one unresolved real failure on the presentation's primary focus; an introductory title alone was insufficient, and a source-wide retry still chose the wrong official option.

## Execution and limitations

Planning and final answers use `deepseek-v4-pro` directly through the DeepSeek API. Vision remains the selected reader, using hosted Gateway model APIs. The fast-path recovery imports the **same canonical re-watch and evidence code used by Cloud**, running as a standalone script against checksum-verified saved source files and indexes. It is **not an authenticated live Cloud-chat HTTP latency measurement**. No RunPod was started. Source indexing was reused rather than repeated.

The latest Sonnet-run indexes were absent from the local checkpoint; the recovery explicitly reuses source-matched indexes from the completed pilot's same vision reader. This changed-index and changed-backbone condition prevents attributing the entire gain to code alone. Completed planner and evidence outputs are reused when only final synthesis changes. The later reader comparisons use up to 120 seconds for a standalone vision request; this differs from the canonical interactive timeout and is recorded per result. Deliberate reasoning was enabled on unresolved answers and later scope-planning retries.

The existing managed service was also tested. Its stale default endpoint was corrected. A real Modal request exposed native Gemini schema-complexity rejection; a separate live provider check exposed an unsupported thinking level. Both now adapt only the explicitly rejected option, preserving local JSON and coverage validation. Focused tests and a live native-provider preflight passed. Modal's own system log reported T4 capacity shortage, so the existing one-worker function now permits ordered T4/L4 allocation. A managed inspection subsequently completed but reported blank frames where the local source is visibly nonblank. That managed result remains **unresolved and excluded from accuracy**. These fast-path results do not establish that the managed-indexing discrepancy is fixed.

Five vision requests have an unknown provider outcome: two for the latest reader's coat-change question, two for Qwen (the reference-conflict article and the pilot-character question), and one for Muse's reference-conflict article. They remain journaled in `unknown-requests.json` and were not silently replayed. The coat-change question was deferred for every other reader while explicit retry guidance was pending. Other incomplete API-only attempts are likewise unscored; their historical failed cells remain failed in the cumulative ledger. Provider cash charges were not returned consistently, and uncertain calls prevent a complete cost total.

## Reproducibility and release

Minimal public state is under `data/managed-retries-20261117/`: immutable baselines, completed evaluation records, the recovery summary, failure analysis, unknown-request metadata and `retry.py`. Private working attempts and provider receipts remain in the benchmark's working-state area, outside this published report. The script requires the existing ignored `benchmark.env` and checksum-matched source/index files. It filters to original failures, retains recovered passes, and refuses automatic replay of unresolved paid calls. Original historical runs are preserved.

The canonical fixes were committed and pushed, with package release **0.3.20**. The existing Modal app was updated; Cloud synchronization, types, tests, lint and production build passed. Public API health and the web login route returned HTTP 200 after deployment. Production verification is recorded in `data/managed-retries-20261117/release-verification.json`. Video CI passed, but the general cross-platform gate remains unsatisfied: Linux/Windows jobs failed in unrelated workspace-server/Python tests and the macOS job was cancelled. This is a release limitation, not a green whole-repository CI result. The ECS worker was not changed. npm publication remains user-owned.
