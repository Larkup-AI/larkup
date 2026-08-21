from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.store import AuthenticationError, Principal, QuotaExceededError, Store


class StoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name) / "state.sqlite3")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_access_code_is_single_use_and_returns_a_working_key(self) -> None:
        entitlement = {
            "sourceMinutesPerMonth": 10,
            "maxConcurrentJobs": 1,
            "allowFullCoverage": False,
            "plan": "test",
        }
        code = self.store.create_access_code(
            label="tester", entitlement=entitlement, max_uses=1, expires_at=None
        )
        api_key, actual = self.store.redeem_access_code(code, "Test user")
        self.assertEqual(actual, entitlement)
        self.assertEqual(self.store.resolve_principal(api_key, True).entitlement, entitlement)
        with self.assertRaises(AuthenticationError):
            self.store.redeem_access_code(code, None)

    def test_quota_reservation_is_atomic(self) -> None:
        principal = Principal(
            "user",
            {
                "sourceMinutesPerMonth": 5,
                "maxConcurrentJobs": 1,
                "allowFullCoverage": False,
            },
        )
        source = Path(self.temp.name) / "video.mp4"
        source.touch()
        self.store.create_upload("user", "upload", "video.mp4", source, 0)
        request = {
            "source": {"uploadId": "upload"},
            "brief": {"indexingMode": "balanced"},
        }
        self.store.create_job(principal, "job-1", "upload", request, 3)
        with self.assertRaises(QuotaExceededError):
            self.store.create_job(principal, "job-2", "upload", request, 3)

    def test_full_coverage_requires_entitlement(self) -> None:
        principal = Principal(
            "user",
            {
                "sourceMinutesPerMonth": 100,
                "maxConcurrentJobs": 1,
                "allowFullCoverage": False,
            },
        )
        source = Path(self.temp.name) / "video.mp4"
        source.touch()
        self.store.create_upload("user", "upload", "video.mp4", source, 0)
        with self.assertRaises(QuotaExceededError):
            self.store.create_job(
                principal,
                "job",
                "upload",
                {
                    "source": {"uploadId": "upload"},
                    "brief": {"indexingMode": "full-coverage"},
                },
                1,
            )


if __name__ == "__main__":
    unittest.main()
