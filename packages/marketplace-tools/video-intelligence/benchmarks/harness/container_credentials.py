"""Keep generated Pod credentials on the container disk, outside shared volumes."""
import json
from pathlib import Path
from .common import atomic, Secrets

def install(benchmark, aliases, capability, controller_token, runtime_token, *, private_root=Path('/run/larkup-benchmark')):
    private_root.mkdir(parents=True,exist_ok=True,mode=0o700)
    private_root.chmod(0o700)
    documents={
        'benchmark.env': ''.join(alias+'='+capability+'\n' for alias in aliases),
        'tokens.env': 'BENCHMARK_CONTROLLER_TOKEN='+controller_token+'\nBENCHMARK_RUNTIME_TOKEN='+runtime_token+'\n',
        'relay.json': json.dumps({'relayCapability':capability,'controllerToken':controller_token}),
    }
    for name,body in documents.items():
        target=private_root/name
        atomic(target,body,raw=True)
        target.chmod(0o600)
        link=benchmark/name if name=='benchmark.env' else benchmark/'data/deployment'/name
        link.parent.mkdir(parents=True,exist_ok=True)
        link.unlink(missing_ok=True)
        link.symlink_to(target)
    Secrets(benchmark/'benchmark.env')
    return {'relayCapability':capability,'controllerToken':controller_token}
