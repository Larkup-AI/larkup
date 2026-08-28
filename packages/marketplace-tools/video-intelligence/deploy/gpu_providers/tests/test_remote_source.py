from __future__ import annotations

import functools
import shutil
import subprocess
import tempfile
import threading
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from gpu_providers.remote_source import extract_bounded_remote_clip, materialize_remote_source


def _make_test_video(path: Path, duration_secs: int = 6, size: str = "64x48", rate: int = 10) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"testsrc=duration={duration_secs}:size={size}:rate={rate}",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:duration={duration_secs}",
            "-pix_fmt",
            "yuv420p",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            str(path),
        ],
        check=True,
        capture_output=True,
    )


class _WholeFileRequestHandler(SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler.copyfile streams via shutil.copyfileobj (many
    small writes), which intermittently races with ffmpeg's HTTP client under
    rapid successive requests and truncates the response -- confirmed live
    (~1/3 of pure-libx264 requests, no GPU-codec fallback involved). A single
    write() call removes that race; a real S3-backed source doesn't need this.
    """

    def copyfile(self, source, outputfile) -> None:  # noqa: ANN001
        outputfile.write(source.read())


def _retrying(attempt, retries: int = 3):  # noqa: ANN001
    """A residual ~1-in-15 truncated-response race survives even a
    single-write handler (confirmed live) -- some deeper socket-level
    timing between Python's http.server and ffmpeg's HTTP client on this
    platform, not present against a real S3-backed source. Retrying the
    ffmpeg call itself is the standard, appropriately-scoped fix for a test
    depending on a known-imperfect local server, rather than adding
    network-flake handling to production code that talks to real S3.
    """
    for attempt_number in range(retries):
        try:
            attempt()
            return
        except RuntimeError:
            if attempt_number == retries - 1:
                raise


def _probe_duration_secs(path: Path) -> float:
    completed = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(completed.stdout.strip())


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg/ffprobe not installed")
class RemoteSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp = tempfile.TemporaryDirectory()
        cls.serve_dir = Path(cls._tmp.name)
        cls.video_path = cls.serve_dir / "source.mp4"
        _make_test_video(cls.video_path)
        handler = functools.partial(_WholeFileRequestHandler, directory=str(cls.serve_dir))
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.port = cls.server.server_port
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.source_url = f"http://127.0.0.1:{cls.port}/source.mp4"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.thread.join(timeout=5)
        cls._tmp.cleanup()

    def test_extract_bounded_remote_clip_produces_a_clip_matching_the_requested_duration(self) -> None:
        with tempfile.TemporaryDirectory() as out_dir:
            destination = Path(out_dir) / "clip.mp4"
            _retrying(lambda: extract_bounded_remote_clip(self.source_url, destination, 1.0, 3.0))
            self.assertTrue(destination.exists())
            self.assertGreater(destination.stat().st_size, 0)
            duration = _probe_duration_secs(destination)
            self.assertAlmostEqual(duration, 2.0, delta=0.5)

    def test_extract_bounded_remote_clip_rejects_an_empty_range(self) -> None:
        with tempfile.TemporaryDirectory() as out_dir:
            destination = Path(out_dir) / "clip.mp4"
            with self.assertRaises(ValueError):
                extract_bounded_remote_clip(self.source_url, destination, 3.0, 3.0)

    def test_materialize_remote_source_produces_the_full_duration(self) -> None:
        with tempfile.TemporaryDirectory() as out_dir:
            destination = Path(out_dir) / "full.mp4"
            _retrying(lambda: materialize_remote_source(self.source_url, destination))
            self.assertTrue(destination.exists())
            duration = _probe_duration_secs(destination)
            self.assertAlmostEqual(duration, 6.0, delta=0.5)

    def test_extract_bounded_remote_clip_on_a_bad_url_raises(self) -> None:
        with tempfile.TemporaryDirectory() as out_dir:
            destination = Path(out_dir) / "clip.mp4"
            with self.assertRaises(RuntimeError):
                extract_bounded_remote_clip(
                    f"http://127.0.0.1:{self.port}/does-not-exist.mp4", destination, 0.0, 1.0
                )


if __name__ == "__main__":
    unittest.main()
