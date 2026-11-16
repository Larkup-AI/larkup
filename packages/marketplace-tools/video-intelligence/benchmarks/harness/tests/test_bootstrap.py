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
                env={**os.environ,'LC_ALL':'C','PATH':str(bins)+':/usr/bin:/bin'},capture_output=True)
            self.assertEqual(result.returncode,73)
            self.assertTrue(marker.exists())

    def test_prepared_container_tools_skip_all_dependency_installs(self):
        import hashlib
        script=Path(__file__).resolve().parents[1]/'bootstrap-remote.sh'
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);bins=root/'bin';bins.mkdir()
            bench=root/'packages/marketplace-tools/video-intelligence/benchmarks'
            deployment=bench/'data/deployment';deployment.mkdir(parents=True)
            (bench/'data/models').mkdir();(bench/'data/models/yolox_s.onnx').touch()
            runtime=bench.parent/'runtime';runtime.mkdir();(runtime/'pyproject.toml').write_text('runtime')
            (root/'pnpm-lock.yaml').write_text('lock')
            node_store=root/'prepared-node'
            node_store.mkdir()
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
            (deployment/'venv/.larkup-runtime-deps.sha256').write_text(hashlib.sha256(b'runtime').hexdigest())
            (node_store/'.larkup-node-deps.sha256').write_text(hashlib.sha256(b'lock').hexdigest())
            result=subprocess.run(['/bin/bash',str(script),str(root)],
                env={**os.environ,'LC_ALL':'C','PATH':str(bins)+':/usr/bin:/bin','BENCHMARK_NODE_STORE':str(node_store),'BENCHMARK_NODE_ROOT':str(deployment/'node'),'BENCHMARK_TOOLS_ROOT':str(deployment/'tools'),'BENCHMARK_PYTHON_ENV':str(deployment/'venv')},capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr.decode())
            self.assertTrue((deployment/'bootstrap.done').exists())

    def test_new_gpu_prepares_tools_and_python_on_ssd_before_starting_services(self):
        import io,tarfile
        script=Path(__file__).resolve().parents[1]/'bootstrap-remote.sh'
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);bins=root/'bin';bins.mkdir()
            bench=root/'packages/marketplace-tools/video-intelligence/benchmarks'
            deployment=bench/'data/deployment';deployment.mkdir(parents=True)
            (bench/'data/models').mkdir();(bench/'data/models/yolox_s.onnx').touch()
            runtime=bench.parent/'runtime';runtime.mkdir();(runtime/'pyproject.toml').write_text('runtime')
            (root/'pnpm-lock.yaml').write_text('lock')
            def executable(path,body):
                path.parent.mkdir(parents=True,exist_ok=True)
                path.write_text('#!/bin/sh\n'+body+'\n');path.chmod(0o700)
            for name in ['flock','ffmpeg','espeak']:
                executable(bins/name,'exit 0')
            executable(bins/'node','echo 18')
            executable(bins/'sha256sum','export LC_ALL=C; exec /usr/bin/shasum -a 256 "$@"')
            fixture=root/'node.tar.xz'
            with tarfile.open(fixture,'w:xz') as archive:
                data=b'#!/bin/sh\necho 22\n';member=tarfile.TarInfo('node/bin/node');member.size=len(data);member.mode=0o700
                archive.addfile(member,io.BytesIO(data))
            executable(bins/'curl','while [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then shift; /bin/cp "'+str(fixture)+'" "$1"; exit; fi; shift; done; exit 91')
            executable(bins/'uv','if [ "$1" = venv ]; then mkdir -p "$4/bin"; cp "'+str(bins/'ffmpeg')+'" "$4/bin/python"; fi; exit 0')
            executable(bins/'pnpm','exit 73')
            node_root=root/'ssd-node';python_env=root/'ssd-python'
            result=subprocess.run(['/bin/bash',str(script),str(root)],env={**os.environ,'LC_ALL':'C','PATH':str(bins)+':/usr/bin:/bin',
                'BENCHMARK_NODE_ROOT':str(node_root),'BENCHMARK_TOOLS_ROOT':str(root/'ssd-tools'),
                'BENCHMARK_PYTHON_ENV':str(python_env),'BENCHMARK_NODE_STORE':str(root/'ssd-node-deps')},capture_output=True)
            self.assertEqual(result.returncode,73,result.stderr.decode())
            self.assertTrue((node_root/'bin/node').exists())
            self.assertTrue((python_env/'.larkup-runtime-deps.sha256').exists())
            self.assertEqual((deployment/'venv').resolve(),python_env.resolve())
            self.assertFalse((deployment/'node').exists())
            self.assertEqual((deployment/'bootstrap.failed').read_text().strip(),'73')
