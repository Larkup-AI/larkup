import tempfile,unittest,sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock,patch
from harness.gpu_probe import verify

class GPUProofTest(unittest.TestCase):
    def test_proof_requires_real_cuda_and_finite_outputs(self):
        for providers,finite,valid in [(['CUDAExecutionProvider'],True,True),(['CPUExecutionProvider'],True,False),(['CUDAExecutionProvider'],False,False)]:
            with self.subTest(providers=providers,finite=finite),tempfile.TemporaryDirectory() as folder:
                root=Path(folder);model=root/'data/models/yolox_s.onnx';model.parent.mkdir(parents=True);model.write_bytes(b'detector weights')
                options=SimpleNamespace(add_session_config_entry=Mock())
                session=SimpleNamespace(run=Mock(return_value=[SimpleNamespace(shape=(1,1,4))]),get_inputs=lambda:[SimpleNamespace(name='input')],get_providers=lambda:providers)
                numpy=SimpleNamespace(zeros=Mock(return_value='tensor'),float32='float32',isfinite=lambda value:SimpleNamespace(all=lambda:finite))
                ort=SimpleNamespace(SessionOptions=lambda:options,InferenceSession=Mock(return_value=session),__version__='fixture')
                with patch.dict(sys.modules,{'numpy':numpy,'onnxruntime':ort}):
                    if valid:
                        proof=verify(root);self.assertEqual(proof['provider'],'CUDAExecutionProvider');self.assertFalse(proof['cpuFallback'])
                    else:
                        with self.assertRaises(RuntimeError):verify(root)
                        self.assertFalse((root/'data/deployment/gpu-proof.json').exists())
                options.add_session_config_entry.assert_called_once_with('session.disable_cpu_ep_fallback','1')
