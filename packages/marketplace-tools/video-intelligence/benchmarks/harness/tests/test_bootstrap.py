import os
import subprocess
import tempfile
import unittest
from pathlib import Path


class BootstrapTest(unittest.TestCase):
    def test_saved_marker_does_not_skip_missing_container_dependencies(self):
        script=Path(__file__).resolve().parents[1]/'bootstrap-remote.sh'
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);bins=root/'bin';bins.mkdir()
            bench=root/'packages/marketplace-tools/video-intelligence/benchmarks'
            deployment=bench/'data/deployment';deployment.mkdir(parents=True)
            (deployment/'bootstrap.done').write_text('previous container')
            venv=deployment/'venv/bin';venv.mkdir(parents=True)
            def executable(path,body):
                path.write_text('#!/bin/sh\n'+body+'\n');path.chmod(0o700)
            executable(venv/'python','exit 0')
            for name in ['flock','ffmpeg','pnpm','uv']:
                executable(bins/name,'exit 0')
            executable(bins/'node',"echo 18")
            marker=root/'repair-started'
            executable(bins/'apt-get','touch "'+str(marker)+'"; exit 73')
            result=subprocess.run(['/bin/bash',str(script),str(root)],
                env={**os.environ,'PATH':str(bins)+':/usr/bin:/bin'},capture_output=True)
            self.assertEqual(result.returncode,73)
            self.assertTrue(marker.exists())

    def test_warm_volume_uses_cached_tools_and_skips_dependency_installs(self):
        import hashlib, io, tarfile
        script=Path(__file__).resolve().parents[1]/'bootstrap-remote.sh'
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);bins=root/'bin';bins.mkdir()
            bench=root/'packages/marketplace-tools/video-intelligence/benchmarks'
            deployment=bench/'data/deployment';deployment.mkdir(parents=True)
            (bench/'data/models').mkdir();(bench/'data/models/yolox_s.onnx').touch()
            runtime=bench.parent/'runtime';runtime.mkdir();(runtime/'pyproject.toml').write_text('runtime')
            (root/'pnpm-lock.yaml').write_text('lock')
            node_store=root/'prepared-node'
            with tarfile.open(deployment/'node-deps.tar.gz','w:gz') as archive:
                member=tarfile.TarInfo('dependency.txt');member.size=5
                archive.addfile(member,io.BytesIO(b'ready'))
            (root/'packages/core/node_modules/tsx').mkdir(parents=True)
            def executable(path,body):
                path.parent.mkdir(parents=True,exist_ok=True)
                path.write_text('#!/bin/sh\n'+body+'\n');path.chmod(0o700)
            for name in ['flock','ffmpeg','espeak']:
                executable(bins/name,'exit 0')
            executable(bins/'sha256sum','export LC_ALL=C; exec /usr/bin/shasum -a 256 "$@"')
            executable(deployment/'tools/bin/uv','exit 74')
            executable(deployment/'tools/bin/pnpm','exit 75')
            executable(deployment/'node/bin/node','echo 22')
            executable(deployment/'venv/bin/python','exit 0')
            for name in ['apt-get','curl','npm']:
                executable(bins/name,'exit 76')
            (deployment/'runtime-deps.sha256').write_text(hashlib.sha256(b'runtime').hexdigest())
            (deployment/'node-deps.sha256').write_text(hashlib.sha256(b'lock').hexdigest())
            result=subprocess.run(['/bin/bash',str(script),str(root)],
                env={**os.environ,'PATH':str(bins)+':/usr/bin:/bin','BENCHMARK_NODE_STORE':str(node_store)},capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr.decode())
            self.assertTrue((deployment/'bootstrap.done').exists())
            self.assertEqual((node_store/'dependency.txt').read_text(),'ready')
