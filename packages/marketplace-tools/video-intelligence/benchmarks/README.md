# Video Intelligence benchmarks

This directory owns the standalone video-tool benchmark in the canonical
`larkup` repository. It does not benchmark or boot the whole Larkup application.

- [Implementation plan](data/implementation-report.md)
- [Local dashboard API contract](data/dashboard-api-v1.md)
- Private credentials: `benchmark.env` (already populated, ignored by Git and
  Docker; includes `RUNPOD_APIKEY` and the model/speech provider keys).
- Future harness: `harness/`; future local dashboard: `apps/video-dashboard/`.

The next agent should read the plan before implementation. Dashboard work is a
separate task against the versioned contract. Do not print or commit credentials.
