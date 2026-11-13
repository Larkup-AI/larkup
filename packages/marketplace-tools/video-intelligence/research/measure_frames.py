"""Synthetic storage microbenchmark; run each strategy in a fresh process."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import resource
import sys
import time

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "runtime"))
from app.services.frame_store import FrameStore


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--strategy", choices=["raw", "spooled"], required=True)
    parser.add_argument("--clips", type=int, default=100)
    args = parser.parse_args()
    if args.clips < 1:
        parser.error("clips must be positive")
    started = time.perf_counter()
    frame = np.random.default_rng(42).integers(0, 256, (360, 640, 3), dtype=np.uint8)
    with FrameStore() as store:
        clips = []
        for clip in range(args.clips):
            frames = [(clip * 4_000 + i * 1_000, frame.copy()) for i in range(4)]
            clips.append(store.save(frames) if args.strategy == "spooled" else frames)
        checksum = sum(int(image.sum()) for clip in clips for _, image in clip)
        usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        print(json.dumps({
            "strategy": args.strategy, "clips": args.clips, "framesPerClip": 4,
            "width": 640, "height": 360, "seed": 42, "checksum": checksum,
            "peakRssBytes": usage if sys.platform == "darwin" else usage * 1024,
            "elapsedSeconds": round(time.perf_counter() - started, 3),
            "temporaryBytes": store.diagnostics()["bytes"],
            "scope": "synthetic storage only; excludes decode, scout and models",
        }))


if __name__ == "__main__":
    main()
