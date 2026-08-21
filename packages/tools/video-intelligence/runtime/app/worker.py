from __future__ import annotations

import argparse

from .config import Settings
from .service import JobService
from .store import Store


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one queued video intelligence job")
    parser.add_argument("job_id")
    args = parser.parse_args()
    settings = Settings.from_env()
    store = Store(settings.data_dir / "video-intelligence.sqlite3")
    JobService(settings, store).run(args.job_id)


if __name__ == "__main__":
    main()
