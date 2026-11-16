"""Exercise the actual canonical detector weights with CPU fallback disabled."""
from pathlib import Path
import hashlib
import platform

from .common import atomic, utc


def verify(benchmark: Path):
    import numpy as np
    import onnxruntime as ort
    model = benchmark / 'data/models/yolox_s.onnx'
    options = ort.SessionOptions()
    options.add_session_config_entry('session.disable_cpu_ep_fallback', '1')
    session = ort.InferenceSession(str(model), sess_options=options, providers=[('CUDAExecutionProvider', {'cudnn_conv_algo_search': 'HEURISTIC'})])
    outputs = session.run(None, {session.get_inputs()[0].name: np.zeros((1, 3, 640, 640), dtype=np.float32)})
    if 'CUDAExecutionProvider' not in session.get_providers() or not outputs or not all(np.isfinite(x).all() for x in outputs):
        raise RuntimeError('GPU detector validation failed')
    proof = dict(verifiedAt=utc(), provider='CUDAExecutionProvider', cpuFallback=False,
                 detectorSha256=hashlib.sha256(model.read_bytes()).hexdigest(),
                 outputShapes=[list(x.shape) for x in outputs], onnxruntime=ort.__version__, python=platform.python_version())
    atomic(benchmark / 'data/deployment/gpu-proof.json', proof)
    return proof
