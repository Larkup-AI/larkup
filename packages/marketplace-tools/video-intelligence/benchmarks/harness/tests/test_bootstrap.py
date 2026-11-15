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
            for name in ['flock','ffmpeg','espeak','pnpm','uv']:
                executable(bins/name,'exit 0')
            executable(bins/'node',"echo 18")
            marker=root/'repair-started'
            executable(bins/'apt-get','touch "'+str(marker)+'"; exit 73')
            result=subprocess.run(['/bin/bash',str(script),str(root)],
                env={**os.environ,'PATH':str(bins)+':/usr/bin:/bin'},capture_output=True)
            self.assertEqual(result.returncode,73)
            self.assertTrue(marker.exists())
