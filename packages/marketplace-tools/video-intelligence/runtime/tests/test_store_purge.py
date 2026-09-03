from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.db.store import DEFAULT_LOCAL_ENTITLEMENT, Principal, Store, StoreError


class StorePurgeTests(unittest.TestCase):
    def test_purging_a_terminal_job_removes_its_result_and_uploaded_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.mp4"
            source.write_bytes(b"video")
            store = Store(root / "runtime.sqlite")
            principal = Principal("local", DEFAULT_LOCAL_ENTITLEMENT.copy())
            store.create_upload("local", "upload-1", "source.mp4", source, source.stat().st_size)
            store.create_job(
                principal,
                "job-1",
                "upload-1",
                {"brief": {"indexingMode": "balanced"}},
                1.0,
            )
            store.cancel_job("local", "job-1")

            store.purge_job_data("local", "job-1")

            self.assertFalse(source.exists())
            with self.assertRaises(StoreError):
                store.get_job("local", "job-1")
            with self.assertRaises(StoreError):
                store.get_upload("local", "upload-1")

    def test_refuses_to_purge_an_active_job(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.mp4"
            source.write_bytes(b"video")
            store = Store(root / "runtime.sqlite")
            principal = Principal("local", DEFAULT_LOCAL_ENTITLEMENT.copy())
            store.create_upload("local", "upload-1", "source.mp4", source, source.stat().st_size)
            store.create_job(
                principal,
                "job-1",
                "upload-1",
                {"brief": {"indexingMode": "balanced"}},
                1.0,
            )

            with self.assertRaises(StoreError):
                store.purge_job_data("local", "job-1")


if __name__ == "__main__":
    unittest.main()
