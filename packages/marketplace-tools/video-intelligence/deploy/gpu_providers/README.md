# GPU providers

Clients for dispatching GPU compute to run one video-indexing job. Every
provider implements the same interface in [`base.py`](base.py):

```python
provider = get_provider("modal")  # DEFAULT_PROVIDER; or "runpod", "vast",
                                   # "shadeform", "salad", "scaleway",
                                   # "thundercompute", "gpuai", "northflank",
                                   # "hyperstack"
instance_id = provider.launch(job_id=job_id, image=worker_image, env=worker_env, gpu_type="RTX_4090")
provider.get_status(instance_id)  # -> InstanceStatus(state=...)
provider.get_result(instance_id)  # job-queue providers only; see below
provider.get_progress(instance_id)  # job-queue providers only; see below
provider.terminate(instance_id)
```

There are two provider shapes behind that one interface -- see
[`base.py`](base.py)'s class docstring for the full explanation:

- **Rent-a-VM** (vast, shadeform, salad, scaleway, thundercompute, gpuai,
  northflank, hyperstack): `launch` starts a raw instance/container running
  `python -m app.cloud_worker` (see
  [`cloud_worker_entrypoint.py`](cloud_worker_entrypoint.py), built into
  `runtime/Dockerfile`'s `cloud-worker` stage), which pulls its own job from
  DynamoDB and writes status/results straight back on its own.
  `get_result`/`get_progress` are irrelevant here and stay at their `None`
  defaults.
- **Managed job-queue** (`runpod.py`, `modal_provider.py` -- both the
  default and the incumbent): `launch` submits a payload directly to a
  platform-run worker function with no AWS credentials of its own
  (`runpod_worker_entrypoint.py`, `modal_worker_entrypoint.py`). The control
  plane (`../aws/control_plane/handler.py`) is responsible for writing the
  result to S3 and settling the job itself once `get_status` reports done,
  using `get_result`/`get_progress` in place of the self-reporting the
  rent-a-VM model gets for free.

Either way, picking a vendor is a one-line `get_provider(name)` call, not a
rewrite -- `control_plane/handler.py` reads `LARKUP_VIDEO_GPU_PROVIDER`
(default `modal`) and dispatches through this registry generically.

## Worker entrypoints vs. this registry

`runpod_worker_entrypoint.py` and `modal_worker_entrypoint.py` are a
different role from `runpod.py`/`modal_provider.py`: the `_entrypoint`
files are the code that runs *inside* the GPU worker itself (RunPod's
`runpod.serverless.start()` loop, a deployed Modal `@app.function`), while
`runpod.py`/`modal_provider.py` are what the AWS control plane calls *from
the outside* to dispatch and poll a job. Do not confuse the two -- an
entrypoint has no AWS credentials and knows nothing about DynamoDB; a
provider adapter never touches a video file directly.

`remote_source.py` (ffmpeg helpers for seeking/normalizing a signed source
URL) is shared by both worker entrypoints and has no dependency on the rest
of this directory. `progress.py` (throttled structured progress reporting)
is the same kind of shared, dependency-free helper, used by
`runpod_worker_entrypoint.py`.

## Why this lives outside `runtime/` and stays out of `deploy/aws/control_plane/`'s published surface

`package.json`'s `"files"` allowlist controls exactly what `npm publish`
ships in `@larkup/tool-video-intelligence`. This directory (and the worker
entrypoints in it) is deliberately *not* listed there, so none of it is
published -- the tool manifest promises it "never exposes the GPU endpoint,"
and an internal vendor choice should never leak to an end user. Keeping this
code in its own directory with no imports from `runtime/app` (only the
shared pipeline it calls into) or from `control_plane/` keeps a future move
of this whole directory to a private ops/infra location a plain directory
move, with no unpicking required.

`runpod_worker_entrypoint.py`/`remote_source.py` used to live in
`runtime/app/`, which *is* in that `files` allowlist -- so RunPod's worker
entrypoint used to ship to every installer of the tool even though it only
ever runs inside Larkup's own managed-cloud GPU workers. `runtime/Dockerfile`
copies both files back into the built image's `app` package at build time
(see its `runpod` stage), which is the only place their `from .config import
Settings`-style relative imports need to resolve -- not their source
location in this repo.

## Credentials

Each provider reads its own API key from the environment (see `.env`'s `# GPU
Providers` section for the exact names, e.g. `VAST_API_KEY`,
`SHADE_FORM_API_KEY`, `HYPERSTACK_API_KEY`). `Provider.from_env()` raises
`GPUProviderError` immediately if its key is missing -- nothing here ever
hardcodes a key or logs one.

## Adding a provider

1. Add a module implementing `GPUInstanceProvider` from `base.py` (a class
   attribute `name`, plus `from_env`, `launch`, `get_status`, `terminate`).
2. Register it in `registry.py`.
3. Add `tests/test_<provider>.py` that mocks HTTP (`unittest.mock.patch`) --
   no real network calls or real API keys in tests, matching the rest of this
   package's test suite (`../../runtime/tests`).

## Running the tests

```bash
cd packages/marketplace-tools/video-intelligence
python3 -m pip install -r deploy/gpu_providers/requirements.txt
PYTHONPATH=deploy python3 -m unittest discover -s deploy/gpu_providers/tests -p 'test_*.py'
```
