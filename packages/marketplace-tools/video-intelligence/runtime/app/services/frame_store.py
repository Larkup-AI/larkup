from __future__ import annotations

from collections.abc import Iterator, Sequence
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import overload

import numpy as np


Frame = tuple[int, np.ndarray]


class StoredFrames(Sequence[Frame]):
    """Read immutable, lossless frames on demand; concurrent readers share no cursor."""

    def __init__(self, entries: list[tuple[int, Path]]) -> None:
        self._entries = tuple(entries)

    def __len__(self) -> int:
        return len(self._entries)

    @overload
    def __getitem__(self, index: int) -> Frame: ...

    @overload
    def __getitem__(self, index: slice) -> list[Frame]: ...

    def __getitem__(self, index: int | slice) -> Frame | list[Frame]:
        if isinstance(index, slice):
            return [self[i] for i in range(*index.indices(len(self)))]
        time_ms, path = self._entries[index]
        try:
            with path.open("rb") as stream:
                frame = np.load(stream, allow_pickle=False)
            frame.setflags(write=False)
        except (OSError, ValueError) as error:
            raise RuntimeError("A temporary video frame could not be read") from error
        return time_ms, frame

    def __iter__(self) -> Iterator[Frame]:
        for index in range(len(self)):
            yield self[index]


class FrameStore:
    """Spool completed clips outside RAM for one job; remove them on every exit."""

    def __init__(self) -> None:
        self._directory = TemporaryDirectory(prefix="larkup-video-frames-")
        self.path = Path(self._directory.name)
        self._count = 0
        self._bytes = 0

    def save(self, frames: Sequence[Frame]) -> StoredFrames:
        entries: list[tuple[int, Path]] = []
        for time_ms, frame in frames:
            path = self.path / f"{self._count}.npy"
            # Avoid compression work and preserve pixels. Consumers load one
            # frame at a time; no open mappings prevent cleanup on Windows.
            try:
                np.save(path, frame, allow_pickle=False)
            except OSError as error:
                raise RuntimeError("A temporary video frame could not be written") from error
            self._count += 1
            self._bytes += path.stat().st_size
            entries.append((time_ms, path))
        return StoredFrames(entries)

    def diagnostics(self) -> dict[str, int | str]:
        return {"storage": "temporary-lossless-npy", "frames": self._count, "bytes": self._bytes}

    def __enter__(self) -> FrameStore:
        return self

    def __exit__(self, *_exception: object) -> None:
        self._directory.cleanup()
