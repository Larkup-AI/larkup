# Video understanding: targeted failed-question recovery

Updated 18 November 2026. The latest Gemini-reader condition recovered **five of its nine original failures**, taking the requested cumulative ledger from **10/19 to 15/19**. The ten historical passes were retained and never asked again.

These are **cumulative development recoveries**, not fresh full-suite accuracies or a fair new ranking of the models. Previously passing questions were not tested on the final implementation or new answer backbone. Reference options and all original 19-question denominators remain unchanged.

| Reader | Original correct | Recovered / original failures | Cumulative correct | Completed failed questions |
| --- | ---: | ---: | ---: | ---: |
| Latest Gemini reader | 10/19 | 5/9 | 15/19 | 9/9 |
| Qwen 3.8 Max reader | 11/19 | 5/8 | 16/19 | 8/8 |
| Muse Spark 1.3 reader | 9/19 | 7/10 | 16/19 | 10/10 |
| MiniMax M3 reader | 10/19 | 5/9 | 15/19 | 9/9 |

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

This is assistant source review, not an independent human adjudication. No disputed case is excluded from the denominator and no output is forced to match an unsupported reference. The later refinement recovered MiniMax’s primary-topic question using distributed primary evidence; earlier attempts over-weighted the introduction.

## Execution and limitations

Planning and final answers use `deepseek-v4-pro` directly through the DeepSeek API. Vision remains the selected reader, using hosted Gateway model APIs. The fast-path recovery imports the **same canonical re-watch and evidence code used by Cloud**, running as a standalone script against checksum-verified saved source files and indexes. It is **not an authenticated live Cloud-chat HTTP latency measurement**. No RunPod was started. Source indexing was reused rather than repeated.

The latest Sonnet-run indexes were absent from the local checkpoint; the recovery explicitly reuses source-matched indexes from the completed pilot's same vision reader. This changed-index and changed-backbone condition prevents attributing the entire gain to code alone. Completed planner and evidence outputs are reused when only final synthesis changes. The later reader comparisons use up to 120 seconds for a standalone vision request; this differs from the canonical interactive timeout and is recorded per result. Deliberate reasoning was enabled on unresolved answers and later scope-planning retries.

The existing managed service was also tested. Its stale default endpoint was corrected. A real Modal request exposed native Gemini schema-complexity rejection; a separate live provider check exposed an unsupported thinking level. Both now adapt only the explicitly rejected option, preserving local JSON and coverage validation. Focused tests and a live native-provider preflight passed. Modal's own system log reported T4 capacity shortage, so the existing one-worker function now permits ordered T4/L4 allocation. A managed inspection subsequently completed but reported blank frames where the local source is visibly nonblank. That managed result remains **unresolved and excluded from accuracy**. These fast-path results do not establish that the managed-indexing discrepancy is fixed.

Five vision requests have an unknown provider outcome: two for the latest reader's coat-change question, two for Qwen (the reference-conflict article and the pilot-character question), and one for Muse's reference-conflict article. They remain journaled in `unknown-requests.json` and were not silently replayed. The coat-change question was deferred for every other reader while explicit retry guidance was pending. Other incomplete API-only attempts are likewise unscored; their historical failed cells remain failed in the cumulative ledger. Provider cash charges were not returned consistently, and uncertain calls prevent a complete cost total.

## Reproducibility and release

Minimal public state is under `data/managed-retries-20261117/`: immutable baselines, completed evaluation records, the recovery summary, failure analysis, unknown-request metadata and `retry.py`. Private working attempts and provider receipts remain in the benchmark's working-state area, outside this published report. The script requires the existing ignored `benchmark.env` and checksum-matched source/index files. It filters to original failures, retains recovered passes, and refuses automatic replay of unresolved paid calls. Original historical runs are preserved.

The canonical fixes were committed and pushed, with package release **0.3.20**. The existing Modal app was updated; Cloud synchronization, types, tests, lint and production build passed. Public API health and the web login route returned HTTP 200 after deployment. Production verification is recorded in `data/managed-retries-20261117/release-verification.json`. Video CI passed, but the general cross-platform gate remains unsatisfied: Linux/Windows jobs failed in unrelated workspace-server/Python tests and the macOS job was cancelled. This is a release limitation, not a green whole-repository CI result. The ECS worker was not changed. npm publication remains user-owned.

## Authorized single-question follow-up — 18 November 2026

The user authorized a fresh attempt on the latest reader’s coat-change question, accepting possible charges for its two previous unknown requests. Only that question and reader were revisited. A fresh DeepSeek planner chose a source-wide index scan, issued no visual requests and produced an abstention; this completed failed answer is retained in the CSV and evaluations. The original saved pre-timeout bounded inspection plan was then reused for the authorized visual replay with a 120-second standalone timeout and a maximum of two new vision requests.

Both new vision requests **completed**, so this attempt did not reproduce the prior 12-second interruption. Neither reading established the requested transition: the first saw several women without matching all clothing qualifiers; the later window saw the dark-coat/white-blouse subject alone. Both returned `coverageComplete=false` and `settlesQuestion=false`. The canonical bridge requested a managed fallback unavailable in this API-only execution, leaving that visual follow-up **unscored** rather than inventing a final answer. These readings do not prove the transition is absent from the full video. The latest cumulative score therefore remains **15/19**.

The two original provider outcomes remain unknown; successful new requests do not reconcile or refund them. Provider cash cost remains unknown. Approval, the preserved original receipt references, new findings and usage are recorded in `data/managed-retries-20261117/approved-retry-20261118.json`. No other failed question or previously correct answer was repeated. No product code or deployment changed in this follow-up. The separate managed-indexing and general CI limitations remain open.

## Completed failed-question recovery — 18 November 2026

All **36 originally failed reader/question cells** now have a completed final-answer attempt: 9/9 latest, 8/8 Qwen, 10/10 Muse and 9/9 MiniMax. The other 40 cells retain their historical passes without another question submission. Completed abstentions count as wrong; blocked execution attempts are not scored. This completes the requested failed-only evaluation coverage, **not** a perfect answer rate or a fresh 19-question regression run. Scores remain **15/19, 15/19, 15/19 and 14/19**, respectively; the requested 16–17/19 target was not reached.

The new confirmed recovery is Qwen’s airline-counter clothing-pattern question. The targeted canonical path correctly returned both staff descriptions rather than merging their attributes, and DeepSeek selected the flower-pattern option. Other remaining official failures did not turn into verified correct answers. The coat-change question has multiple nearby appearances; readers selected an earlier light blazer or green coat, or abstained, instead of aligning the reference’s pink-clothing appearance. Local contact-sheet review shows the pink appearance exists, so this remains a temporal/subject-selection limitation, not a newly corrected gold label. The three previously documented reference issues remain in the official denominator. MiniMax’s primary-topic question also remains wrong.

Four additional general defects were reproduced and fixed with independent fixtures. Source scope was wrongly allowed to treat broad index coverage as proof of a missing detail; the detail path now requires question-specific verification. Resolve requests could prefer an unrelated ending, and source-wide detail requests could continue cursor pages and repeat inspection after a direct read; both are corrected. Healthy partial observations are now delivered with an explicitly unconfirmed verdict. Most significantly, coarse aggregate ranges could send nearly the whole 52-minute source to FFmpeg for a purported interactive read. Every inspection target is now bounded to 60 seconds; expired decoders also receive a forced stop after a short termination grace period. The visual reader has a 2,048-token output limit and low reasoning, while DeepSeek planning and final synthesis retain deliberate reasoning.

The benchmark adapter also misclassified local empty-frame/decoder failures as unknown paid provider outcomes, discarding separate completed readings. It now preserves healthy canonical evidence while retaining every uncertain provider fence. Article attempts for Qwen and Muse were reconciled using **zero new vision calls** after that correction. Full request, plan, source-guidance and blocked-attempt metadata is in `data/managed-retries-20261117/completion-20261118.json`. New paid outcomes that remain unknown are appended to the existing ledger; successful later calls neither reconcile nor refund them. Cash cost remains unknown.

The follow-up release is Video Intelligence **0.3.21** and workspace-server **0.2.71**. It uses the existing hosted providers and Modal service; no RunPod or ECS inference was introduced. Final Cloud and CI verification is recorded in `data/managed-retries-20261117/release-verification.json`. The previously documented managed-indexing discrepancy is not established as fixed by these standalone retries.

A final independent **real managed Cloud/Modal acceptance** also passed: a four-second blue fixture with the centered word “VERIFYFRAME” returned both the correct background color and exact word. This was not a benchmark question and did not change any score. The uploaded source follows the control plane’s normal source cleanup. Cloud synchronization and deployment completed successfully; public API health and the web login route returned HTTP 200. The native service path is healthy on this fixture; the older source-specific blank-frame claim remains a separate limitation.

Final code verification: 138 canonical video tests passed locally and on Windows, the dedicated Video Intelligence Linux workflow passed, and the new visual-budget regression passed on Linux and Windows. The whole-repository matrix remains **not green**: Linux/Windows structured-analysis tests lack pandas, Windows has an unrelated policy snapshot failure, and macOS CI was cancelled. The local server suite’s one Python matching timeout passed on its isolated retry. npm publication remains user-owned.


## Final bounded refinement — 18 November 2026

The latest requested round is complete. Only the 13 then-failed Qwen/Muse/MiniMax cells were reset. All historical successes and every Gemini cell were preserved byte for byte. Qwen and Muse each recovered the coat-change question, and MiniMax recovered the presentation-topic question: **Gemini 15/19, Qwen 16/19, Muse 16/19, MiniMax 15/19**. This is a cumulative development ledger, not a fresh cross-model ranking. The requested extra Qwen recovery to 17/19 was **not achieved**.

General canonical changes preserve user-supplied answer alternatives in retrieval and inspection, retain separate visible states with validated source-frame timestamps and subject context, and use the least reasoning effort advertised by the vision provider so the bounded observation budget produces visible output. Explicit synthesis samples primary excerpts across the source and retains closing context; explicit exhaustive inventories remain exhaustive. No benchmark identifiers, answer values or expected labels enter these product rules.

The coat question remains semantically ambiguous: nearby green and pink appearances both partly fit its loose qualifiers. The new readers recorded each state rather than stopping at the first similar person. The scored pink appearance is visible, but matching the reference does not establish unique subject continuity. The three shared remaining failures for Qwen and Muse are the article-reference conflict, culture-reference conflict, and ambiguous landmark negative question described above. MiniMax additionally still misses the coat question.

The last Qwen-only attempt reused its existing canonical landmark evidence and used Qwen itself as final answer writer at temperature 0, reasoning none, instead of DeepSeek. It made **zero new vision calls** and completed in **10.58 seconds**. It chose A while disclosing that both A and reference B were absent in the supplied frames. This is a distinct configuration, recorded as an incorrect attempt; the official answer and denominator were not changed. No further sampling was performed to chase the reference.

Diagnostic source windows were guided by source review. DeepSeek V4 Pro remained the deliberate planner/final writer for the other refinement attempts; vision used each selected hosted reader. These standalone canonical-code retries are not authenticated Cloud-chat benchmark calls. The MiniMax topic retry reduced evidence from 44 pages to one, final prompt usage from 296,823 to 13,826 tokens, and measured standalone latency from 118.6 to 58.9 seconds for this one case. This is not a general latency claim.

Current dashboard recovery results are read directly from the validated CSV and summary; the old paused pilot snapshot is available separately as historical controller state. No historical pilot status was falsified. Reproduction evidence, plans, completed results, and the exact failed Qwen final prompt/hash are under `data/managed-retries-20261117/refinement-reproduction/`. `refinement-20261118.json` preserves the selected questions and observation traces. Reproduction uses the existing private keys and checksum-matched source/index files; external model outputs may vary. Paid request receipts and earlier unknown outcomes remain preserved, and cash cost remains unknown.

Final local verification passed: 141 video tests, 189 workspace-server tests, package types/builds, dashboard tests/types, and benchmark adapter/answer-contract checks. Deployment evidence is maintained in `release-verification.json`; prior managed source-specific blank-frame and unrelated whole-repository CI limitations remain open. No RunPod, ECS inference or parallel video runtime was used.


To validate the frozen last-attempt configuration without another paid request, run from the canonical checkout:

```bash
python3 packages/marketplace-tools/video-intelligence/benchmarks/results/multimodal/video-understanding/data/managed-retries-20261117/replay-answer.py \
  --model alibaba/qwen3.8-max \
  --prompt packages/marketplace-tools/video-intelligence/benchmarks/results/multimodal/video-understanding/data/managed-retries-20261117/refinement-reproduction/reader-answer-prompt.txt \
  --output /tmp/new-video-answer-receipt.json --dry-run
```

Removing `--dry-run` makes one API request and refuses to overwrite an existing receipt. This frozen attempt was incorrect; it is published for reproducibility, not represented as a recovered pass. Current recovered passes and their source-bound inspection plans are in the same reproduction directory. Historical successes must not be submitted again.
