# Private cloud deploy (not in the public repo)

`deploy/` is gitignored (see the root `.gitignore`) and lives only in a
deploy operator's local checkout, the same way `apps/ee/` is deployed with
the Vercel CLI and never committed. Public clones of this repo only get
`runtime/` (the Docker/local-run path); this directory holds the AWS
control plane and GPU provider dispatch/worker code for Larkup's managed
cloud offering.

This file replaces the steps that used to run in the public
`video-intelligence.yml` CI workflow, back when this directory was tracked.
Run these manually (or wire them into a private CI you control) before
trusting a change here.

## Test

```bash
cd packages/marketplace-tools/video-intelligence
python3 -m pip install --upgrade pip
pip install -r runtime/requirements-cpu.txt
pip install -r deploy/gpu_providers/requirements.txt
pip install -r deploy/aws/control_plane/requirements-test.txt

python -m compileall -q runtime deploy/aws/control_plane deploy/gpu_providers
PYTHONPATH=deploy python3 -m unittest discover -s deploy/gpu_providers/tests -p 'test_*.py'
python3 -m unittest discover -s deploy/aws/control_plane/tests -p 'test_*.py'
```

## Validate and deploy the AWS stack

```bash
cd packages/marketplace-tools/video-intelligence/deploy/aws
sam validate --lint
GPU_PROVIDERS_DIR="$(cd ../gpu_providers && pwd)" sam build
sam deploy --parameter-overrides ModalTokenId=... ModalTokenSecret=... [ProcessingEnabled=true]
```

`RunpodEndpointId`/`RunpodApiKey` are optional (default empty/placeholder)
when `GpuProvider` stays `modal`; only `ModalTokenId`/`ModalTokenSecret` are
required. One-time bootstrap from an AWS SSO/admin session:

```bash
AWS_REGION=eu-central-1 ./bootstrap.sh Larkup-AI larkup production
```

Deploy the Modal worker (module mode is required -- it has a top-level
relative import):

```bash
cd packages/marketplace-tools/video-intelligence
modal deploy -m deploy.gpu_providers.modal_worker_entrypoint
modal secret create larkup-video-intelligence AI_GATEWAY_API_KEY=<real key> --force
```

## Build and publish the RunPod worker image

This used to be the `publish-runpod-image` CI job, tag- or dispatch-triggered.
Run it from a machine with GHCR push access:

```bash
cd packages/marketplace-tools/video-intelligence
docker buildx build \
  --platform linux/amd64 \
  --target runpod \
  --push \
  --tag ghcr.io/<owner>/video-intelligence:<tag> \
  -f runtime/Dockerfile .
```

Do not send a long-lived AWS secret through chat or store it in GitHub. A
short AWS SSO session is sufficient for bootstrap.
